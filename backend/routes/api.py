import csv
import io
import re
import secrets
import uuid
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

from flask import Blueprint, current_app, g, jsonify, request, send_file, session
from sqlalchemy import select
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename

from backend.database import db as sqlalchemy_db
from backend.models import engineers, memberships, users
from backend.security.authentication import login, require_user
from backend.utils.validators import RESOURCE_FIELDS, validate_payload

api = Blueprint("api", __name__)
ADMIN = {"administrator"}
MANAGERS = {"administrator", "manager"}
RESOURCES = {
    "clients": ("clients", MANAGERS),
    "engineers": ("engineers", MANAGERS),
    "projects": ("projects", MANAGERS),
    "project_tasks": ("project_tasks", MANAGERS),
    "cleaning-records": ("cleaning_records", MANAGERS),
    "water-testing": ("water_testing_records", MANAGERS),
}


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
            db().table("engineers").select("id").eq("organization_id", g.organization_id)
            .eq("user_id", g.user.id).eq("is_active", True).is_("deleted_at", "null").execute().data or []
        )
        engineer_ids = [engineer["id"] for engineer in engineer_ids]
        if table == "projects":
            assignments = db().table("project_engineers").select("project_id").eq(
                "organization_id", g.organization_id
            ).in_("engineer_id", engineer_ids).execute().data if engineer_ids else []
            project_ids = [assignment["project_id"] for assignment in assignments or []]
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
    account = login(payload["email"].strip(), payload["password"])
    if not account:
        return failure("unauthorized", "Email or password is incorrect, or the account has no single active organization.", 401)
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
    if not isinstance(payload, dict) or set(payload) - {"email", "full_name", "password", "role"}:
        return failure("invalid_request", "Provide email, full_name, password, and role.", 400)
    email = payload.get("email")
    full_name = payload.get("full_name")
    password = payload.get("password")
    role = payload.get("role", "employee")
    if (
        not isinstance(email, str) or len(email) > 320 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)
        or not isinstance(full_name, str) or not full_name.strip() or len(full_name) > 255
        or not isinstance(password, str) or not 12 <= len(password) <= 512
        or role not in {"manager", "employee"}
    ):
        return failure("invalid_request", "Use a valid email, name, role, and password of at least 12 characters.", 400)
    existing = sqlalchemy_db.session.execute(select(users.c.id).where(users.c.email == email.lower())).first()
    if existing:
        return failure("conflict", "An account with this email already exists.", 409)
    user_id, now = str(uuid4()), datetime.now(timezone.utc).isoformat()
    try:
        sqlalchemy_db.session.execute(users.insert().values(
            id=user_id, email=email.lower(), full_name=full_name.strip(),
            password_hash=generate_password_hash(password), is_active=True,
            created_at=now, updated_at=now,
        ))
        sqlalchemy_db.session.execute(memberships.insert().values(
            id=str(uuid4()), organization_id=g.organization_id, user_id=user_id,
            role=role, status="active", created_at=now,
        ))
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
        projects = scoped_query(
            "projects", "id,name,client_id,location,status,scheduled_date,scheduled_time,description"
        )
        if client_id:
            projects = projects.eq("client_id", client_id)
        project_rows = projects.execute().data or []
        tasks_query = scoped_query("project_tasks").gte("scheduled_date", start).lte("scheduled_date", end)
        task_rows = tasks_query.order("scheduled_date").limit(500).execute().data or []
        project_by_id = {p["id"]: p for p in project_rows}
        client_ids = list({project["client_id"] for project in project_rows})
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
            scheduled_date = project.get("scheduled_date")
            if scheduled_date and start <= scheduled_date <= end:
                results.append({
                    "id": project["id"], "title": project["name"], "status": project.get("status"),
                    "scheduled_date": scheduled_date, "scheduled_time": project.get("scheduled_time"),
                    "location": project.get("location"), "description": project.get("description"),
                    "project": {**project, "client_name": client_names.get(project["client_id"])},
                    "engineer_ids": project_engineers.get(project["id"], []),
                    "record_type": "project",
                })
        for task in task_rows:
            project = project_by_id.get(task.get("project_id"))
            if project:
                results.append({
                    **task, "project": {**project, "client_name": client_names.get(project["client_id"])},
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
            query = scoped_query(table)
            search = request.args.get("search", "").strip()
            if search and resource in ("clients", "engineers"):
                column = "name" if resource == "clients" else "full_name"
                query = query.ilike(column, f"%{search[:100]}%")
            for key in ("status", "client_id", "engineer_id", "project_id", "category"):
                value = request.args.get(key)
                if value and key in RESOURCE_FIELDS[rule_resource]["fields"]:
                    query = query.eq(key, value)
            start, end = request.args.get("from"), request.args.get("to")
            date_field = {
                "projects": "scheduled_date",
                "project_tasks": "scheduled_date",
                "cleaning-records": "cleaning_date",
                "water-testing": "collection_date",
            }.get(resource)
            if (start or end) and not date_field:
                return failure("invalid_request", "Date filtering is not supported for this resource.", 400)
            if start:
                query = query.gte(date_field, start)
            if end:
                query = query.lte(date_field, end)
            limit = min(max(request.args.get("limit", 100, type=int), 1), 200)
            offset = max(request.args.get("offset", 0, type=int), 0)
            response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
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
        validation = validate_payload(rule_resource, payload)
        if validation:
            return failure("invalid_request", validation, 400)
        if not isinstance(assigned_engineer_ids, list) or any(not isinstance(value, str) for value in assigned_engineer_ids):
            return failure("invalid_request", "assigned_engineer_ids must be a list of engineer IDs.", 400)
        try:
            if resource == "projects":
                _validate_engineer_ids(assigned_engineer_ids)
            _validate_relationships(resource, payload)
            payload = dict(payload)
            payload["organization_id"] = g.organization_id
            payload["created_by"] = g.user.id
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
        payload = request.get_json(silent=True)
        if g.role not in write_roles:
            if resource != "project_tasks" or g.role != "employee":
                return failure("forbidden", "Your role cannot update this record.", 403)
            if not isinstance(payload, dict) or set(payload) - {"status", "notes"}:
                return failure("forbidden", "Employees may only update task status and notes.", 403)
            if "status" in payload and payload["status"] not in {"Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"}:
                return failure("invalid_request", "Unsupported task status.", 400)
            if not payload:
                return failure("invalid_request", "Provide task status or notes.", 400)
            engineer_rows = db().table("engineers").select("id").eq(
                "organization_id", g.organization_id
            ).eq("user_id", g.user.id).eq("is_active", True).is_("deleted_at", "null").execute().data or []
            own_engineer_ids = [row["id"] for row in engineer_rows]
            assigned_task = db().table("project_tasks").select("id").eq(
                "organization_id", g.organization_id
            ).eq("id", item_id).in_("engineer_id", own_engineer_ids).is_("deleted_at", "null").execute().data if own_engineer_ids else []
            if not assigned_task:
                return failure("not_found", "Assigned task not found.", 404)
        assigned_engineer_ids = payload.get("assigned_engineer_ids") if isinstance(payload, dict) and resource == "projects" else None
        if isinstance(payload, dict) and resource == "projects":
            payload = {key: value for key, value in payload.items() if key != "assigned_engineer_ids"}
        validation = validate_payload(rule_resource, payload, partial=True)
        if validation:
            return failure("invalid_request", validation, 400)
        if assigned_engineer_ids is not None and (
            not isinstance(assigned_engineer_ids, list) or any(not isinstance(value, str) for value in assigned_engineer_ids)
        ):
            return failure("invalid_request", "assigned_engineer_ids must be a list of engineer IDs.", 400)
        if not payload and assigned_engineer_ids is None:
            return failure("invalid_request", "Provide at least one field to update.", 400)
        try:
            if resource == "projects" and assigned_engineer_ids is not None:
                _validate_engineer_ids(assigned_engineer_ids)
            _validate_relationships(resource, payload)
            updated = record(table, item_id)
            if not updated:
                return failure("not_found", "Record not found.", 404)
            if payload:
                payload["updated_by"] = g.user.id
                updated = (
                    db().table(table).update(payload).eq("organization_id", g.organization_id)
                    .eq("id", item_id).is_("deleted_at", "null").execute().data
                )
            if resource == "projects" and assigned_engineer_ids is not None:
                _replace_project_engineers(item_id, assigned_engineer_ids)
            return jsonify({"data": (updated or record(table, item_id))[0]}), 200
        except ValueError as error:
            return failure("invalid_request", str(error), 400)
        except Exception:
            current_app.logger.exception("Record update failed.")
            return failure("database_error", "Record could not be updated.", 503)

    @require_user(roles=write_roles)
    def delete_item():
        try:
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
@require_user(roles=MANAGERS)
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
    if related_type not in {"project", "client", "cleaning_record", "water_testing"} or not related_id:
        return failure("invalid_request", "A valid related_type and related_id are required.", 400)
    try:
        uuid.UUID(related_id)
    except ValueError:
        return failure("invalid_request", "related_id must be a valid record ID.", 400)
    table = {"project": "projects", "client": "clients", "cleaning_record": "cleaning_records", "water_testing": "water_testing_records"}[related_type]
    storage_path = None
    try:
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
        }).execute().data
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
        response = {}
        if "organization" in payload:
            if g.role != "administrator":
                return failure("forbidden", "Only administrators can change organization settings.", 403)
            values = payload["organization"]
            allowed = {"name", "support_contact", "time_zone", "date_format", "time_format"}
            if not isinstance(values, dict) or set(values) - allowed:
                return failure("invalid_request", "Invalid organization settings.", 400)
            previous = client.table("organization_settings").select("*").eq(
                "organization_id", g.organization_id
            ).limit(1).execute().data or []
            response["organization"] = client.table("organization_settings").upsert(
                {"organization_id": g.organization_id, **(previous[0] if previous else {}), **values}, on_conflict="organization_id"
            ).execute().data
        if "user" in payload:
            values = payload["user"]
            allowed = {"appearance", "notification_preferences", "date_format", "time_format", "time_zone"}
            if not isinstance(values, dict) or set(values) - allowed:
                return failure("invalid_request", "Invalid user settings.", 400)
            previous = client.table("user_settings").select("*").eq(
                "organization_id", g.organization_id
            ).eq("user_id", g.user.id).limit(1).execute().data or []
            response["user"] = client.table("user_settings").upsert(
                {"organization_id": g.organization_id, "user_id": g.user.id, **(previous[0] if previous else {}), **values},
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
        upload_root = Path(current_app.config["STORAGE_PATH"]).resolve()
        path = (upload_root / files[0]["storage_path"]).resolve()
        if not path.is_relative_to(upload_root) or not path.is_file():
            return failure("not_found", "File not found.", 404)
        return send_file(
            path, mimetype=files[0]["mime_type"], as_attachment=True,
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
            if related_type not in {"project", "client", "cleaning_record", "water_testing"}:
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
            query = query.eq("related_id", related_id)
        files = query.order("created_at", desc=True).limit(200).execute().data or []
        return jsonify({"data": files})
    except Exception:
        current_app.logger.exception("Document listing failed.")
        return failure("storage_error", "Documents are temporarily unavailable.", 503)


@api.delete("/uploads/<file_id>")
@require_user(roles=MANAGERS)
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
    start, end = request.args.get("from"), request.args.get("to")
    try:
        if start:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
                raise ValueError()
            date.fromisoformat(start)
        if end:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
                raise ValueError()
            date.fromisoformat(end)
        if start and end and start > end:
            return failure("invalid_request", "from must not be after to.", 400)
    except ValueError:
        return failure("invalid_request", "Dates must use YYYY-MM-DD format.", 400)
    try:
        query = scoped_query(table)
        filter_fields = {
            "projects": {"status", "client_id", "category", "engineer_id"},
            "cleaning": {"status", "client_id", "engineer_id"},
            "water-testing": {"status", "client_id", "engineer_id"},
            "clients": set(),
            "engineers": set(),
        }[resource]
        if any(request.args.get(key) for key in {"status", "client_id", "engineer_id", "category"} - filter_fields):
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
        date_field = {
            "cleaning": "cleaning_date", "water-testing": "collection_date",
            "projects": "scheduled_date",
        }.get(resource)
        if (start or end) and not date_field:
            return failure("invalid_request", "Date filtering is not supported for this report.", 400)
        if date_field and request.args.get("from"):
            query = query.gte(date_field, request.args["from"])
        if date_field and request.args.get("to"):
            query = query.lte(date_field, request.args["to"])
        rows = query.limit(5000).execute().data or []
        fields = [field for field in rows[0] if field not in {"organization_id", "deleted_at"}] if rows else []
        basename = f"watercare-{resource}-report"
        if output_format == "csv":
            output = io.StringIO()
            if rows:
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
