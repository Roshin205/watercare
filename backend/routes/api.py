import csv
import io
import os
import re
import secrets
import tempfile
import uuid
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from flask import Blueprint, current_app, g, jsonify, request, send_file, session
from sqlalchemy import String, cast, func, or_, select
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename

from backend.database import db as sqlalchemy_db
from backend.models import (
    approval_history, engineers, memberships, project_engineers, project_tasks, projects,
    uploaded_documents, users, water_testing_records,
)
from backend.utils import certificates as certs
from backend.utils.pdf_convert import PdfUnavailable, convert_to_pdf
from backend.utils.schedule_export import HEADERS as SCHEDULE_HEADERS, month_year, schedule_rows, schedule_workbook
from backend.security.authentication import ADMIN_LOGIN_ROLES, LoginRefused, login, require_user
from backend.utils.validators import (
    APPROVAL_STATUSES, FREQUENCY_FIELDS, RESOURCE_FIELDS, validate_payload, validate_settings,
)

api = Blueprint("api", __name__)
ADMIN = {"administrator"}
# Service Coordinators and Accountants are the two administrative roles: they view, edit, approve and reject.
# Every other role (employee, viewer) is view-only; employees may also submit completions for their own projects.
EDITORS = {"administrator", "service_coordinator", "accountant"}
APPROVERS = EDITORS
ACCOUNT_ROLES = {"service_coordinator", "accountant", "employee", "viewer"}
COMPLETION_FIELDS = {"completion_status", "completion_date", "completion_engineer_name", "invoice_number"}
RESOURCES = {
    "clients": ("clients", EDITORS),
    "engineers": ("engineers", EDITORS),
    "projects": ("projects", EDITORS),
    "services": ("services", {"administrator"}),
    "project_tasks": ("project_tasks", EDITORS),
    "cleaning-records": ("cleaning_records", EDITORS),
    "water-testing": ("water_testing_records", EDITORS),
}


SEARCH_COLUMNS = {
    "clients": ("name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes"),
    "engineers": ("engineer_code", "full_name", "email", "phone", "specialization", "availability"),
    "projects": ("name", "client_name", "service", "location", "system_details", "engineer_name", "invoice_number", "status", "approval_status"),
    "services": ("name", "description", "certificate_text"),
    "project_tasks": ("title", "description", "location", "notes", "status"),
    "cleaning_records": ("site_name", "tank_identification", "tank_type", "location", "procedure", "materials_used", "observations", "notes", "status"),
    "water_testing_records": ("sample_identification", "sampling_location", "water_source", "testing_category", "interpretation", "laboratory_details", "notes", "status"),
}
RECORD_DATE_COLUMNS = {"project_tasks": "scheduled_date", "cleaning_records": "cleaning_date", "water_testing_records": "collection_date"}
NO_DATE = "9999-12-31"


class ApprovalConflict(Exception):
    pass


def project_date():
    """The date a project is listed under: its start date, or the older single-date fields."""
    return func.coalesce(projects.c.start_date, projects.c.scheduled_date, projects.c.contract_period)


def project_order_key():
    return func.coalesce(projects.c.priority_date, project_date(), NO_DATE)


def in_project_order(query):
    """Date order, with any manual "do this first" moves applied."""
    return query.order_by(
        project_order_key(), func.coalesce(projects.c.priority_rank, 0),
        func.coalesce(project_date(), NO_DATE), projects.c.created_at,
    )


def checked_date(value, label):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{label} must use YYYY-MM-DD format.")
    date.fromisoformat(value)
    return value


def apply_list_filters(table, query, args):
    """Apply the shared search, client, project and date filters. Raises ValueError for unusable input."""
    columns = query.table.c
    search = (args.get("search") or "").strip()
    if len(search) > 100:
        raise ValueError("Search text must be 100 characters or fewer.")
    if search:
        pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conditions = [columns[name].ilike(pattern, escape="\\") for name in SEARCH_COLUMNS[table]]
        if table == "projects":
            conditions.append(cast(projects.c.so_no, String).ilike(pattern, escape="\\"))
        if "client_id" in columns:
            matching_clients = db().table("clients").select("id").eq("organization_id", g.organization_id).is_(
                "deleted_at", "null"
            ).ilike("name", pattern).execute().data or []
            if matching_clients:
                conditions.append(columns.client_id.in_([client["id"] for client in matching_clients]))
        query = query.where(or_(*conditions))
    for key, label in (("client_id", "Client"), ("project_id", "Project")):
        value = args.get(key)
        if not value:
            continue
        try:
            uuid.UUID(value)
        except ValueError:
            raise ValueError(f"{label} filter must be a valid record ID.")
        own_table = (key == "client_id" and table == "clients") or (key == "project_id" and table == "projects")
        column = columns.id if own_table else columns.get(key)
        if column is None:
            raise ValueError(f"{label} filtering is not available for this list.")
        query = query.where(column == value)
    service = args.get("service")
    if service:
        if len(service) > 120:
            raise ValueError("Project type is too long.")
        if "service" not in columns:
            raise ValueError("Project type filtering is not available for this list.")
        query = query.where(columns.service == service)
    start = checked_date(args["from"], "from") if args.get("from") else None
    end = checked_date(args["to"], "to") if args.get("to") else None
    if start and end and start > end:
        raise ValueError("from must not be after to.")
    if start or end:
        if table == "projects":
            # A project matches when any day between its start and end date falls inside the range.
            first = project_date()
            if start:
                query = query.where(func.coalesce(projects.c.end_date, first) >= start)
            if end:
                query = query.where(first <= end)
        elif table in RECORD_DATE_COLUMNS:
            if start:
                query = query.gte(RECORD_DATE_COLUMNS[table], start)
            if end:
                query = query.lte(RECORD_DATE_COLUMNS[table], end)
        else:
            raise ValueError("Date filtering is not available for this list.")
    return query


def db():
    return current_app.extensions["watercare_database"]


def failure(code, message, status):
    return jsonify({"error": {"code": code, "message": message}}), status


def safe_spreadsheet_value(value):
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def scoped_query(table, select="*"):
    query = db().table(table).select(select).eq("organization_id", g.organization_id).is_("deleted_at", "null")
    if g.role == "employee":
        engineer_ids = (
            db().table("engineers").select("id,full_name").eq("organization_id", g.organization_id)
            .eq("user_id", g.user.id).eq("is_active", True).is_("deleted_at", "null").execute().data or []
        )
        engineer_names = [engineer["full_name"] for engineer in engineer_ids]
        engineer_ids = [engineer["id"] for engineer in engineer_ids]
        if table == "projects":
            assignments = db().table("project_engineers").select("project_id").eq(
                "organization_id", g.organization_id
            ).in_("engineer_id", engineer_ids).execute().data if engineer_ids else []
            project_ids = {assignment["project_id"] for assignment in assignments or []}
            if engineer_names:
                named_projects = db().table("projects").select("id").eq(
                    "organization_id", g.organization_id
                ).in_("engineer_name", engineer_names).is_("deleted_at", "null").execute().data or []
                project_ids.update(project["id"] for project in named_projects)
            project_ids = list(project_ids)
            query = query.in_("id", project_ids) if project_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
        elif table == "project_tasks":
            assignments = db().table("project_engineers").select("project_id").eq(
                "organization_id", g.organization_id
            ).in_("engineer_id", engineer_ids).execute().data if engineer_ids else []
            project_ids = [assignment["project_id"] for assignment in assignments or []]
            query = query.in_("project_id", project_ids) if project_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
        elif table in ("cleaning_records", "water_testing_records"):
            query = query.in_("engineer_id", engineer_ids) if engineer_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
        elif table == "engineers":
            query = query.in_("id", engineer_ids) if engineer_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
        elif table == "clients":
            assignments = db().table("project_engineers").select("project_id").eq(
                "organization_id", g.organization_id
            ).in_("engineer_id", engineer_ids).execute().data if engineer_ids else []
            project_ids = [assignment["project_id"] for assignment in assignments or []]
            projects = db().table("projects").select("client_id").eq(
                "organization_id", g.organization_id
            ).in_("id", project_ids).execute().data if project_ids else []
            client_ids = {project["client_id"] for project in projects or []}
            for related_table in ("cleaning_records", "water_testing_records"):
                assigned = db().table(related_table).select("client_id").eq(
                    "organization_id", g.organization_id
                ).in_("engineer_id", engineer_ids).is_("deleted_at", "null").execute().data if engineer_ids else []
                client_ids.update(row["client_id"] for row in assigned or [])
            client_ids = list(client_ids)
            query = query.in_("id", client_ids) if client_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
    return query


def record(table, item_id):
    return scoped_query(table).eq("id", item_id).limit(1).execute().data


@api.get("/auth/me")
@require_user()
def me():
    if not session.get("csrf_token"):
        session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify({
        "user": {"id": g.user.id, "email": getattr(g.user, "email", None)},
        "organization_id": g.organization_id,
        "role": g.role,
        "csrf_token": session["csrf_token"],
    })


