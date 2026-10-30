"""Sign-in, company settings, and the Clients and Services lists. The Operations pages are in routes/hub.py."""
import re
import secrets
import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request, session
from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db as sqlalchemy_db
from backend.models import users
from backend.security.passwords import hash_password, verify_password
from backend.security.authentication import LoginRefused, login, require_user
from backend.utils.validators import RESOURCE_FIELDS, validate_payload, validate_settings

api = Blueprint("api", __name__)
# Service Coordinators and Accountants are the two administrative roles: they view, edit, approve and reject.
EDITORS = {"administrator", "service_coordinator", "accountant"}
READERS = EDITORS | {"viewer"}
RESOURCES = {"clients": EDITORS, "services": {"administrator"}}
SEARCH_COLUMNS = {
    "clients": ("name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes"),
    "services": ("name", "description", "certificate_text"),
}
DEFAULT_SERVICES = (
    ("Water testing", "Water quality testing and sampling.", "Water Quality Testing"),
    ("Tank cleaning", "Cleaning and disinfection of water tanks.", "Domestic Water Tank and Pipeline Network."),
)
DEFAULT_VALIDITY_MONTHS = 6


def db():
    return current_app.extensions["watercare_database"]


def failure(code, message, status):
    return jsonify({"error": {"code": code, "message": message}}), status


def scoped_query(table, select_columns="*"):
    return db().table(table).select(select_columns).eq("organization_id", g.organization_id).is_("deleted_at", "null")


def record(table, item_id):
    return scoped_query(table).eq("id", item_id).limit(1).execute().data


@api.get("/auth/me")
@require_user()
def me():
    if not session.get("csrf_token"):
        session["csrf_token"] = secrets.token_urlsafe(32)
    return jsonify({
        "user": {"id": g.user.id, "email": getattr(g.user, "email", None), "full_name": getattr(g.user, "full_name", None)},
        "organization_id": g.organization_id,
        "role": g.role,
        "csrf_token": session["csrf_token"],
    })


@api.post("/auth/login")
def login_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("email"), str) or not isinstance(payload.get("password"), str):
        return failure("invalid_request", "Email and password are required.", 400)
    login_type = payload.get("login_type", "staff")
    access_key = payload.get("access_key", "")
    if login_type not in {"admin", "staff"} or not isinstance(access_key, str):
        return failure("invalid_request", "Choose the Admin login or the Staff login.", 400)
    if login_type == "admin" and not access_key:
        return failure("invalid_request", "Enter your private key to use the Admin login.", 400)
    try:
        account = login(payload["email"].strip(), payload["password"], login_type, access_key)
    except LoginRefused as error:
        return failure("wrong_login", str(error), 403)
    except SQLAlchemyError:
        sqlalchemy_db.session.rollback()
        current_app.logger.exception("Sign-in could not read the accounts table.")
        return failure(
            "database_unavailable",
            "Sign-in is unavailable: the database cannot be reached or is not set up yet. Check the server logs.",
            503,
        )
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
    if not account or not verify_password(account["password_hash"], payload["current_password"]):
        return failure("unauthorized", "Current password is incorrect.", 401)
    sqlalchemy_db.session.execute(users.update().where(users.c.id == g.user.id).values(
        password_hash=hash_password(payload["new_password"]),
        updated_at=datetime.now(timezone.utc).isoformat(),
    ))
    sqlalchemy_db.session.commit()
    session.clear()
    return jsonify({"message": "Password changed. Sign in again."})


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


def _service_by_name(name):
    rows = scoped_query("services").ilike("name", name or "").limit(20).execute().data or []
    return next((row for row in rows if row["name"].lower() == (name or "").lower()), None)


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


def _contracts_using(service_name):
    rows = scoped_query("hub_records", "id,data").eq("collection", "contracts").execute().data or []
    return [row for row in rows if (row["data"] or {}).get("service") == service_name]