@api.post("/auth/login")
def login_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("email"), str) or not isinstance(payload.get("password"), str):
        return failure("invalid_request", "Email and password are required.", 400)
    login_type = payload.get("login_type", "client")
    access_key = payload.get("access_key", "")
    if login_type not in {"admin", "client"} or not isinstance(access_key, str):
        return failure("invalid_request", "Choose the Admin login or the Client login.", 400)
    if login_type == "admin" and not access_key:
        return failure("invalid_request", "Enter your private key to use the Admin login.", 400)
    try:
        account = login(payload["email"].strip(), payload["password"], login_type, access_key)
    except LoginRefused as error:
        return failure("wrong_login", str(error), 403)
    if not account:
        message = "Email, password or private key is incorrect." if login_type == "admin" else "Email or password is incorrect."
        return failure("unauthorized", message, 401)
    user, membership = account
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["organization_id"] = membership.organization_id
    session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify({
        "user": {"id": user["id"], "email": user["email"]},
        "organization_id": membership.organization_id,
        "role": membership.role,
        "csrf_token": session["csrf_token"],
    })


@api.post("/auth/logout")
def logout_route():
    session.clear()
    return jsonify({"message": "Signed out."})


@api.post("/auth/users")
@require_user(roles=ADMIN)
def create_user():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) - {"email", "full_name", "password", "role", "access_key"}:
        return failure("invalid_request", "Provide email, full_name, password, and role.", 400)
    email = payload.get("email")
    full_name = payload.get("full_name")
    password = payload.get("password")
    role = payload.get("role", "employee")
    access_key = payload.get("access_key")
    if (
        not isinstance(email, str) or len(email) > 320 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or not isinstance(full_name, str) or not full_name.strip() or len(full_name) > 255
        or not isinstance(password, str) or not 12 <= len(password) <= 512
        or role not in ACCOUNT_ROLES
    ):
        return failure("invalid_request", "Use a valid email, name, role, and password of at least 12 characters.", 400)
    if role in ADMIN_LOGIN_ROLES:
        if not isinstance(access_key, str) or not 12 <= len(access_key) <= 512:
            return failure("invalid_request", "Admin-level accounts need a private key of at least 12 characters.", 400)
    elif access_key:
        return failure("invalid_request", "Only admin-level accounts use a private key.", 400)
    existing = sqlalchemy_db.session.execute(select(users.c.id).where(users.c.email == email.lower())).first()
    if existing:
        return failure("conflict", "An account with this email already exists.", 409)
    user_id, now = str(uuid4()), datetime.now(timezone.utc).isoformat()
    try:
        sqlalchemy_db.session.execute(users.insert().values(
            id=user_id, email=email.lower(), full_name=full_name.strip(),
            password_hash=generate_password_hash(password), is_active=True,
            access_key_hash=generate_password_hash(access_key) if role in ADMIN_LOGIN_ROLES else None,
            created_at=now, updated_at=now,
        ))
        sqlalchemy_db.session.execute(memberships.insert().values(
            id=str(uuid4()), organization_id=g.organization_id, user_id=user_id,
            role=role, status="active", created_at=now,
        ))
        if role == "employee":
            # Employees see work through their engineer profile; its Engineer ID is added later on the Engineers page.
            sqlalchemy_db.session.execute(engineers.insert().values(
                id=str(uuid4()), organization_id=g.organization_id, user_id=user_id,
                full_name=full_name.strip(), email=email.lower(), is_active=True,
                created_by=g.user.id, updated_by=g.user.id, created_at=now, updated_at=now,
            ))
        sqlalchemy_db.session.commit()
        return jsonify({"data": {"id": user_id, "email": email.lower(), "full_name": full_name.strip(), "role": role}}), 201
    except Exception:
        sqlalchemy_db.session.rollback()
        current_app.logger.exception("Employee account creation failed.")
        return failure("database_error", "Employee account could not be created.", 503)


@api.post("/auth/change-password")
@require_user()
def change_password():
    payload = request.get_json(silent=True)
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("current_password"), str)
        or not isinstance(payload.get("new_password"), str)
        or not 12 <= len(payload["new_password"]) <= 512
    ):
        return failure("invalid_request", "Provide your current password and a new password between 12 and 512 characters.", 400)
    account = sqlalchemy_db.session.execute(select(users).where(users.c.id == g.user.id)).mappings().first()
    from werkzeug.security import check_password_hash

    if not account or not check_password_hash(account["password_hash"], payload["current_password"]):
        return failure("unauthorized", "Current password is incorrect.", 401)
    sqlalchemy_db.session.execute(users.update().where(users.c.id == g.user.id).values(
        password_hash=generate_password_hash(payload["new_password"]),
        updated_at=datetime.now(timezone.utc).isoformat(),
    ))
    sqlalchemy_db.session.commit()
    session.clear()
    return jsonify({"message": "Password changed. Sign in again."})


@api.get("/dashboard/summary")
@require_user()
def dashboard_summary():
    try:
        projects = scoped_query("projects", "id,status").execute().data or []
        tasks = scoped_query("project_tasks", "id,status,scheduled_date,title,project_id").gte(
            "scheduled_date", date.today().isoformat()
        ).order("scheduled_date").limit(100).execute().data or []
        return jsonify({
            "project_count": len(projects),
            "active_projects": sum(p["status"] not in ("Completed", "Cancelled") for p in projects),
            "upcoming_tasks": tasks,
        })
    except Exception:
        current_app.logger.exception("Dashboard summary failed.")
        return failure("database_error", "Dashboard data is temporarily unavailable.", 503)


@api.get("/dashboard/tasks")
@require_user()
def dashboard_tasks():
    start = request.args.get("from")
    end = request.args.get("to")
    client_id = request.args.get("client_id")
    if not start or not end:
        return failure("invalid_request", "Both from and to dates are required.", 400)
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
            raise ValueError()
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        return failure("invalid_request", "Dates must use YYYY-MM-DD format.", 400)
    if start > end:
        return failure("invalid_request", "from must not be after to.", 400)
    try:
        projects = scoped_query("projects")
        if client_id:
            projects = projects.eq("client_id", client_id)
        project_rows = projects.execute().data or []
        tasks_query = scoped_query("project_tasks").gte("scheduled_date", start).lte("scheduled_date", end)
        task_rows = tasks_query.order("scheduled_date").limit(500).execute().data or []
        project_by_id = {p["id"]: p for p in project_rows}
        client_ids = list({project["client_id"] for project in project_rows if project.get("client_id")})
        clients = db().table("clients").select("id,name").eq(
            "organization_id", g.organization_id
        ).in_("id", client_ids).execute().data if client_ids else []
        client_names = {client["id"]: client["name"] for client in clients or []}
        assignments = db().table("project_engineers").select("project_id,engineer_id").eq(
            "organization_id", g.organization_id
        ).in_("project_id", list(project_by_id)).execute().data if project_by_id else []
        project_engineers = {}
        for assignment in assignments or []:
            project_engineers.setdefault(assignment["project_id"], []).append(assignment["engineer_id"])
        results = []
        for project in project_rows:
            project_start = project.get("start_date")
            project_end = project.get("end_date")
            if project_start:
                try:
                    first_day = max(date.fromisoformat(project_start), date.fromisoformat(start))
                    last_day = min(date.fromisoformat(project_end or project_start), date.fromisoformat(end))
                except ValueError:
                    current_app.logger.warning("Skipping project %s with an invalid date range.", project["id"])
                    continue
                project_dates = []
                while first_day <= last_day:
                    project_dates.append(first_day.isoformat())
                    first_day = date.fromordinal(first_day.toordinal() + 1)
            else:
                scheduled_date = project.get("scheduled_date") or project.get("contract_period")
                project_dates = [scheduled_date] if scheduled_date and start <= scheduled_date <= end else []
            for scheduled_date in project_dates:
                results.append({
                    "id": project["id"], "title": project["name"], "status": project.get("status"),
                    "scheduled_date": scheduled_date, "scheduled_time": project.get("visit_time") or project.get("scheduled_time"),
                    "location": project.get("location"), "description": project.get("description"),
                    "project": {**project, "client_name": project.get("client_name") or client_names.get(project.get("client_id"))},
                    "engineer_ids": project_engineers.get(project["id"], []),
                    "record_type": "project",
                })
        for task in task_rows:
            project = project_by_id.get(task.get("project_id"))
            if project:
                results.append({
                    **task, "project": {**project, "client_name": project.get("client_name") or client_names.get(project.get("client_id"))},
                    "engineer_ids": [task["engineer_id"]] if task.get("engineer_id") else project_engineers.get(project["id"], []),
                    "record_type": "task",
                })
        cleanings = scoped_query("cleaning_records").gte("cleaning_date", start).lte("cleaning_date", end)
        if client_id:
            cleanings = cleanings.eq("client_id", client_id)
        cleaning_rows = cleanings.order("cleaning_date").limit(500).execute().data or []
        tests = scoped_query("water_testing_records").gte("collection_date", start).lte("collection_date", end)
        if client_id:
            tests = tests.eq("client_id", client_id)
        testing_rows = tests.order("collection_date").limit(500).execute().data or []
        related_client_ids = {
            row["client_id"] for row in cleaning_rows + testing_rows if row.get("client_id")
        }
        related_client_ids.update(project["client_id"] for project in project_rows)
        if related_client_ids:
            related_clients = db().table("clients").select("id,name").eq(
                "organization_id", g.organization_id
            ).in_("id", list(related_client_ids)).execute().data or []
            client_names.update({client["id"]: client["name"] for client in related_clients})
        engineer_ids = {
            engineer_id
            for task in results
            for engineer_id in task.get("engineer_ids", [])
        }
        engineer_ids.update(
            row["engineer_id"] for row in cleaning_rows + testing_rows if row.get("engineer_id")
        )
        engineers = db().table("engineers").select("id,full_name").eq(
            "organization_id", g.organization_id
        ).in_("id", list(engineer_ids)).execute().data if engineer_ids else []
        engineer_names = {engineer["id"]: engineer["full_name"] for engineer in engineers or []}
        for task in results:
            task["engineer_name"] = ", ".join(
                engineer_names[engineer_id]
                for engineer_id in task.get("engineer_ids", [])
                if engineer_id in engineer_names
            )
        for row in cleaning_rows:
            results.append({
                "id": row["id"], "title": f"Tank cleaning · {row.get('tank_identification') or row.get('site_name') or 'Service'}",
                "status": row.get("status"), "scheduled_date": row["cleaning_date"],
                "scheduled_time": row.get("cleaning_time"), "location": row.get("location"),
                "description": row.get("observations") or row.get("notes"), "record_type": "cleaning",
                "engineer_name": engineer_names.get(row.get("engineer_id")),
                "project": {"name": row.get("site_name"), "location": row.get("location"),
                            "client_name": client_names.get(row.get("client_id"))},
            })
        for row in testing_rows:
            results.append({
                "id": row["id"], "title": f"Water test · {row.get('sample_identification') or 'Sample'}",
                "status": row.get("status"), "scheduled_date": row["collection_date"],
                "scheduled_time": row.get("collection_time"), "location": row.get("sampling_location"),
                "description": row.get("testing_category"), "record_type": "water_testing",
                "engineer_name": engineer_names.get(row.get("engineer_id")),
                "project": {"name": row.get("sample_identification"),
                            "client_name": client_names.get(row.get("client_id"))},
            })
        results.sort(key=lambda task: (task.get("scheduled_date") or "", task.get("scheduled_time") or ""))
        return jsonify({"data": results})
    except Exception:
        current_app.logger.exception("Calendar task query failed.")
        return failure("database_error", "Calendar data is temporarily unavailable.", 503)


@api.route("/<path:resource>", methods=["GET", "POST"])
def collection(resource):
    if resource not in RESOURCES:
        return failure("not_found", "Unknown resource.", 404)
    table, write_roles = RESOURCES[resource]
    rule_resource = resource.replace("-", "_")

    @require_user()
    def get_collection():
        try:
            if resource == "services":
                ensure_default_services()
            query = scoped_query(table)
            try:
                query = apply_list_filters(table, query, request.args)
            except ValueError as error:
                return failure("invalid_request", str(error), 400)
            for key in ("status", "engineer_id", "category"):
                value = request.args.get(key)
                if value and key in RESOURCE_FIELDS[rule_resource]["fields"]:
                    query = query.eq(key, value)
            limit = min(max(request.args.get("limit", 100, type=int), 1), 200)
            offset = max(request.args.get("offset", 0, type=int), 0)
            query = in_project_order(query) if table == "projects" else query.order("created_at", desc=True)
            response = query.range(offset, offset + limit - 1).execute()
            records = response.data or []
            if resource == "projects" and records:
                assignments = db().table("project_engineers").select("project_id,engineer_id").eq(
                    "organization_id", g.organization_id
                ).in_("project_id", [row["id"] for row in records]).execute().data or []
                engineer_map = {}
                for assignment in assignments:
                    engineer_map.setdefault(assignment["project_id"], []).append(assignment["engineer_id"])
                for row in records:
                    row["assigned_engineer_ids"] = engineer_map.get(row["id"], [])
            if resource == "engineers" and records:
                photos = scoped_query("uploaded_documents").eq("related_type", "engineer").in_(
                    "related_id", [row["id"] for row in records]
                ).order("created_at", desc=True).execute().data or []
                latest = {}
                for photo in photos:
                    latest.setdefault(photo["related_id"], photo["id"])
                for row in records:
                    row["photo_id"] = latest.get(row["id"])
            return jsonify({"data": records, "limit": limit, "offset": offset})
        except Exception:
            current_app.logger.exception("List query failed for %s.", resource)
            return failure("database_error", "Records are temporarily unavailable.", 503)

    @require_user(roles=write_roles)
    def post_collection():
        payload = request.get_json(silent=True)
        assigned_engineer_ids = payload.get("assigned_engineer_ids", []) if isinstance(payload, dict) and resource == "projects" else []
        if isinstance(payload, dict) and resource == "projects":
            payload = {key: value for key, value in payload.items() if key != "assigned_engineer_ids"}
        login_password = None
        if isinstance(payload, dict) and resource == "engineers" and "password" in payload:
            payload = dict(payload)
            login_password = payload.pop("password")
            problem = _login_password_problem(login_password)
            if problem:
                return problem
            if not isinstance(payload.get("email"), str) or not payload["email"].strip():
                return failure("invalid_request", "Enter the employee's email to create their login.", 400)
        validation = validate_payload(rule_resource, payload)
        if validation:
            return failure("invalid_request", validation, 400)
        problem = _service_problem(payload) if resource == "services" else (
            _project_service_problem(payload) if resource == "projects" else None
        )
        if problem:
            return problem
        if login_password and _login_email_taken(payload["email"]):
            return failure("conflict", "A login with this email already exists.", 409)
        if not isinstance(assigned_engineer_ids, list) or any(not isinstance(value, str) for value in assigned_engineer_ids):
            return failure("invalid_request", "assigned_engineer_ids must be a list of engineer IDs.", 400)
        if resource == "engineers" and _engineer_code_taken(payload):
            return failure("conflict", "Another engineer already uses this Engineer ID.", 409)
        if resource == "projects" and "completion_status" in payload:
            return failure("invalid_request", "Submit completion details after the project is created.", 400)
        try:
            if resource == "projects":
                _validate_engineer_ids(assigned_engineer_ids)
            _validate_relationships(resource, payload)
            if resource == "projects":
                _resolve_project_client(payload)
                _clear_unused_custom_dates(payload)
            payload = dict(payload)
            payload["organization_id"] = g.organization_id
            payload["created_by"] = g.user.id
            if login_password:
                # Saved together with the engineer record in one commit.
                payload["user_id"] = _stage_login(payload["email"], payload["full_name"], login_password)
            result = db().table(table).insert(payload).execute().data
            if not result:
                return failure("database_error", "Record was not created.", 503)
            if resource == "projects" and assigned_engineer_ids:
                _replace_project_engineers(result[0]["id"], assigned_engineer_ids)
            return jsonify({"data": result[0]}), 201
        except ValueError as error:
            return failure("invalid_request", str(error), 400)
        except Exception:
            current_app.logger.exception("Create failed for %s.", resource)
            return failure("database_error", "Record could not be created.", 503)

    if request.method == "GET":
        return get_collection()
    return post_collection()