def _list_records(resource):
    if resource == "services":
        ensure_default_services()
    query = scoped_query(resource)
    search = (request.args.get("search") or "").strip()
    if len(search) > 100:
        return failure("invalid_request", "Search text must be 100 characters or fewer.", 400)
    if search:
        pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        columns = query.table.c
        query = query.where(or_(*[columns[name].ilike(pattern, escape="\\") for name in SEARCH_COLUMNS[resource]]))
    return jsonify({"data": query.order("name").execute().data or []})


def _add_record(resource):
    payload = request.get_json(silent=True)
    problem = validate_payload(resource, payload)
    if problem:
        return failure("invalid_request", problem, 400)
    if resource == "services":
        refused = _service_problem(payload)
        if refused:
            return refused
    created = db().table(resource).insert({
        **payload, "organization_id": g.organization_id, "created_by": g.user.id, "updated_by": g.user.id,
    }).execute().data
    return jsonify({"data": created[0]}), 201


def _change_record(resource, current):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not payload:
        return failure("invalid_request", "Provide at least one field to update.", 400)
    problem = validate_payload(resource, payload, partial=True)
    if problem:
        return failure("invalid_request", problem, 400)
    if resource == "services":
        refused = _service_problem(payload, current)
        if refused:
            return refused
    updated = db().table(resource).update({**payload, "updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("id", current["id"]).is_("deleted_at", "null").execute().data
    if resource == "services" and payload.get("name") and payload["name"] != current["name"]:
        # Contracts refer to a service by name, so a rename carries them along.
        for row in _contracts_using(current["name"]):
            db().table("hub_records").update({"data": {**row["data"], "service": payload["name"]}}).eq(
                "organization_id", g.organization_id
            ).eq("id", row["id"]).execute()
    return jsonify({"data": updated[0]})


def _archive_record(resource, current):
    if resource == "services" and _contracts_using(current["name"]):
        return failure("conflict", "This service is used by AMC contracts. Set it to inactive instead.", 409)
    db().table(resource).update({"deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("id", current["id"]).is_("deleted_at", "null").execute()
    return jsonify({"message": "Record archived."})


@api.route("/<any(clients,services):resource>", methods=["GET", "POST"])
@require_user()
def collection(resource):
    if request.method == "GET":
        return _list_records(resource) if g.role in READERS else failure("forbidden", "Your account cannot open this list.", 403)
    if g.role not in RESOURCES[resource]:
        return failure("forbidden", "Your account has view-only access and cannot change records.", 403)
    return _add_record(resource)


@api.route("/<any(clients,services):resource>/<item_id>", methods=["GET", "PATCH", "DELETE"])
@require_user()
def item(resource, item_id):
    try:
        uuid.UUID(item_id)
    except ValueError:
        return failure("invalid_request", "Record ID must be a valid UUID.", 400)
    if g.role not in READERS:
        return failure("forbidden", "Your account cannot open this list.", 403)
    rows = record(resource, item_id)
    if not rows:
        return failure("not_found", "Record not found.", 404)
    if request.method == "GET":
        return jsonify({"data": rows[0]})
    if g.role not in RESOURCES[resource]:
        return failure("forbidden", "Your account has view-only access and cannot change records.", 403)
    return _change_record(resource, rows[0]) if request.method == "PATCH" else _archive_record(resource, rows[0])


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


def report_preferences():
    """The company name for report headings and the reader's date format (their own, else the company's)."""
    company = db().table("organization_settings").select("name,date_format").eq(
        "organization_id", g.organization_id
    ).limit(1).execute().data or [{}]
    mine = db().table("user_settings").select("date_format").eq(
        "organization_id", g.organization_id
    ).eq("user_id", g.user.id).limit(1).execute().data or [{}]
    return company[0].get("name") or "", mine[0].get("date_format") or company[0].get("date_format") or "YYYY-MM-DD"