@api.route("/<path:resource>/<item_id>", methods=["GET", "PATCH", "DELETE"])
def item(resource, item_id):
    if resource not in RESOURCES:
        return failure("not_found", "Unknown resource.", 404)
    try:
        uuid.UUID(item_id)
    except ValueError:
        return failure("invalid_request", "Record ID must be a valid UUID.", 400)
    table, write_roles = RESOURCES[resource]
    rule_resource = resource.replace("-", "_")

    @require_user()
    def get_item():
        try:
            rows = record(table, item_id)
            return (jsonify({"data": rows[0]}), 200) if rows else failure("not_found", "Record not found.", 404)
        except Exception:
            current_app.logger.exception("Record lookup failed.")
            return failure("database_error", "Record is temporarily unavailable.", 503)

    @require_user()
    def patch_item():
        submitter = resource == "projects" and g.role == "employee"
        if g.role not in write_roles and not submitter:
            return failure("forbidden", "Your account has view-only access and cannot change records.", 403)
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not payload:
            return failure("invalid_request", "Provide at least one field to update.", 400)
        submitting = resource == "projects" and "completion_date" in payload
        if g.role not in write_roles and (not submitting or set(payload) - COMPLETION_FIELDS):
            return failure("forbidden", "Employees may only submit completion details for their assigned projects.", 403)
        try:
            current_rows = record(table, item_id)
        except Exception:
            current_app.logger.exception("Record lookup failed.")
            return failure("database_error", "Record could not be updated.", 503)
        if not current_rows:
            return failure("not_found", "Record not found.", 404)
        current = current_rows[0]
        assigned_engineer_ids = payload.pop("assigned_engineer_ids", None) if resource == "projects" else None
        if submitting:
            if current.get("approval_status") in {"Pending Approval", "Submitted for Approval"}:
                return failure("conflict", "This completion is already awaiting approval.", 409)
            if current.get("approval_status") == "Approved":
                return failure("conflict", "This completion has already been approved.", 409)
            try:
                payload = _completion_values(payload, current)
            except ValueError as error:
                return failure("invalid_request", str(error), 400)
            images = sqlalchemy_db.session.execute(
                select(uploaded_documents.c.image_type).where(
                    uploaded_documents.c.organization_id == g.organization_id,
                    uploaded_documents.c.related_type == "project",
                    uploaded_documents.c.related_id == item_id,
                    uploaded_documents.c.image_type.in_(("before", "after")),
                ).distinct()
            ).scalars().all()
            missing_images = {"before", "after"} - set(images)
            if missing_images:
                return failure("invalid_request", "Upload both before-work and after-work photos before submitting.", 400)
        login_password = None
        if resource == "engineers" and "password" in payload:
            login_password = payload.pop("password")
            problem = _login_password_problem(login_password)
            if problem:
                return problem
        validation = validate_payload(rule_resource, payload, partial=True, current=current if resource == "projects" else None)
        if validation:
            return failure("invalid_request", validation, 400)
        problem = _service_problem(payload, current) if resource == "services" else (
            _project_service_problem(payload, current) if resource == "projects" else None
        )
        if problem:
            return problem
        login_email = (payload.get("email") or current.get("email") or "").strip() if login_password else ""
        if login_password:
            if not current.get("user_id") and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", login_email):
                return failure("invalid_request", "Enter the employee's email to create their login.", 400)
            if not current.get("user_id") and _login_email_taken(login_email):
                return failure("conflict", "A login with this email already exists.", 409)
            payload["updated_by"] = g.user.id
        if resource == "projects" and {"start_date", "end_date"} & set(payload):
            project_start = payload.get("start_date", current.get("start_date"))
            project_end = payload.get("end_date", current.get("end_date"))
            if project_start and project_end and project_start > project_end:
                return failure("invalid_request", "end_date must be on or after start_date.", 400)
        if assigned_engineer_ids is not None and (
            not isinstance(assigned_engineer_ids, list) or any(not isinstance(value, str) for value in assigned_engineer_ids)
        ):
            return failure("invalid_request", "assigned_engineer_ids must be a list of engineer IDs.", 400)
        if not payload and assigned_engineer_ids is None:
            return failure("invalid_request", "Provide at least one field to update.", 400)
        if resource == "engineers" and "engineer_code" in payload and _engineer_code_taken(payload, item_id):
            return failure("conflict", "Another engineer already uses this Engineer ID.", 409)
        try:
            if login_password:
                if current.get("user_id"):
                    _stage_password_reset(current["user_id"], login_password)
                else:
                    payload["user_id"] = _stage_login(login_email, payload.get("full_name") or current["full_name"], login_password)
            if resource == "projects" and assigned_engineer_ids is not None:
                _validate_engineer_ids(assigned_engineer_ids)
            _validate_relationships(resource, payload)
            if resource == "projects" and "client_name" in payload:
                _resolve_project_client(payload)
            if resource == "projects":
                _clear_unused_custom_dates(payload)
                if "start_date" in payload and payload["start_date"] != current.get("start_date"):
                    # A rescheduled project goes back to its new date's place instead of keeping an old manual slot.
                    payload.update(priority_date=None, priority_rank=None)
            updated = None
            if submitting:
                previous = current.get("approval_status")
                updated = _change_approval(
                    current, "Pending Approval", "Resubmitted" if previous == "Rejected" else "Submitted",
                    {**payload, "rejection_reason": None},
                )
            elif payload:
                payload["updated_by"] = g.user.id
                updated = (
                    db().table(table).update(payload).eq("organization_id", g.organization_id)
                    .eq("id", item_id).is_("deleted_at", "null").execute().data
                )
            if resource == "projects" and assigned_engineer_ids is not None:
                _replace_project_engineers(item_id, assigned_engineer_ids)
            if resource == "services" and payload.get("name") and payload["name"] != current["name"]:
                # Projects and templates refer to a service by name, so a rename carries them along.
                for related in ("projects", "certificate_templates"):
                    db().table(related).update({"service": payload["name"]}).eq(
                        "organization_id", g.organization_id
                    ).eq("service", current["name"]).execute()
            return jsonify({"data": (updated or record(table, item_id))[0]}), 200
        except ApprovalConflict as error:
            return failure("conflict", str(error), 409)
        except ValueError as error:
            return failure("invalid_request", str(error), 400)
        except Exception:
            current_app.logger.exception("Record update failed.")
            return failure("database_error", "Record could not be updated.", 503)

    @require_user(roles=write_roles)
    def delete_item():
        try:
            if resource == "services":
                service = (record(table, item_id) or [None])[0]
                if service and _service_in_use(service):
                    return failure("conflict", "This service is used by projects or certificate templates. Set it to inactive instead.", 409)
            updated = (
                db().table(table).update({
                    "deleted_at": datetime.now(timezone.utc).isoformat(),
                    "updated_by": g.user.id,
                }).eq("organization_id", g.organization_id)
                .eq("id", item_id).is_("deleted_at", "null").execute().data
            )
            return (jsonify({"message": "Record archived."}), 200) if updated else failure("not_found", "Record not found.", 404)
        except Exception:
            current_app.logger.exception("Record archive failed.")
            return failure("database_error", "Record could not be archived.", 503)

    if request.method == "GET":
        return get_item()
    if request.method == "PATCH":
        return patch_item()
    return delete_item()


@api.post("/uploads")
@require_user()
def upload():
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return failure("invalid_request", "Select a file to upload.", 400)
    filename = uploaded.filename.replace("\\", "/").split("/")[-1]
    if len(filename) > 180 or not re.fullmatch(r"[\w .()\-]+", filename, flags=re.UNICODE):
        return failure("invalid_request", "Invalid filename.", 400)
    data = uploaded.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        return failure("file_too_large", "Upload exceeds 15 MB.", 413)
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    valid_xlsx = False
    if extension == "xlsx":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = set(archive.namelist())
                valid_xlsx = "[Content_Types].xml" in entries and "xl/workbook.xml" in entries
        except zipfile.BadZipFile:
            valid_xlsx = False
    signatures = {
        "pdf": data.startswith(b"%PDF-"),
        "png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg": data.startswith(b"\xff\xd8\xff"),
        "jpeg": data.startswith(b"\xff\xd8\xff"),
        "xlsx": valid_xlsx,
        "xls": data.startswith(b"\xd0\xcf\x11\xe0"),
    }
    if not data or not signatures.get(extension, False):
        return failure("invalid_file", "Only valid PDF, Excel, PNG, or JPEG files are accepted.", 400)
    content_type = {
        "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
        "jpeg": "image/jpeg", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls": "application/vnd.ms-excel",
    }[extension]
    related_type, related_id = request.form.get("related_type"), request.form.get("related_id")
    image_type = request.form.get("image_type")
    if related_type not in {"project", "client", "cleaning_record", "water_testing", "engineer"} or not related_id:
        return failure("invalid_request", "A valid related_type and related_id are required.", 400)
    profile_photo = related_type == "engineer"
    if profile_photo and (image_type != "profile" or extension not in {"png", "jpg", "jpeg"}):
        return failure("invalid_request", "Engineer photos must be PNG or JPEG images.", 400)
    if image_type and not profile_photo and (related_type != "project" or image_type not in {"before", "after"}):
        return failure("invalid_request", "image_type must be before or after for project images.", 400)
    if g.role == "viewer":
        return failure("forbidden", "Your account has view-only access and cannot upload files.", 403)
    if g.role == "employee" and not profile_photo and (related_type != "project" or extension not in {"png", "jpg", "jpeg"} or image_type not in {"before", "after"}):
        return failure("forbidden", "Employees may only upload project completion images and their own photo.", 403)
    try:
        uuid.UUID(related_id)
    except ValueError:
        return failure("invalid_request", "related_id must be a valid record ID.", 400)
    table = {"project": "projects", "client": "clients", "cleaning_record": "cleaning_records", "water_testing": "water_testing_records", "engineer": "engineers"}[related_type]
    storage_path = None
    try:
        # An employee can only find their own engineer profile, so this is also the "own photo only" check.
        if not record(table, related_id):
            return failure("not_found", "Related record not found.", 404)
        storage_path = f"{g.organization_id}/{related_type}/{related_id}/{uuid.uuid4().hex}-{secure_filename(filename)}"
        upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
        destination = (upload_root / storage_path).resolve()
        if not destination.is_relative_to(upload_root):
            return failure("invalid_request", "Invalid upload destination.", 400)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        metadata = db().table("uploaded_documents").insert({
            "organization_id": g.organization_id, "related_type": related_type,
            "related_id": related_id, "original_filename": filename, "storage_path": storage_path,
            "mime_type": content_type, "file_size": len(data), "uploaded_by": g.user.id,
            "image_type": image_type,
        }).execute().data
        if profile_photo:
            _retire_old_profile_photos(related_id, metadata[0]["id"])
        return jsonify({"data": metadata[0]}), 201
    except Exception:
        if storage_path:
            try:
                upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
                (upload_root / storage_path).resolve().unlink(missing_ok=True)
            except Exception:
                current_app.logger.exception("Could not clean up an incomplete document upload.")
        current_app.logger.exception("Document upload failed.")
        return failure("upload_failed", "The document could not be stored.", 503)


@api.post("/projects/<project_id>/move")
@require_user(roles=EDITORS)
def move_project(project_id):
    """Place a project between the projects shown directly above and below it after a drag."""
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) - {"above_id", "below_id"}:
        return failure("invalid_request", "Provide above_id and/or below_id.", 400)
    above_id, below_id = payload.get("above_id"), payload.get("below_id")
    neighbours = [value for value in (above_id, below_id) if value is not None]
    if not neighbours:
        return failure("invalid_request", "Provide the project above or below the new position.", 400)
    try:
        for value in [project_id, *neighbours]:
            uuid.UUID(value)
    except (TypeError, ValueError, AttributeError):
        return failure("invalid_request", "Project IDs must be valid record IDs.", 400)
    if project_id in neighbours or above_id == below_id:
        return failure("invalid_request", "A project cannot be placed next to itself.", 400)
    try:
        found = {row["id"]: row for row in scoped_query("projects").in_("id", [project_id, *neighbours]).execute().data or []}
        if len(found) != len(neighbours) + 1:
            return failure("not_found", "Project not found.", 404)
        anchor = found[below_id] if below_id else found[above_id]
        slot = anchor.get("priority_date") or _project_day(anchor) or NO_DATE
        # Renumber the whole date slot so ties and earlier moves can never leave the project out of place.
        slot_rows = in_project_order(db().table("projects").select("id")).eq(
            "organization_id", g.organization_id
        ).is_("deleted_at", "null").where(project_order_key() == slot).execute().data or []
        ids = [row["id"] for row in slot_rows if row["id"] != project_id]
        if below_id in ids:
            position = ids.index(below_id)
        elif above_id in ids:
            position = ids.index(above_id) + 1
        else:
            position = len(ids)
        ids.insert(position, project_id)
        now, session = datetime.now(timezone.utc).isoformat(), sqlalchemy_db.session
        try:
            for rank, item_id in enumerate(ids):
                values = {"priority_date": slot, "priority_rank": float(rank)}
                if item_id == project_id:
                    values.update(updated_by=g.user.id, updated_at=now)
                session.execute(projects.update().where(
                    projects.c.organization_id == g.organization_id, projects.c.id == item_id,
                ).values(**values))
            session.commit()
        except Exception:
            session.rollback()
            raise
        return jsonify({"data": record("projects", project_id)[0]})
    except Exception:
        current_app.logger.exception("Project reorder failed.")
        return failure("database_error", "The new order could not be saved.", 503)


@api.post("/projects/order/reset")
@require_user(roles=EDITORS)
def reset_project_order():
    try:
        sqlalchemy_db.session.execute(projects.update().where(
            projects.c.organization_id == g.organization_id,
        ).values(priority_date=None, priority_rank=None))
        sqlalchemy_db.session.commit()
        return jsonify({"message": "Projects are back in date order."})
    except Exception:
        sqlalchemy_db.session.rollback()
        current_app.logger.exception("Project order reset failed.")
        return failure("database_error", "The order could not be reset.", 503)


def _project_day(project):
    return project.get("start_date") or project.get("scheduled_date") or project.get("contract_period")


@api.post("/projects/<project_id>/approve")
@require_user(roles=APPROVERS)
def approve_project(project_id):
    return _decide_completion(project_id, approve=True)


@api.post("/projects/<project_id>/reject")
@require_user(roles=APPROVERS)
def reject_project(project_id):
    return _decide_completion(project_id, approve=False)


def _decide_completion(project_id, approve):
    try:
        uuid.UUID(project_id)
    except ValueError:
        return failure("invalid_request", "Project ID must be a valid UUID.", 400)
    reason = None
    if not approve:
        payload = request.get_json(silent=True)
        reason = payload.get("reason") if isinstance(payload, dict) else None
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            return failure("invalid_request", "Enter a rejection reason of up to 2000 characters.", 400)
        reason = reason.strip()
    try:
        rows = record("projects", project_id)
        if not rows:
            return failure("not_found", "Project not found.", 404)
        if rows[0].get("approval_status") not in {"Pending Approval", "Submitted for Approval"}:
            return failure("conflict", "Only completions that are awaiting approval can be approved or rejected.", 409)
        values = {"status": "Completed", "rejection_reason": None} if approve else {"rejection_reason": reason}
        updated = _change_approval(rows[0], "Approved" if approve else "Rejected", "Approved" if approve else "Rejected", values, reason)
        return jsonify({"data": updated[0]})
    except ApprovalConflict as error:
        return failure("conflict", str(error), 409)
    except Exception:
        current_app.logger.exception("Approval decision failed.")
        return failure("database_error", "The approval decision could not be saved.", 503)


@api.get("/approvals")
@require_user()
def list_approvals():
    status = request.args.get("status", "Pending Approval")
    if status not in APPROVAL_STATUSES:
        return failure("invalid_request", "Unsupported approval status.", 400)
    try:
        rows = scoped_query("projects").eq("approval_status", status).order("updated_at", desc=True).limit(200).execute().data or []
        return jsonify({"data": rows})
    except Exception:
        current_app.logger.exception("Approval list failed.")
        return failure("database_error", "Approvals are temporarily unavailable.", 503)


@api.get("/approval-history")
@require_user()
def list_approval_history():
    project_id = request.args.get("project_id")
    try:
        query = db().table("approval_history").select("*").eq("organization_id", g.organization_id)
        if project_id:
            try:
                uuid.UUID(project_id)
            except ValueError:
                return failure("invalid_request", "project_id must be a valid record ID.", 400)
            if not record("projects", project_id):
                return failure("not_found", "Project not found.", 404)
            query = query.eq("project_id", project_id)
        elif g.role == "employee":
            visible = [row["id"] for row in scoped_query("projects", "id").execute().data or []]
            if not visible:
                return jsonify({"data": []})
            query = query.in_("project_id", visible)
        rows = query.order("created_at", desc=True).limit(200).execute().data or []
        return jsonify({"data": rows})
    except Exception:
        current_app.logger.exception("Approval history query failed.")
        return failure("database_error", "Approval history is temporarily unavailable.", 503)


@api.get("/dashboard/locations")
@require_user()
def dashboard_locations():
    try:
        query = scoped_query("projects").is_not("latitude", "null").is_not("longitude", "null")
        if request.args.get("client_id"):
            query = query.eq("client_id", request.args["client_id"])
        rows = query.limit(1000).execute().data or []
        client_ids = list({row["client_id"] for row in rows if not row.get("client_name") and row.get("client_id")})
        clients = db().table("clients").select("id,name").eq(
            "organization_id", g.organization_id
        ).in_("id", client_ids).execute().data if client_ids else []
        client_names = {client["id"]: client["name"] for client in clients or []}
        fields = (
            "id", "name", "service", "so_no", "engineer_name", "status", "approval_status", "location",
            "latitude", "longitude", "start_date", "end_date", "visit_time", "system_details", "description",
            "engineer_visit", "engineer_visit_custom_date",
        )
        return jsonify({"data": [
            {**{field: row.get(field) for field in fields},
             "client_name": row.get("client_name") or client_names.get(row.get("client_id"))}
            for row in rows
        ]})
    except Exception:
        current_app.logger.exception("Project location query failed.")
        return failure("database_error", "Project locations are temporarily unavailable.", 503)


@api.delete("/projects/<project_id>/permanent")
@require_user(roles=EDITORS)
def permanently_delete_project(project_id):
    try:
        uuid.UUID(project_id)
    except ValueError:
        return failure("invalid_request", "Project ID must be a valid UUID.", 400)

    try:
        if not record("projects", project_id):
            return failure("not_found", "Project not found.", 404)
        documents = scoped_query("uploaded_documents").eq(
            "related_type", "project"
        ).eq("related_id", project_id).execute().data or []
        upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
        paths = []
        for document in documents:
            path = (upload_root / document["storage_path"]).resolve()
            if not path.is_relative_to(upload_root):
                return failure("storage_error", "A project document has an invalid storage path.", 503)
            if path.is_file():
                paths.append(path)

        with tempfile.TemporaryDirectory(dir=upload_root) as quarantine:
            staged = []
            try:
                for index, path in enumerate(paths):
                    staged_path = Path(quarantine) / str(index)
                    os.replace(path, staged_path)
                    staged.append((staged_path, path))

                with sqlalchemy_db.engine.begin() as connection:
                    connection.execute(
                        project_tasks.delete().where(
                            project_tasks.c.organization_id == g.organization_id,
                            project_tasks.c.project_id == project_id,
                        )
                    )
                    connection.execute(
                        water_testing_records.update().where(
                            water_testing_records.c.organization_id == g.organization_id,
                            water_testing_records.c.project_id == project_id,
                        ).values(project_id=None)
                    )
                    connection.execute(
                        project_engineers.delete().where(
                            project_engineers.c.organization_id == g.organization_id,
                            project_engineers.c.project_id == project_id,
                        )
                    )
                    # Approval history is kept; its reference text still names the deleted project.
                    connection.execute(
                        approval_history.update().where(
                            approval_history.c.organization_id == g.organization_id,
                            approval_history.c.project_id == project_id,
                        ).values(project_id=None)
                    )
                    connection.execute(
                        uploaded_documents.delete().where(
                            uploaded_documents.c.organization_id == g.organization_id,
                            uploaded_documents.c.related_type == "project",
                            uploaded_documents.c.related_id == project_id,
                        )
                    )
                    result = connection.execute(
                        projects.delete().where(
                            projects.c.organization_id == g.organization_id,
                            projects.c.id == project_id,
                        )
                    )
                    if result.rowcount != 1:
                        raise RuntimeError("Project was removed while deletion was in progress.")
            except Exception:
                for staged_path, original_path in reversed(staged):
                    if staged_path.exists():
                        os.replace(staged_path, original_path)
                raise

        return jsonify({"message": "Project and its saved documents were permanently deleted."})
    except Exception:
        current_app.logger.exception("Permanent project deletion failed.")
        return failure("database_error", "Project and its saved documents could not be deleted.", 503)


def _replace_project_engineers(project_id, engineer_ids):
    _validate_engineer_ids(engineer_ids)
    client = db()
    client.table("project_engineers").update({"updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("project_id", project_id).execute()
    client.table("project_engineers").delete().eq(
        "organization_id", g.organization_id
    ).eq("project_id", project_id).execute()
    if engineer_ids:
        client.table("project_engineers").insert([
            {
                "organization_id": g.organization_id, "project_id": project_id,
                "engineer_id": engineer_id, "created_by": g.user.id,
            }
            for engineer_id in sorted(set(engineer_ids))
        ]).execute()


def _resolve_project_client(payload):
    name = payload.get("client_name")
    if not isinstance(name, str) or not name.strip():
        return
    name = name.strip()
    clients_found = db().table("clients").select("id").eq(
        "organization_id", g.organization_id
    ).eq("name", name).is_("deleted_at", "null").limit(1).execute().data or []
    if clients_found:
        payload["client_id"] = clients_found[0]["id"]
        payload["client_name"] = name
        return
    created = db().table("clients").insert({
        "organization_id": g.organization_id, "name": name, "created_by": g.user.id,
    }).execute().data
    if not created:
        raise ValueError("The project client could not be saved.")
    payload["client_id"] = created[0]["id"]
    payload["client_name"] = name


def _completion_values(payload, project):
    completion_date = payload.get("completion_date")
    engineer_name = payload.get("completion_engineer_name")
    invoice_number = payload.get("invoice_number")
    scheduled_date = project.get("start_date") or project.get("scheduled_date") or project.get("contract_period")
    if not scheduled_date:
        raise ValueError("The project must have a scheduled date before completion can be submitted.")
    try:
        scheduled = date.fromisoformat(scheduled_date)
        actual = date.fromisoformat(completion_date)
    except (TypeError, ValueError):
        raise ValueError("Enter a valid actual completion date.")
    payload["completion_status"] = (
        "Completed Before the Scheduled Date" if actual < scheduled
        else "Completed After the Scheduled Date" if actual > scheduled
        else "Completed on the Scheduled Date"
    )
    if not isinstance(engineer_name, str) or not engineer_name.strip():
        raise ValueError("Enter the engineer name.")
    if not isinstance(invoice_number, str) or not invoice_number.strip():
        raise ValueError("Enter the invoice number.")
    # The project becomes Completed only when an approver approves the submission.
    payload.pop("status", None)
    payload["completion_date"] = actual.isoformat()
    payload["completion_engineer_name"] = engineer_name.strip()
    payload["invoice_number"] = invoice_number.strip()
    return payload


def _retire_old_profile_photos(engineer_id, keep_id):
    old = scoped_query("uploaded_documents").eq("related_type", "engineer").eq("related_id", engineer_id).execute().data or []
    upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
    for row in old:
        if row["id"] == keep_id:
            continue
        db().table("uploaded_documents").update({"deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id}).eq(
            "organization_id", g.organization_id
        ).eq("id", row["id"]).execute()
        path = (upload_root / row["storage_path"]).resolve()
        if path.is_relative_to(upload_root):
            path.unlink(missing_ok=True)


def _login_password_problem(password):
    if g.role != "administrator":
        return failure("forbidden", "Only administrators can set employee sign-in details.", 403)
    if not isinstance(password, str) or not 12 <= len(password) <= 512:
        return failure("invalid_request", "The password must be 12 to 512 characters.", 400)
    return None


def _login_email_taken(email):
    return sqlalchemy_db.session.execute(select(users.c.id).where(users.c.email == email.strip().lower())).first() is not None


def _stage_login(email, full_name, password):
    """Add an employee user and membership to the open transaction; the caller commits it with the engineer."""
    user_id, now = str(uuid4()), datetime.now(timezone.utc).isoformat()
    sqlalchemy_db.session.execute(users.insert().values(
        id=user_id, email=email.strip().lower(), full_name=str(full_name).strip(),
        password_hash=generate_password_hash(password), is_active=True, created_at=now, updated_at=now,
    ))
    sqlalchemy_db.session.execute(memberships.insert().values(
        id=str(uuid4()), organization_id=g.organization_id, user_id=user_id, role="employee", status="active", created_at=now,
    ))
    return user_id


def _stage_password_reset(user_id, password):
    role = sqlalchemy_db.session.execute(select(memberships.c.role).where(
        memberships.c.user_id == user_id, memberships.c.organization_id == g.organization_id,
    )).scalar()
    if role in ADMIN_LOGIN_ROLES:
        raise ValueError("Admin-level passwords cannot be changed from the Engineers page.")
    sqlalchemy_db.session.execute(users.update().where(users.c.id == user_id).values(
        password_hash=generate_password_hash(password), updated_at=datetime.now(timezone.utc).isoformat(),
    ))


def _engineer_code_taken(payload, engineer_id=None):
    payload["engineer_code"] = payload["engineer_code"].strip()
    statement = select(engineers.c.id).where(
        engineers.c.organization_id == g.organization_id,
        sqlalchemy_db.func.lower(engineers.c.engineer_code) == payload["engineer_code"].lower(),
    )
    if engineer_id:
        statement = statement.where(engineers.c.id != engineer_id)
    return sqlalchemy_db.session.execute(statement.limit(1)).first() is not None


def _clear_unused_custom_dates(payload):
    for _, frequency_key, date_key in FREQUENCY_FIELDS:
        if frequency_key in payload and payload[frequency_key] != "Custom":
            payload[date_key] = None


def _project_reference(project):
    parts = [project.get("client_name"), project.get("name"), f"SO {project['so_no']}" if project.get("so_no") is not None else None]
    return " · ".join(str(part) for part in parts if part)[:600] or project["id"]


def _change_approval(project, new_status, action, values=None, reason=None):
    """Move a project to a new approval status and record the change in one transaction."""
    previous, now = project.get("approval_status"), datetime.now(timezone.utc).isoformat()
    session = sqlalchemy_db.session
    try:
        result = session.execute(projects.update().where(
            projects.c.organization_id == g.organization_id,
            projects.c.id == project["id"],
            projects.c.deleted_at.is_(None),
            projects.c.approval_status.is_(None) if previous is None else projects.c.approval_status == previous,
        ).values(**(values or {}), approval_status=new_status, updated_by=g.user.id, updated_at=now))
        if result.rowcount != 1:
            raise ApprovalConflict("The approval status changed while you were working. Reload and try again.")
        session.execute(approval_history.insert().values(
            id=str(uuid4()), organization_id=g.organization_id, project_id=project["id"],
            reference=_project_reference({**project, **(values or {})}),
            previous_status=previous or "Pending", new_status=new_status, action=action, reason=reason,
            actor_id=g.user.id, actor_name=g.user.full_name or g.user.email, created_at=now,
        ))
        session.commit()
    except Exception:
        session.rollback()
        raise
    return record("projects", project["id"])


def _validate_engineer_ids(engineer_ids):
    client = db()
    valid = client.table("engineers").select("id").eq(
        "organization_id", g.organization_id
    ).eq("is_active", True).is_("deleted_at", "null").in_("id", engineer_ids).execute().data if engineer_ids else []
    if len(valid or []) != len(set(engineer_ids)):
        raise ValueError("Engineer assignment includes a record outside this organization.")


def _validate_relationships(resource, payload):
    relationships = {
        "projects": {"client_id": "clients"},
        "project_tasks": {"project_id": "projects", "engineer_id": "engineers"},
        "cleaning-records": {"client_id": "clients", "engineer_id": "engineers"},
        "water-testing": {
            "client_id": "clients", "project_id": "projects", "engineer_id": "engineers",
        },
    }.get(resource, {})
    valid_rows = {}
    for field, table in relationships.items():
        item_id = payload.get(field)
        if not item_id:
            continue
        selected_fields = "id,client_id" if "client_id" in db().table(table).table.c else "id"
        query = db().table(table).select(selected_fields).eq(
            "organization_id", g.organization_id
        ).eq("id", item_id).is_("deleted_at", "null")
        if table == "engineers":
            query = query.eq("is_active", True)
        rows = query.limit(1).execute().data or []
        if not rows:
            raise ValueError(f"{field} is not available in this organization.")
        valid_rows[field] = rows[0]
    if resource == "water-testing" and payload.get("project_id") and payload.get("client_id"):
        if valid_rows["project_id"].get("client_id") != payload["client_id"]:
            raise ValueError("project_id must belong to the selected client.")
    if resource == "project_tasks" and payload.get("engineer_id") and payload.get("project_id"):
        assignment = db().table("project_engineers").select("engineer_id").eq(
            "organization_id", g.organization_id
        ).eq("project_id", payload["project_id"]).eq(
            "engineer_id", payload["engineer_id"]
        ).limit(1).execute().data or []
        if not assignment:
            raise ValueError("engineer_id must be assigned to this project.")


@api.route("/settings", methods=["GET", "PATCH"])
@require_user()
def settings():
    try:
        client = db()
        if request.method == "GET":
            org_rows = client.table("organization_settings").select("*").eq(
                "organization_id", g.organization_id
            ).limit(1).execute().data or []
            user_rows = client.table("user_settings").select("*").eq(
                "organization_id", g.organization_id
            ).eq("user_id", g.user.id).limit(1).execute().data or []
            return jsonify({"organization": org_rows[0] if org_rows else {}, "user": user_rows[0] if user_rows else {}})
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) - {"organization", "user"}:
            return failure("invalid_request", "Provide organization and/or user settings.", 400)
        response, now = {}, datetime.now(timezone.utc).isoformat()
        if "organization" in payload:
            if g.role != "administrator":
                return failure("forbidden", "Only administrators can change organization settings.", 403)
            values = payload["organization"]
            validation = validate_settings("organization", values)
            if validation:
                return failure("invalid_request", validation, 400)
            previous = client.table("organization_settings").select("*").eq(
                "organization_id", g.organization_id
            ).limit(1).execute().data or []
            response["organization"] = client.table("organization_settings").upsert(
                {"organization_id": g.organization_id, **(previous[0] if previous else {}), **values, "updated_at": now},
                on_conflict="organization_id",
            ).execute().data
        if "user" in payload:
            values = payload["user"]
            validation = validate_settings("user", values)
            if validation:
                return failure("invalid_request", validation, 400)
            previous = client.table("user_settings").select("*").eq(
                "organization_id", g.organization_id
            ).eq("user_id", g.user.id).limit(1).execute().data or []
            response["user"] = client.table("user_settings").upsert(
                {"organization_id": g.organization_id, "user_id": g.user.id, **(previous[0] if previous else {}), **values, "updated_at": now},
                on_conflict="organization_id,user_id",
            ).execute().data
        return jsonify(response)
    except Exception:
        current_app.logger.exception("Settings operation failed.")
        return failure("database_error", "Settings could not be saved.", 503)


@api.get("/uploads/<file_id>")
@require_user()
def download(file_id):
    try:
        uuid.UUID(file_id)
    except ValueError:
        return failure("invalid_request", "File ID must be a valid UUID.", 400)
    try:
        files = scoped_query("uploaded_documents").eq("id", file_id).limit(1).execute().data or []
        if not files:
            return failure("not_found", "File not found.", 404)
        # Engineer photos are shown to everyone in the organization; other files follow the project rules.
        if g.role == "employee" and files[0]["related_type"] != "engineer" and (
            files[0]["related_type"] != "project" or not record("projects", files[0]["related_id"])
        ):
            return failure("not_found", "File not found.", 404)
        upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
        path = (upload_root / files[0]["storage_path"]).resolve()
        if not path.is_relative_to(upload_root) or not path.is_file():
            return failure("not_found", "File not found.", 404)
        return send_file(
            path, mimetype=files[0]["mime_type"],
            as_attachment=not (request.args.get("inline") == "1" and files[0]["mime_type"].startswith("image/")),
            download_name=files[0]["original_filename"],
        )
    except Exception:
        current_app.logger.exception("Signed download URL creation failed.")
        return failure("storage_error", "The document is temporarily unavailable.", 503)


@api.get("/uploads")
@require_user()
def list_uploads():
    related_type, related_id = request.args.get("related_type"), request.args.get("related_id")
    try:
        query = scoped_query("uploaded_documents")
        if related_type:
            if related_type not in {"project", "client", "cleaning_record", "water_testing", "engineer"}:
                return failure("invalid_request", "Unsupported related_type.", 400)
        if bool(related_type) != bool(related_id):
            return failure("invalid_request", "related_type and related_id must be provided together.", 400)
        if related_type:
            query = query.eq("related_type", related_type)
        if related_id:
            try:
                uuid.UUID(related_id)
            except ValueError:
                return failure("invalid_request", "related_id must be a valid record ID.", 400)
            if g.role == "employee" and (
                related_type != "project" or not record("projects", related_id)
            ):
                return failure("not_found", "Related project not found.", 404)
            query = query.eq("related_id", related_id)
        elif g.role == "employee":
            return failure("invalid_request", "Employees must request images for one assigned project.", 400)
        files = query.order("created_at", desc=True).limit(200).execute().data or []
        return jsonify({"data": files})
    except Exception:
        current_app.logger.exception("Document listing failed.")
        return failure("storage_error", "Documents are temporarily unavailable.", 503)


@api.delete("/uploads/<file_id>")
@require_user(roles=EDITORS)
def delete_upload(file_id):
    try:
        files = scoped_query("uploaded_documents").eq("id", file_id).limit(1).execute().data or []
        if not files:
            return failure("not_found", "File not found.", 404)
        file_row = files[0]
        upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
        path = (upload_root / file_row["storage_path"]).resolve()
        if not path.is_relative_to(upload_root):
            return failure("not_found", "File not found.", 404)
        path.unlink(missing_ok=True)
        db().table("uploaded_documents").update({
            "deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id,
        }).eq("organization_id", g.organization_id).eq("id", file_id).execute()
        return jsonify({"message": "File deleted."})
    except Exception:
        current_app.logger.exception("Document deletion failed.")
        return failure("storage_error", "The document could not be deleted.", 503)


@api.get("/reports/export")
@require_user()
def export_report():
    resource = request.args.get("resource", "projects")
    mapping = {
        "projects": ("projects", "projects"),
        "cleaning": ("cleaning_records", "cleaning-records"),
        "water-testing": ("water_testing_records", "water-testing"),
        "clients": ("clients", "clients"),
        "engineers": ("engineers", "engineers"),
    }
    if resource not in mapping:
        return failure("invalid_request", "Unsupported report resource.", 400)
    table, _ = mapping[resource]
    output_format = request.args.get("format", "csv").lower()
    if output_format not in {"csv", "xlsx", "pdf"}:
        return failure("invalid_request", "format must be csv, xlsx, or pdf.", 400)
    try:
        query = apply_list_filters(table, scoped_query(table), request.args)
    except ValueError as error:
        return failure("invalid_request", str(error), 400)
    try:
        filter_fields = {
            "projects": {"status", "category", "engineer_id"},
            "cleaning": {"status", "engineer_id"},
            "water-testing": {"status", "engineer_id"},
            "clients": set(),
            "engineers": set(),
        }[resource]
        if any(request.args.get(key) for key in {"status", "engineer_id", "category"} - filter_fields):
            return failure("invalid_request", "A filter is not supported for this report.", 400)
        for key in filter_fields - {"engineer_id"}:
            if request.args.get(key):
                query = query.eq(key, request.args[key])
        if request.args.get("engineer_id"):
            if resource == "projects":
                assigned = db().table("project_engineers").select("project_id").eq(
                    "organization_id", g.organization_id
                ).eq("engineer_id", request.args["engineer_id"]).execute().data or []
                project_ids = list({row["project_id"] for row in assigned})
                query = query.in_("id", project_ids) if project_ids else query.eq("id", "00000000-0000-0000-0000-000000000000")
            else:
                query = query.eq("engineer_id", request.args["engineer_id"])
        query = in_project_order(query) if table == "projects" else query.order("created_at", desc=True)
        rows = query.limit(5000).execute().data or []
        schedule = None
        if resource == "projects":
            missing = list({row["client_id"] for row in rows if not row.get("client_name") and row.get("client_id")})
            found = db().table("clients").select("id,name").eq("organization_id", g.organization_id).in_("id", missing).execute().data if missing else []
            schedule = schedule_rows(rows, {client["id"]: client["name"] for client in found or []})
        fields = [field for field in rows[0] if field not in {"organization_id", "deleted_at"}] if rows else []
        basename = f"watercare-{resource}-report"
        if output_format == "csv":
            output = io.StringIO()
            if schedule is not None:
                writer = csv.writer(output)
                writer.writerow(SCHEDULE_HEADERS)
                writer.writerows([[safe_spreadsheet_value(value) for value in line] for line in schedule])
            elif rows:
                writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                writer.writerows([
                    {key: safe_spreadsheet_value(value) for key, value in row.items()}
                    for row in rows
                ])
            raw = io.BytesIO(output.getvalue().encode("utf-8-sig"))
            mime, extension = "text/csv", "csv"
        elif output_format == "xlsx":
            from openpyxl import Workbook
            if schedule is not None:
                workbook = schedule_workbook(schedule, safe_spreadsheet_value)
            else:
                workbook = Workbook()
                sheet = workbook.active
                sheet.title = resource[:31]
                if fields:
                    sheet.append(fields)
                    for row in rows:
                        sheet.append([
                            safe_spreadsheet_value(
                                str(row.get(field, "")) if isinstance(row.get(field), (dict, list)) else row.get(field)
                            )
                            for field in fields
                        ])
            raw = io.BytesIO()
            workbook.save(raw)
            mime, extension = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
        else:
            from reportlab.lib import colors
            from reportlab.lib.pagesizes import landscape, letter
            from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
            raw = io.BytesIO()
            if schedule is not None:
                data = [SCHEDULE_HEADERS] + [[str(value)[:200] for value in line] for line in schedule]
            else:
                data = [fields or ["No records found"]] + [[str(row.get(field, ""))[:200] for field in fields] for row in rows]
            pdf = SimpleDocTemplate(raw, pagesize=landscape(letter))
            table = Table(data, repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#142B35")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
            ]))
            pdf.build([table])
            mime, extension = "application/pdf", "pdf"
        raw.seek(0)
        return send_file(raw, mimetype=mime, as_attachment=True, download_name=f"{basename}.{extension}")
    except Exception:
        current_app.logger.exception("Report export failed.")
        return failure("database_error", "Report could not be generated.", 503)

DEFAULT_SERVICES = (
    ("Water testing", "Water quality testing and sampling.", "Water Quality Testing"),
    ("Tank cleaning", "Cleaning and disinfection of water tanks.", "Domestic Water Tank and Pipeline Network."),
)
DEFAULT_VALIDITY_MONTHS = 6


def ensure_default_services():
    """A new company starts with the two original services; after that the Services page owns the list."""
    if db().table("services").select("id").eq("organization_id", g.organization_id).limit(1).execute().data:
        return
    for name, description, certificate_text in DEFAULT_SERVICES:
        db().table("services").insert({
            "organization_id": g.organization_id, "name": name, "description": description,
            "certificate_text": certificate_text, "validity_months": DEFAULT_VALIDITY_MONTHS, "is_active": True,
            "created_by": g.user.id, "updated_by": g.user.id,
        }).execute()


def _service_by_name(name, active_only=False):
    query = scoped_query("services").ilike("name", name or "")
    rows = [row for row in query.limit(20).execute().data or [] if row["name"].lower() == (name or "").lower()]
    return next((row for row in rows if row.get("is_active") or not active_only), None)


def _service_problem(payload, current=None):
    """Checks for the Services page: name is unique, validity is a sensible number of months."""
    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name or len(name) > 120:
            return failure("invalid_request", "Service name must be 1 to 120 characters.", 400)
        payload["name"] = name
        duplicate = _service_by_name(name)
        if duplicate and (not current or duplicate["id"] != current["id"]):
            return failure("conflict", "A service with this name already exists.", 409)
    months = payload.get("validity_months")
    if months is not None and not 1 <= int(months) <= 120:
        return failure("invalid_request", "Certificate validity must be between 1 and 120 months.", 400)
    if current is None:
        payload.setdefault("validity_months", DEFAULT_VALIDITY_MONTHS)
        payload.setdefault("is_active", True)
    return None


def _project_service_problem(payload, current=None):
    """A project's service must be one of the company's active services (an unchanged value is always kept)."""
    if "service" not in payload or (current and payload["service"] == current.get("service")):
        return None
    ensure_default_services()
    if not _service_by_name(payload["service"], active_only=True):
        return failure("invalid_request", "Choose one of the services set up on the Services page.", 400)
    return None


def _service_in_use(service):
    projects_using = scoped_query("projects").eq("service", service["name"]).limit(1).execute().data
    templates_using = scoped_query("certificate_templates").eq("service", service["name"]).limit(1).execute().data
    return bool(projects_using or templates_using)


def _template_row(template_id):
    try:
        uuid.UUID(template_id)
    except ValueError:
        return None
    rows = scoped_query("certificate_templates").eq("id", template_id).limit(1).execute().data
    return rows[0] if rows else None


def _template_bytes(row):
    root = Path(current_app.config["STORAGE_PATH"]).resolve()
    path = (root / row["storage_path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path.read_bytes()


@api.get("/certificate-templates")
@require_user(EDITORS)
def list_certificate_templates():
    rows = scoped_query("certificate_templates").order("created_at", desc=True).limit(200).execute().data or []
    for row in rows:
        row.pop("storage_path", None)
        row.pop("tags", None)
    return jsonify({"data": rows})


@api.post("/certificate-templates")
@require_user(EDITORS)
def upload_certificate_template():
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return failure("invalid_request", "Choose a PowerPoint (.pptx) or Word (.docx) file.", 400)
    filename = uploaded.filename.replace("\\", "/").split("/")[-1]
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in certs.EXTENSIONS or len(filename) > 180:
        return failure("invalid_file", "Only editable PowerPoint (.pptx) or Word (.docx) files are accepted.", 400)
    ensure_default_services()
    service = _service_by_name((request.form.get("service") or "").strip(), active_only=True)
    if not service:
        return failure("invalid_request", "Choose the certificate type.", 400)
    data = uploaded.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        return failure("file_too_large", "Template exceeds 15 MB.", 413)
    if not data or not certs.check_template(data, extension):
        return failure("invalid_file", f"That file is not a valid .{extension} document.", 400)
    name = (request.form.get("name") or filename.rsplit(".", 1)[0]).strip()[:200]
    storage_path = f"{g.organization_id}/certificate-templates/{uuid.uuid4().hex}-{secure_filename(filename)}"
    root = Path(current_app.config["STORAGE_PATH"]).resolve()
    destination = (root / storage_path).resolve()
    if not destination.is_relative_to(root):
        return failure("invalid_request", "Invalid upload destination.", 400)
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        row = db().table("certificate_templates").insert({
            "organization_id": g.organization_id, "name": name, "service": service["name"],
            "original_filename": filename, "file_type": extension, "storage_path": storage_path,
            "file_size": len(data), "tags": certs.template_tags(data, extension),
            "created_by": g.user.id, "updated_by": g.user.id,
        }).execute().data[0]
    except Exception:
        destination.unlink(missing_ok=True)
        current_app.logger.exception("Certificate template upload failed.")
        return failure("storage_error", "The template could not be saved.", 503)
    row.pop("storage_path", None)
    row.pop("tags", None)
    return jsonify({"data": row}), 201


@api.delete("/certificate-templates/<template_id>")
@require_user(EDITORS)
def delete_certificate_template(template_id):
    row = _template_row(template_id)
    if not row:
        return failure("not_found", "Template not found.", 404)
    db().table("certificate_templates").update({
        "deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id,
    }).eq("organization_id", g.organization_id).eq("id", template_id).execute()
    root = Path(current_app.config["STORAGE_PATH"]).resolve()
    (root / row["storage_path"]).resolve().unlink(missing_ok=True)
    return jsonify({"message": "Template deleted."})


@api.get("/projects/<project_id>/certificate")
@require_user()
def project_certificate(project_id):
    """The client's Download certificate button: filled from the saved template for the project's service."""
    try:
        uuid.UUID(project_id)
    except ValueError:
        return failure("invalid_request", "Project ID must be a valid UUID.", 400)
    found = record("projects", project_id)
    if not found:
        return failure("not_found", "Project not found.", 404)
    project = found[0]
    if project.get("approval_status") != "Approved":
        return failure("conflict", "The certificate is available once the admin approves the work completion.", 409)
    ensure_default_services()
    service = _service_by_name(project.get("service")) or {}
    templates = scoped_query("certificate_templates").eq("service", project.get("service")).order(
        "created_at", desc=True
    ).limit(1).execute().data
    if not templates:
        return failure("not_found", f"No certificate template is saved for {project.get('service')} yet. Please contact the admin.", 404)
    template = templates[0]
    data = _template_bytes(template)
    if data is None:
        return failure("not_found", "The certificate template file is missing. Please contact the admin.", 404)
    try:
        completed = date.fromisoformat(str(project.get("completion_date") or "")[:10])
    except ValueError:
        completed = date.today()
    expiry = certs.add_months(completed, service.get("validity_months") or DEFAULT_VALIDITY_MONTHS)
    client_name = project.get("client_name")
    if not client_name and project.get("client_id"):
        client_rows = db().table("clients").select("name").eq("organization_id", g.organization_id).eq("id", project["client_id"]).execute().data
        client_name = client_rows[0]["name"] if client_rows else ""
    start, end = month_year(project.get("start_date")), month_year(project.get("end_date"))
    values = {
        "client_name": client_name or "", "project_name": project.get("name") or "", "location": project.get("location") or "",
        "service_text": service.get("certificate_text") or certs.DEFAULT_SERVICE_TEXT, "reference": "",
        "completion_date": certs.display_date(completed), "expiry_date": certs.display_date(expiry),
        "so_number": "" if project.get("so_no") is None else project["so_no"],
        "contract_period": f"{start} to {end}" if start and end and start != end else start or end,
        "engineer_name": project.get("completion_engineer_name") or project.get("engineer_name") or "",
        "invoice_number": project.get("invoice_number") or "", "issue_date": certs.display_date(date.today()),
    }
    try:
        filled = certs.fill_template(data, template["file_type"], values)
    except Exception:
        current_app.logger.exception("Certificate generation failed.")
        return failure("generation_failed", "The certificate could not be generated from the saved template.", 500)
    try:
        pdf = convert_to_pdf(filled, template["file_type"])
    except PdfUnavailable:
        current_app.logger.exception("Certificate PDF conversion failed.")
        return failure("pdf_unavailable", "The PDF could not be created on this server. Please contact the admin.", 503)
    label = secure_filename(f"certificate-{values['project_name']}") or "certificate"
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=True, download_name=f"{label}.pdf")


SAMPLE_CERTIFICATE_VALUES = {
    "client_name": "Sample Client LLC", "project_name": "Sample Project - 01", "location": "Sample Building, Dubai, UAE",
    "service_text": "Domestic Water Tank and Pipeline Network.", "reference": "", "so_number": "1001",
    "contract_period": "January 2026 to December 2026", "engineer_name": "Sample Engineer", "invoice_number": "INV-0001",
}


@api.get("/certificate-templates/<template_id>/preview")
@require_user(EDITORS)
def preview_certificate_template(template_id):
    """The saved template filled with sample data, as a PDF to look at before real certificates use it."""
    row = _template_row(template_id)
    if not row:
        return failure("not_found", "Template not found.", 404)
    data = _template_bytes(row)
    if data is None:
        return failure("not_found", "The template file is missing. Upload it again.", 404)
    today = date.today()
    values = {
        **SAMPLE_CERTIFICATE_VALUES, "completion_date": certs.display_date(today),
        "expiry_date": certs.display_date(certs.add_months(today, DEFAULT_VALIDITY_MONTHS)), "issue_date": certs.display_date(today),
    }
    try:
        pdf = convert_to_pdf(certs.fill_template(data, row["file_type"], values), row["file_type"])
    except PdfUnavailable:
        current_app.logger.exception("Certificate preview conversion failed.")
        return failure("pdf_unavailable", "The preview could not be created on this server.", 503)
    except Exception:
        current_app.logger.exception("Certificate preview failed.")
        return failure("generation_failed", "The preview could not be created from this template.", 500)
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", download_name="template-preview.pdf")
