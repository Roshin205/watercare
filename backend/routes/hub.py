"""The API behind the Operations pages: AMC contracts, lab samples, PPM planners, deliveries, staff and custom sections.

Every record is a row in hub_records. The generic routes list, add, change and remove them for any collection in
backend/utils/hub_schema.py; the routes further down are the actions that do more than save fields.
"""
import csv
import io
import json
import re
import uuid
from datetime import date, datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request, send_file
from sqlalchemy import func, select
from werkzeug.utils import secure_filename

from backend.database import db as sqlalchemy_db
from backend.models import clients as clients_table, memberships, users
from backend.routes.api import failure, report_preferences
from backend.security.authentication import ADMIN_LOGIN_ROLES, require_user
from backend.security.passwords import hash_password
from backend.utils import hub_documents as documents, hub_logic as logic, storage
from backend.utils.schedule_export import HEADERS as SCHEDULE_HEADERS, schedule_rows, schedule_workbook
from backend.utils.hub_schema import (
    BUILT_IN_SECTIONS, COLLECTIONS, CONTRACT_DEFAULTS, DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, IDENTITY_FIELDS, IDENTITY_ROLES,
    MAX_RECORD_BYTES, validate_columns, validate_record, validate_section_values,
)

hub = Blueprint("hub", __name__)
EDITORS = {"administrator", "service_coordinator", "accountant"}
READERS = EDITORS | {"viewer"}
MAX_FILE_BYTES = 20 * 1024 * 1024
# Engineers (the employee role) read only their own visits; every other collection is for the office.
EMPLOYEE_CONTRACT_FIELDS = (
    "client", "client_id", "site", "so", "contact", "mobile", "location", "map_link", "status", "expiry", "latitude", "longitude",
    "system_details",
)


class Refused(Exception):
    """The request cannot be carried out; the message is shown to the user."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@hub.errorhandler(Refused)
def refused(error):
    return failure("invalid_request", str(error), error.status)


def today():
    return date.today().isoformat()


def records():
    return current_app.extensions["watercare_database"].table("hub_records")


def scoped(collection):
    return records().select("id,parent_id,period,data,created_at,updated_at").eq(
        "organization_id", g.organization_id
    ).eq("collection", collection).is_("deleted_at", "null")


def shaped(row):
    return {**(row["data"] or {}), "id": row["id"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


def fetch(collection, parent=None):
    query = scoped(collection)
    if parent:
        query = query.eq("parent_id", parent)
    return [shaped(row) for row in query.order("created_at").execute().data or []]


def find(collection, record_id):
    rows = scoped(collection).eq("id", record_id).limit(1).execute().data
    return shaped(rows[0]) if rows else None


def require_record(collection, record_id):
    found = find(collection, record_id)
    if not found:
        raise Refused("Record not found.", 404)
    return found


def stored_fields(collection, data):
    fields = {key: value for key, value in data.items() if key not in ("id", "created_at", "updated_at")}
    if len(json.dumps(fields)) > MAX_RECORD_BYTES:
        raise Refused("This record is too large to save.")
    rules = COLLECTIONS.get(collection, {})
    parent, period = rules.get("parent"), rules.get("period")
    return {
        "data": fields,
        "parent_id": (data.get(parent) or None) if parent else data.get("__parent"),
        "period": (data.get(period) or "")[:7] or None if period else None,
    }


def insert(collection, data):
    row = records().insert({
        "organization_id": g.organization_id, "collection": collection, "created_by": g.user.id, "updated_by": g.user.id,
        **stored_fields(collection, data),
    }).execute().data[0]
    return shaped(row)


def replace(collection, record_id, data):
    row = records().update({**stored_fields(collection, data), "updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("id", record_id).execute().data[0]
    return shaped(row)


def soft_delete(record_id):
    records().update({"deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("id", record_id).execute()


# ---- Settings -------------------------------------------------------------------------------------------------------

def settings_rows():
    return {row["data"].get("key"): row for row in scoped("settings").execute().data or []}


def load_settings():
    stored = {key: row["data"].get("value") for key, row in settings_rows().items()}
    return {**DEFAULT_SETTINGS, **{key: value for key, value in stored.items() if key in DEFAULT_SETTINGS}}


def store_setting(key, value, rows=None):
    rows = settings_rows() if rows is None else rows
    if key in rows:
        replace("settings", rows[key]["id"], {"key": key, "value": value})
    else:
        insert("settings", {"key": key, "value": value})


def seed_once(name, seed):
    """Starting data is added one time only, so deleting it later does not bring it back."""
    rows = settings_rows()
    if f"seeded_{name}" not in rows:
        seed()
        store_setting(f"seeded_{name}", True, rows)


def seed_sections():
    existing = {section.get("system") for section in fetch("sections")}
    for section in BUILT_IN_SECTIONS:
        if section["system"] not in existing:
            insert("sections", dict(section))


def seed_holidays():
    for day, name in DEFAULT_HOLIDAYS:
        insert("holidays", {"date": day, "name": name})


@hub.get("/bootstrap")
@require_user()
def bootstrap():
    if g.role in READERS:
        seed_once("sections", seed_sections)
        seed_once("holidays", seed_holidays)
    mine = scoped("user_ui").eq("parent_id", g.user.id).limit(1).execute().data
    return jsonify({
        "settings": load_settings(),
        "ui": (mine[0]["data"] if mine else {}),
        "sections": [{"id": s["id"], "name": s["name"], "icon": s.get("icon", ""), "system": s.get("system", "")}
                     for s in fetch("sections")] if g.role in READERS else [],
        "identity": g.role in IDENTITY_ROLES,
        "edit": g.role in EDITORS,
        "organization_id": g.organization_id,
        "staff_id": (own_staff() or {}).get("id", ""),
    })


@hub.put("/settings")
@require_user(roles=EDITORS)
def update_settings():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or set(payload) - set(DEFAULT_SETTINGS):
        raise Refused("Unknown setting.")
    rows = settings_rows()
    for key, value in payload.items():
        if not isinstance(value, type(DEFAULT_SETTINGS[key])):
            raise Refused(f"{key} has the wrong type of value.")
        store_setting(key, value, rows)
    return jsonify({"settings": load_settings()})


@hub.put("/me/ui")
@require_user()
def update_my_ui():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or len(json.dumps(payload)) > 20000:
        raise Refused("Send your display choices as an object.")
    mine = scoped("user_ui").eq("parent_id", g.user.id).limit(1).execute().data
    if mine:
        replace("user_ui", mine[0]["id"], {**payload, "__parent": g.user.id})
    else:
        insert("user_ui", {**payload, "__parent": g.user.id})
    return jsonify({"ui": payload})


# ---- Generic records ------------------------------------------------------------------------------------------------

def client_id_for(name):
    """The Clients page row for this name, added when the client is new."""
    name = (name or "").strip()
    if not name:
        return ""
    found = sqlalchemy_db.session.execute(clients_table.select().where(
        clients_table.c.organization_id == g.organization_id, clients_table.c.deleted_at.is_(None),
        func.lower(clients_table.c.name) == name.lower(),
    )).mappings().first()
    if found:
        return found["id"]
    created = current_app.extensions["watercare_database"].table("clients").insert({
        "organization_id": g.organization_id, "name": name, "is_active": True,
        "created_by": g.user.id, "updated_by": g.user.id,
    }).execute().data
    return created[0]["id"]


def prepare_contract(data, previous):
    if not previous:
        for key, value in CONTRACT_DEFAULTS.items():
            data[key] = data.get(key) or value
    data["client_id"] = client_id_for(data.get("client"))
    data["schedule"] = data.get("schedule") or {}
    if not previous or any(data.get(key) != previous.get(key) for key in ("frequency", "start", "expiry")):
        data["schedule"] = logic.fill_schedule(data, date.today())
    logic.refresh_visit_dates(data)
    if data.get("invoice") == "Submitted" and not data.get("invoice_date"):
        data["invoice_date"] = today()


def prepare_sample(data, previous):
    data["status"] = data.get("status") or "Pending"
    data["report"] = data.get("report") or "Not submitted"
    if data.get("collection_date") and not data.get("next_due"):
        following, expiry = logic.sample_dates(data["collection_date"], data.get("duration"), load_settings()["durations"])
        data["next_due"] = following
        data["expiry"] = data.get("expiry") or expiry


def prepare_note(data, previous):
    notes = [note for note in fetch("delivery_notes") if not previous or note["id"] != previous["id"]]
    if not data.get("dn"):
        data["dn"] = logic.next_dn([note.get("dn") for note in notes], load_settings()["dn_start"], date.today())
    if any(note.get("dn") == data["dn"] for note in notes):
        raise Refused(f"Delivery note {data['dn']} already exists.", 409)
    data["status"] = data.get("status") or "Pending"
    data["signed"] = data.get("signed") or "Pending"
    data["items"] = data.get("items") or []
    if not isinstance(data["items"], list) or any(not isinstance(item, dict) for item in data["items"]):
        raise Refused("Items must be a list.")
    if not data.get("customer_text"):
        data["customer_text"] = " – ".join(part for part in ("Delivery Note", data["dn"], data.get("client"), data.get("so")) if part)


def prepare_section(data, previous):
    problem = validate_columns(data.get("columns"))
    if problem:
        raise Refused(problem)
    if previous:
        data["system"] = previous.get("system", "")
    else:
        data["system"] = ""


def prepare_section_row(data, previous):
    section = require_record("sections", data["section_id"])
    values, problem = validate_section_values(section["columns"], data.get("values") or {})
    if problem:
        raise Refused(problem)
    for column in section["columns"]:
        source = values.get(column.get("auto_from") or "")
        if source and not values.get(column["key"]):
            values[column["key"]] = logic.add_months(source, column.get("auto_months") or 12)
    data["values"] = values


def after_grn_save(data):
    """A GRN-type status marks the matching contract's GRN as pending."""
    status = (data.get("status") or "").lower()
    if "grn" not in status or "received" in status:
        return
    for contract in fetch("contracts"):
        same_so = data.get("so") and contract.get("so") == data["so"]
        same_site = (contract.get("site") or "").lower() == (data.get("project") or "").lower()
        if (same_so or same_site) and contract.get("grn") not in ("Pending", "Received", "Not applicable"):
            replace("contracts", contract["id"], {**contract, "grn": "Pending"})


PREPARE = {
    "contracts": prepare_contract, "samples": prepare_sample, "delivery_notes": prepare_note,
    "sections": prepare_section, "section_rows": prepare_section_row,
}
AFTER_SAVE = {"grn_projects": after_grn_save, "staff": lambda person: set_login_active(person)}


def check_identity_fields(collection, payload):
    if collection == "staff" and g.role not in IDENTITY_ROLES and set(payload) & set(IDENTITY_FIELDS):
        raise Refused("Your account cannot change identity details.", 403)


def visible(collection, record):
    if collection == "staff" and g.role not in IDENTITY_ROLES:
        return {key: value for key, value in record.items() if key not in IDENTITY_FIELDS}
    return record


def own_staff():
    """The Staff Profile linked to the signed-in login, if there is one."""
    return next((person for person in fetch("staff") if person.get("user_id") == g.user.id), None)


def own_names():
    names = {name for name in (g.user.full_name, g.user.email) if name}
    person = own_staff()
    if person:
        names.add(person.get("name"))
    return names


def own_visits(contracts):
    """An engineer's view of the schedule: only the visits allocated to them."""
    names = own_names()
    shown = []
    for contract in contracts:
        visits = {month: visit for month, visit in (contract.get("schedule") or {}).items() if visit.get("engineer") in names}
        if visits and contract.get("status") != "Closed":
            shown.append({"id": contract["id"], "schedule": visits, **{key: contract.get(key) for key in EMPLOYEE_CONTRACT_FIELDS}})
    return shown


@hub.route("/<collection>", methods=["GET", "POST"])
@require_user()
def collection_route(collection):
    if collection not in COLLECTIONS:
        return failure("not_found", "Unknown section.", 404)
    if request.method == "GET":
        if g.role == "employee" and collection == "contracts":
            return jsonify({"data": own_visits(fetch("contracts"))})
        if g.role not in READERS:
            return failure("forbidden", "Your account cannot open this section.", 403)
        query = scoped(collection)
        if request.args.get("parent"):
            query = query.eq("parent_id", request.args["parent"])
        if request.args.get("period"):
            query = query.eq("period", request.args["period"])
        if request.args.get("from"):
            query = query.gte("period", request.args["from"])
        if request.args.get("to"):
            query = query.lte("period", request.args["to"])
        return jsonify({"data": [visible(collection, shaped(row)) for row in query.order("created_at").execute().data or []]})
    if g.role not in EDITORS:
        return failure("forbidden", "Your account has view-only access.", 403)
    payload = request.get_json(silent=True)
    clean, problem = validate_record(collection, payload)
    if problem:
        raise Refused(problem)
    check_identity_fields(collection, clean)
    if collection in PREPARE:
        PREPARE[collection](clean, None)
    created = insert(collection, clean)
    if collection in AFTER_SAVE:
        AFTER_SAVE[collection](created)
    return jsonify({"data": visible(collection, created)}), 201


@hub.route("/<collection>/<record_id>", methods=["PATCH", "DELETE"])
@require_user(roles=EDITORS)
def record_route(collection, record_id):
    if collection not in COLLECTIONS:
        return failure("not_found", "Unknown section.", 404)
    previous = require_record(collection, record_id)
    if request.method == "DELETE":
        if collection == "sections":
            if previous.get("system"):
                raise Refused("Built-in sections cannot be deleted.")
            for row in fetch("section_rows", parent=record_id):
                remove_with_files(row["id"])
        if collection == "chemical_lines":
            for month in (previous.get("months") or {}):
                link_stock({**previous, "months": {}}, month, 0, load_settings())
        if collection == "inventory_items":
            for move in fetch("inventory_moves", parent=record_id):
                soft_delete(move["id"])
        if collection == "staff":
            set_login_active({**previous, "status": "Terminated"})
        remove_with_files(record_id)
        return jsonify({"message": "Deleted."})
    payload = request.get_json(silent=True)
    clean, problem = validate_record(collection, payload, partial=True)
    if problem:
        raise Refused(problem)
    check_identity_fields(collection, clean)
    data = {**previous, **clean}
    if collection in PREPARE:
        PREPARE[collection](data, previous)
    saved = replace(collection, record_id, data)
    if collection in AFTER_SAVE:
        AFTER_SAVE[collection](saved)
    return jsonify({"data": visible(collection, saved)})


@hub.post("/<collection>/bulk")
@require_user(roles=EDITORS)
def bulk_update(collection):
    """The same change on every row shown (Update all shown rows)."""
    if collection not in COLLECTIONS:
        return failure("not_found", "Unknown section.", 404)
    payload = request.get_json(silent=True) or {}
    ids, values = payload.get("ids"), payload.get("values")
    if not isinstance(ids, list) or not ids or len(ids) > 2000:
        raise Refused("Choose the rows to change.")
    clean, problem = validate_record(collection, values, partial=True)
    if problem:
        raise Refused(problem)
    check_identity_fields(collection, clean)
    wanted, changed = set(ids), 0
    for row in fetch(collection):
        if row["id"] in wanted:
            data = {**row, **clean}
            if collection in PREPARE:
                PREPARE[collection](data, row)
            replace(collection, row["id"], data)
            changed += 1
    return jsonify({"changed": changed})


# ---- AMC contracts --------------------------------------------------------------------------------------------------

PENDING, APPROVED, REJECTED = "Pending Approval", "Approved", "Rejected"


def visit_of(contract, month):
    visit = (contract.get("schedule") or {}).get(month)
    if not visit:
        raise Refused("This visit is no longer on the schedule.", 404)
    return visit


def note_history(contract, month, previous, new, action, reason=""):
    insert("approval_history", {
        "reference": f"{contract.get('client') or ''} · {contract.get('site')} · {month}", "contract_id": contract["id"], "month": month,
        "previous_status": previous or "Pending", "new_status": new, "action": action, "reason": reason,
        "actor_name": g.user.full_name or g.user.email, "at": datetime.now(timezone.utc).isoformat(),
    })


@hub.post("/contracts/<contract_id>/visit")
@require_user(roles=EDITORS)
def log_visit(contract_id):
    contract = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    clean, problem = validate_record("contracts", {
        key: payload.get(key) for key in ("report", "lab") if payload.get(key)
    }, partial=True)
    if problem:
        raise Refused(problem)
    visit_date = payload.get("date")
    if not isinstance(visit_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", visit_date):
        raise Refused("Enter the visit date.")
    contract.update(clean)
    logic.set_visit(contract, visit_date[:7], date.today(), status="done", visit_date=visit_date,
                    engineer=str(payload.get("engineer") or "")[:200])
    contract["schedule"][visit_date[:7]].pop("approval", None)  # logged by the office: nothing is left to approve
    return jsonify({"data": replace("contracts", contract_id, contract)})


@hub.post("/contracts/<contract_id>/complete")
@require_user(roles=EDITORS | {"employee"})
def submit_completion(contract_id):
    """The engineer's work completion: before and after photos, the actual date, then the office approves it."""
    contract = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    month, actual = payload.get("month"), payload.get("date")
    visit = visit_of(contract, month)
    if g.role == "employee" and visit.get("engineer") not in own_names():
        return failure("forbidden", "This visit is allocated to someone else.", 403)
    if visit.get("approval") == PENDING:
        raise Refused("This completion is already awaiting approval.", 409)
    if visit.get("approval") == APPROVED or visit.get("status") == "done":
        raise Refused("This visit has already been completed.", 409)
    clean, problem = validate_record("samples", {"collection_date": actual}, partial=True)
    if problem or not actual:
        raise Refused("Enter the actual completion date.")
    if actual > today():
        raise Refused("The completion date cannot be in the future.")
    kinds = {row["image_type"] for row in files_for(contract_id)}
    if {f"Before:{month}", f"After:{month}"} - kinds:
        raise Refused("Upload both before-work and after-work photos before submitting.")
    previous = visit.get("approval")
    visit.update(approval=PENDING, reason="", completion={
        "date": actual, "notes": str(payload.get("notes") or "")[:2000], "by": g.user.full_name or g.user.email,
        "timing": logic.completion_timing(actual, visit.get("date") or f"{month}-01"),
    })
    replace("contracts", contract_id, contract)
    note_history(contract, month, previous, PENDING, "Resubmitted" if previous == REJECTED else "Submitted")
    return jsonify({"data": visit})


@hub.get("/approvals")
@require_user(roles=EDITORS)
def list_approvals():
    pending = []
    for contract in fetch("contracts"):
        for month, visit in (contract.get("schedule") or {}).items():
            if visit.get("approval") == PENDING:
                pending.append({
                    "contract_id": contract["id"], "client": contract.get("client"), "site": contract.get("site"), "month": month,
                    "planned": visit.get("date"), "engineer": visit.get("engineer"), **(visit.get("completion") or {}),
                })
    history = sorted(fetch("approval_history"), key=lambda row: row.get("at") or "", reverse=True)
    return jsonify({"pending": sorted(pending, key=lambda row: row.get("date") or ""), "history": history[:200]})


@hub.post("/contracts/<contract_id>/approve")
@require_user(roles=EDITORS)
def approve_visit(contract_id):
    contract = require_record("contracts", contract_id)
    month = (request.get_json(silent=True) or {}).get("month")
    visit = visit_of(contract, month)
    if visit.get("approval") != PENDING:
        raise Refused("This completion is no longer awaiting approval.", 409)
    completion = visit.get("completion") or {}
    logic.set_visit(contract, month, date.today(), status="done", visit_date=completion.get("date"),
                    engineer=visit.get("engineer") or completion.get("by"))
    contract["schedule"][month]["approval"] = APPROVED
    saved = replace("contracts", contract_id, contract)
    note_history(contract, month, PENDING, APPROVED, "Approved")
    return jsonify({"data": saved})


@hub.post("/contracts/<contract_id>/reject")
@require_user(roles=EDITORS)
def reject_visit(contract_id):
    contract = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    month, reason = payload.get("month"), str(payload.get("reason") or "").strip()[:2000]
    visit = visit_of(contract, month)
    if not reason:
        raise Refused("Enter the rejection reason.")
    if visit.get("approval") != PENDING:
        raise Refused("This completion is no longer awaiting approval.", 409)
    visit.update(approval=REJECTED, reason=reason)
    saved = replace("contracts", contract_id, contract)
    note_history(contract, month, PENDING, REJECTED, "Rejected", reason)
    return jsonify({"data": saved})


@hub.post("/contracts/<contract_id>/schedule")
@require_user(roles=EDITORS)
def change_visit(contract_id):
    contract = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    try:
        logic.set_visit(
            contract, payload.get("month"), date.today(), status=payload.get("status"), visit_date=payload.get("date"),
            engineer=payload.get("engineer"), move_to=payload.get("move_to"), remove=bool(payload.get("remove")),
        )
    except ValueError as error:
        raise Refused(str(error))
    return jsonify({"data": replace("contracts", contract_id, contract)})


@hub.post("/contracts/allocate")
@require_user(roles=EDITORS)
def allocate_engineer():
    payload = request.get_json(silent=True) or {}
    visits, engineer = payload.get("visits"), payload.get("engineer")
    if not isinstance(visits, list) or not visits or not isinstance(engineer, str):
        raise Refused("Choose an engineer and at least one visit.")
    months = {}
    for visit in visits:
        months.setdefault(visit.get("id"), []).append(visit.get("month"))
    changed = 0
    for contract in fetch("contracts"):
        if contract["id"] in months:
            for month in months[contract["id"]]:
                logic.set_visit(contract, month, date.today(), engineer=engineer)
                changed += 1
            replace("contracts", contract["id"], contract)
    return jsonify({"changed": changed})


@hub.post("/contracts/auto-schedule")
@require_user(roles=EDITORS)
def auto_schedule():
    changed = 0
    for contract in fetch("contracts"):
        if contract.get("status") != "Closed":
            schedule = logic.fill_schedule(contract, date.today())
            if schedule != (contract.get("schedule") or {}):
                contract["schedule"] = schedule
                logic.refresh_visit_dates(contract)
                replace("contracts", contract["id"], contract)
                changed += 1
    return jsonify({"changed": changed})


@hub.post("/contracts/<contract_id>/close")
@require_user(roles=EDITORS)
def close_contract(contract_id):
    contract = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    clean, problem = validate_record("contracts", {
        "closed_date": payload.get("closed_date") or today(), "close_reason": payload.get("close_reason") or "Other",
        "close_note": payload.get("close_note") or "",
    }, partial=True)
    if problem:
        raise Refused(problem)
    return jsonify({"data": replace("contracts", contract_id, {**contract, **clean, "status": "Closed"})})


@hub.post("/contracts/<contract_id>/reopen")
@require_user(roles=EDITORS)
def reopen_contract(contract_id):
    contract = require_record("contracts", contract_id)
    return jsonify({"data": replace("contracts", contract_id, {
        **contract, "status": "Active", "closed_date": "", "close_reason": "", "close_note": "",
    })})


@hub.post("/contracts/<contract_id>/renew")
@require_user(roles=EDITORS)
def renew_contract(contract_id):
    old = require_record("contracts", contract_id)
    payload = request.get_json(silent=True) or {}
    terms = {"so": payload.get("so"), "period_text": payload.get("period_text"), "start": payload.get("start"), "expiry": payload.get("expiry")}
    clean, problem = validate_record("contracts", terms, partial=True)
    if problem:
        raise Refused(problem)
    if not clean.get("start") or not clean.get("expiry"):
        raise Refused("Enter the new start and expiry dates.")
    fresh = {
        key: value for key, value in old.items()
        if key in COLLECTIONS["contracts"]["fields"] and key not in (
            "schedule", "last_visit", "next_due", "visited_by", "invoice", "invoice_no", "invoice_date",
            "closed_date", "close_reason", "close_note", "renewed_to",
        )
    }
    fresh.update(clean, report="Pending", lab="Pending", grn="", renewed_from=contract_id, status="Active")
    prepare_contract(fresh, None)
    created = insert("contracts", fresh)
    replace("contracts", contract_id, {
        **old, "status": "Closed", "close_reason": "Renewed", "closed_date": today(), "renewed_to": created["id"],
    })
    shared = {"contract_id": created["id"], "so": fresh.get("so")}
    if payload.get("copy_samples"):
        for sample in fetch("samples", parent=contract_id):
            insert("samples", {**copied("samples", sample), "contract_id": created["id"], "status": "Pending",
                               "report": "Not submitted", "collection_date": "", "next_due": "", "expiry": ""})
    if payload.get("copy_ppm"):
        for planner in fetch("ppm_planners", parent=contract_id):
            insert("ppm_planners", {**copied("ppm_planners", planner), "contract_id": created["id"]})
    if payload.get("copy_chemicals"):
        for line in fetch("chemical_lines", parent=contract_id):
            insert("chemical_lines", {**copied("chemical_lines", line), **shared, "months": {}})
    return jsonify({"data": created}), 201


def copied(collection, row):
    return {key: value for key, value in row.items() if key in COLLECTIONS[collection]["fields"]}


# ---- Lab samples and PPM planners -----------------------------------------------------------------------------------

@hub.post("/samples/<sample_id>/collect")
@require_user(roles=EDITORS)
def collect_sample(sample_id):
    sample = require_record("samples", sample_id)
    payload = request.get_json(silent=True) or {}
    clean, problem = validate_record("samples", {
        "collection_date": payload.get("collection_date"), "collected_by": payload.get("collected_by") or "",
    }, partial=True)
    if problem or not clean.get("collection_date"):
        raise Refused(problem or "Enter the collection date.")
    following, expiry = logic.sample_dates(clean["collection_date"], sample.get("duration"), load_settings()["durations"])
    return jsonify({"data": replace("samples", sample_id, {
        **sample, **clean, "status": "Collected", "report": "Not submitted", "next_due": following, "expiry": expiry,
    })})


def planned_months(frequency):
    spacing = {"Monthly": 1, "Twice monthly": 1, "Bimonthly": 2, "Quarterly": 3, "Half-yearly": 6, "Yearly": 12}.get(frequency)
    if not spacing:
        return [""] * 12
    amount = 2 if frequency == "Twice monthly" else 1
    return [amount if index % spacing == 0 else "" for index in range(12)]


@hub.post("/ppm_planners/generate")
@require_user(roles=EDITORS)
def generate_planners():
    payload = request.get_json(silent=True) or {}
    year = payload.get("year")
    if not isinstance(year, int) or not 2000 <= year <= 2100:
        raise Refused("Choose a year.")
    existing = {planner.get("contract_id") for planner in fetch("ppm_planners") if planner.get("year") == year}
    samples = fetch("samples")
    created = 0
    for contract in fetch("contracts"):
        if contract.get("status") == "Closed" or contract["id"] in existing:
            continue
        rows = []
        for sample in samples:
            if sample.get("contract_id") == contract["id"]:
                frequency = sample.get("duration") if sample.get("duration") != "Once" else "As required"
                service = f"{sample.get('test')} Analysis"
                if not any(row["service"] == service for row in rows):
                    rows.append({"service": service, "frequency": frequency, "months": planned_months(frequency)})
        rows = rows or [
            {"service": name, "frequency": frequency, "months": planned_months(frequency)}
            for name, frequency in (("Chemical Analysis", "Monthly"), ("Microbiological Analysis", "Quarterly"), ("Legionella Analysis", "Quarterly"))
        ]
        insert("ppm_planners", {
            "contract_id": contract["id"], "client": contract.get("client"), "site": contract.get("site"),
            "contact": contract.get("contact"), "year": year, "first_month": 1, "activity": "Planned Preventive Maintenance",
            "groups": [{"name": f"Services for {contract.get('site')}", "rows": rows}],
        })
        created += 1
    return jsonify({"created": created})


# ---- Chemical delivery, inventory and delivery notes ----------------------------------------------------------------

def link_stock(line, month, quantity, settings):
    """A month's delivery shows as an OUT movement of the matching inventory item. Returns a message when it cannot."""
    if not settings.get("inventory_link"):
        return ""
    name = (line.get("chemical") or "").strip().lower()
    item = next((row for row in fetch("inventory_items") if (row.get("name") or "").strip().lower() == name), None)
    if not item:
        return f"No inventory item is called {line.get('chemical')}, so stock was not changed." if quantity else ""
    reference = f"chemical:{line['id']}:{month}"
    move = next((row for row in fetch("inventory_moves", parent=item["id"]) if row.get("reference") == reference), None)
    if not quantity:
        if move:
            soft_delete(move["id"])
        return ""
    fields = {
        "item_id": item["id"], "type": "OUT", "qty": quantity, "date": f"{month}-01", "reference": reference,
        "project": line.get("site") or "", "client": line.get("client") or "",
    }
    if move:
        replace("inventory_moves", move["id"], {**move, **fields})
    else:
        insert("inventory_moves", fields)
    return ""


def record_delivery(line, month, quantity, settings):
    months = dict(line.get("months") or {})
    delivered_elsewhere = sum(float(value or 0) for key, value in months.items() if key != month)
    message = ""
    if settings.get("cap_deliveries") and line.get("contract_qty") and quantity:
        room = max(float(line["contract_qty"]) - delivered_elsewhere, 0)
        if quantity > room:
            quantity, message = room, f"Limited to the contract quantity ({room:g})."
    if quantity:
        months[month] = quantity
    else:
        months.pop(month, None)
    line["months"] = months
    saved = replace("chemical_lines", line["id"], line)
    return saved, link_stock(line, month, quantity, settings) or message


@hub.post("/chemical_lines/<line_id>/month")
@require_user(roles=EDITORS)
def set_month(line_id):
    line = require_record("chemical_lines", line_id)
    payload = request.get_json(silent=True) or {}
    month, quantity = payload.get("month"), payload.get("qty")
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise Refused("Choose a valid month.")
    try:
        quantity = float(quantity) if quantity not in (None, "") else 0
    except (TypeError, ValueError):
        raise Refused("Quantity must be a number.")
    if quantity < 0:
        raise Refused("Quantity cannot be negative.")
    saved, message = record_delivery(line, month, int(quantity) if quantity.is_integer() else quantity, load_settings())
    return jsonify({"data": saved, "message": message})


@hub.post("/delivery_notes/<note_id>/to-chemicals")
@require_user(roles=EDITORS)
def note_to_chemicals(note_id):
    note = require_record("delivery_notes", note_id)
    month = (note.get("date") or today())[:7]
    settings, lines, added, messages = load_settings(), fetch("chemical_lines"), 0, []
    for item in note.get("items") or []:
        name, quantity = (item.get("name") or "").strip(), item.get("qty")
        try:
            quantity = float(quantity)
        except (TypeError, ValueError):
            continue
        if not name or not quantity:
            continue
        line = next((row for row in lines if row.get("chemical", "").lower() == name.lower() and (
            row.get("contract_id") == note.get("contract_id") if note.get("contract_id") else row.get("site") == note.get("site")
        )), None)
        if not line:
            line = insert("chemical_lines", {
                "contract_id": note.get("contract_id") or "", "client": note.get("client"), "site": note.get("site"),
                "so": note.get("so"), "chemical": name, "description": item.get("description"), "uom": item.get("unit"),
                "contract_qty": 0, "months": {},
            })
            lines.append(line)
        current = float((line.get("months") or {}).get(month) or 0)
        total = current + quantity
        line, message = record_delivery(line, month, int(total) if float(total).is_integer() else total, settings)
        lines = [line if row["id"] == line["id"] else row for row in lines]
        messages.append(message)
        added += 1
    return jsonify({"added": added, "message": " ".join(text for text in messages if text)})


@hub.post("/delivery_notes/import")
@require_user(roles=EDITORS)
def import_notes():
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename.lower().endswith(".xlsx"):
        raise Refused("Choose an Excel (.xlsx) file.")
    try:
        rows = documents.read_delivery_sheet(uploaded.read(MAX_FILE_BYTES))
    except Exception:
        raise Refused("That file could not be read as a delivery master sheet.")
    existing = {note.get("dn"): note for note in fetch("delivery_notes")}
    added = updated = 0
    for row in rows:
        clean, problem = validate_record("delivery_notes", row, partial=True)
        if problem:
            raise Refused(f"{row.get('dn') or 'A row'}: {problem}")
        current = existing.get(clean.get("dn"))
        if current:
            data = {**current, **clean}
            prepare_note(data, current)
            replace("delivery_notes", current["id"], data)
            updated += 1
        else:
            clean["date"] = clean.get("date") or today()
            prepare_note(clean, None)
            existing[clean["dn"]] = insert("delivery_notes", clean)
            added += 1
    return jsonify({"added": added, "updated": updated})


# ---- Staff ----------------------------------------------------------------------------------------------------------

STAFF_CSV_HEADERS = {
    "name": "name", "position": "position", "employee id": "employee_id", "employee_id": "employee_id", "mobile": "mobile",
    "email": "email", "status": "status", "date joined": "joined", "joined": "joined", "vehicle number": "vehicle_no",
    "vehicle name": "vehicle_name", "notes": "notes",
}


@hub.post("/staff/import")
@require_user(roles=EDITORS)
def import_staff():
    uploaded = request.files.get("file")
    if uploaded is None:
        raise Refused("Choose a CSV file.")
    try:
        text = uploaded.read(MAX_FILE_BYTES).decode("utf-8-sig")
        rows = list(csv.DictReader(io.StringIO(text)))
    except (UnicodeDecodeError, csv.Error):
        raise Refused("That file could not be read as CSV.")
    staff = fetch("staff")
    by_code = {row["employee_id"].lower(): row for row in staff if row.get("employee_id")}
    by_name = {row["name"].lower(): row for row in staff}
    added = updated = 0
    for row in rows:
        fields = {
            STAFF_CSV_HEADERS[key.strip().lower()]: (value or "").strip()
            for key, value in row.items() if key and key.strip().lower() in STAFF_CSV_HEADERS
        }
        if not fields.get("name") and not fields.get("employee_id"):
            continue
        current = by_code.get(fields.get("employee_id", "").lower()) or by_name.get(fields.get("name", "").lower())
        clean, problem = validate_record("staff", {key: value for key, value in fields.items() if value}, partial=True)
        if problem:
            raise Refused(f"{fields.get('name') or fields.get('employee_id')}: {problem}")
        if current:
            replace("staff", current["id"], {**current, **clean})
            updated += 1
        elif clean.get("name"):
            insert("staff", {"status": "Active", **clean})
            added += 1
    return jsonify({"added": added, "updated": updated})


def linked_login(person):
    return sqlalchemy_db.session.execute(select(users).where(users.c.id == person.get("user_id"))).mappings().first() if person.get("user_id") else None


def set_login_active(person):
    """A login follows its staff member: nobody who has left can still sign in."""
    if linked_login(person):
        sqlalchemy_db.session.execute(users.update().where(users.c.id == person["user_id"]).values(
            is_active=(person.get("status") or "Active") in ("Active", "On leave"), updated_at=datetime.now(timezone.utc).isoformat(),
        ))
        sqlalchemy_db.session.commit()


@hub.post("/staff/<staff_id>/login")
@require_user(roles={"administrator"})
def set_staff_login(staff_id):
    """Create a staff member's sign-in, or reset its password. Admin-level roles also need a private key."""
    person = require_record("staff", staff_id)
    payload = request.get_json(silent=True) or {}
    password, role, key = payload.get("password"), payload.get("role") or "employee", payload.get("access_key") or ""
    if not isinstance(password, str) or not 12 <= len(password) <= 512:
        raise Refused("The password must be 12 to 512 characters.")
    if role not in {"employee", "viewer", "service_coordinator", "accountant"}:
        raise Refused("Choose a valid access level.")
    if role in ADMIN_LOGIN_ROLES and not (isinstance(key, str) and 12 <= len(key) <= 512):
        raise Refused("Admin-level access needs a private key of at least 12 characters.")
    now = datetime.now(timezone.utc).isoformat()
    existing = linked_login(person)
    if existing:
        current_role = sqlalchemy_db.session.execute(select(memberships.c.role).where(
            memberships.c.user_id == existing["id"], memberships.c.organization_id == g.organization_id,
        )).scalar()
        if current_role == "administrator":
            raise Refused("Administrator passwords cannot be changed here.", 403)
        sqlalchemy_db.session.execute(users.update().where(users.c.id == existing["id"]).values(
            password_hash=hash_password(password), updated_at=now,
            access_key_hash=hash_password(key) if role in ADMIN_LOGIN_ROLES else None,
        ))
        sqlalchemy_db.session.execute(memberships.update().where(
            memberships.c.user_id == existing["id"], memberships.c.organization_id == g.organization_id,
        ).values(role=role))
        sqlalchemy_db.session.commit()
        return jsonify({"message": "Sign-in updated."})
    email = str(payload.get("email") or person.get("email") or "").strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise Refused("Enter the staff member's email to create their login.")
    if sqlalchemy_db.session.execute(select(users.c.id).where(users.c.email == email)).first():
        raise Refused("A login with this email already exists.", 409)
    user_id = str(uuid.uuid4())
    sqlalchemy_db.session.execute(users.insert().values(
        id=user_id, email=email, full_name=person.get("name"), password_hash=hash_password(password), is_active=True,
        access_key_hash=hash_password(key) if role in ADMIN_LOGIN_ROLES else None, created_at=now, updated_at=now,
    ))
    sqlalchemy_db.session.execute(memberships.insert().values(
        id=str(uuid.uuid4()), organization_id=g.organization_id, user_id=user_id, role=role, status="active", created_at=now,
    ))
    sqlalchemy_db.session.commit()
    replace("staff", staff_id, {**person, "user_id": user_id, "email": person.get("email") or email})
    return jsonify({"message": "Sign-in created."}), 201


@hub.patch("/me/profile")
@require_user()
def update_my_profile():
    name = (request.get_json(silent=True) or {}).get("full_name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 255:
        raise Refused("Enter your name (up to 255 characters).")
    sqlalchemy_db.session.execute(users.update().where(users.c.id == g.user.id).values(
        full_name=name.strip(), updated_at=datetime.now(timezone.utc).isoformat(),
    ))
    sqlalchemy_db.session.commit()
    # The staff profile carries the same name on schedules and certificates.
    person = own_staff()
    if person:
        replace("staff", person["id"], {**person, "name": name.strip()})
    return jsonify({"data": {"full_name": name.strip()}})


@hub.post("/me/photo")
@require_user()
def upload_my_photo():
    person = own_staff()
    if not person:
        raise Refused("This login has no staff profile yet.", 404)
    return store_file(person["id"], "Photo")


@hub.put("/attendance")
@require_user(roles=EDITORS)
def save_attendance():
    """Each day's mark is its own record, so clearing a day removes only that day."""
    payload = request.get_json(silent=True) or {}
    marks = payload.get("marks")
    if not isinstance(marks, list) or not marks or len(marks) > 500:
        raise Refused("Send the days to mark.")
    months = {str(mark.get("date"))[:7] for mark in marks if isinstance(mark, dict)}
    existing = {}
    for month in months:
        for row in scoped("attendance").eq("period", month).execute().data or []:
            existing[(row["data"].get("staff_id"), row["data"].get("date"))] = shaped(row)
    saved = []
    for mark in marks:
        fields = {key: mark.get(key) for key in ("staff_id", "date", "code") if mark.get(key)}
        clean, problem = validate_record("attendance", fields, partial=True)
        if problem or not clean.get("staff_id") or not clean.get("date"):
            raise Refused(problem or "Each mark needs a staff member and a date.")
        current = existing.get((clean["staff_id"], clean["date"]))
        if not clean.get("code"):
            if current:
                soft_delete(current["id"])
        elif current:
            saved.append(replace("attendance", current["id"], {**current, **clean}))
        else:
            saved.append(insert("attendance", clean))
    return jsonify({"data": saved})


# ---- Files ----------------------------------------------------------------------------------------------------------

FILE_TYPES = {
    "pdf": ("application/pdf", lambda data: data.startswith(b"%PDF-")),
    "png": ("image/png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "jpg": ("image/jpeg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "jpeg": ("image/jpeg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "webp": ("image/webp", lambda data: data[:4] == b"RIFF" and data[8:12] == b"WEBP"),
    "doc": ("application/msword", lambda data: data.startswith(b"\xd0\xcf\x11\xe0")),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", lambda data: data.startswith(b"PK")),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", lambda data: data.startswith(b"PK")),
}
COMPANY_IMAGES = {"logo", "footer", "stamp", "signature", "background"}


FILE_FIELDS = ("id", "original_filename", "image_type", "mime_type", "file_size", "created_at")


def uploads():
    return current_app.extensions["watercare_database"].table("uploaded_documents")


def files_for(record_id):
    return uploads().select("*").eq("organization_id", g.organization_id).is_("deleted_at", "null").eq(
        "related_type", "hub"
    ).eq("related_id", record_id).order("created_at", desc=True).execute().data or []


def remove_file(row):
    storage.delete_quietly(row["storage_path"])
    uploads().update({"deleted_at": datetime.now(timezone.utc).isoformat(), "updated_by": g.user.id}).eq(
        "organization_id", g.organization_id
    ).eq("id", row["id"]).execute()


def remove_with_files(record_id):
    for row in files_for(record_id):
        remove_file(row)
    soft_delete(record_id)


def record_collection(record_id):
    rows = records().select("collection").eq("organization_id", g.organization_id).is_("deleted_at", "null").eq(
        "id", record_id
    ).limit(1).execute().data
    return rows[0]["collection"] if rows else None


def identity_file(row):
    """Staff passports, visas and Emirates IDs are for the identity roles; a staff photo is for everyone."""
    return record_collection(row["related_id"]) == "staff" and row.get("image_type") != "Photo"


VISIT_FILE = re.compile(r"(Before|After):(\d{4}-\d{2})")


def own_visit_file(record_id, kind):
    """Engineers reach only the completion photos of visits allocated to them."""
    match = VISIT_FILE.fullmatch(kind or "")
    if not match or record_collection(record_id) != "contracts":
        return False
    return (find("contracts", record_id).get("schedule") or {}).get(match.group(2), {}).get("engineer") in own_names()


def store_file(record_id, kind):
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        raise Refused("Select a file to upload.")
    filename = uploaded.filename.replace("\\", "/").split("/")[-1]
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    data = uploaded.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        return failure("file_too_large", "Files must be 20 MB or smaller.", 413)
    if extension not in FILE_TYPES or not data or not FILE_TYPES[extension][1](data):
        raise Refused("Only PDF, Word, Excel, JPG, PNG or WebP files are accepted.")
    content_type = FILE_TYPES[extension][0]
    storage_path = f"{g.organization_id}/hub/{record_id}/{uuid.uuid4().hex}-{secure_filename(filename) or 'file'}"
    try:
        storage.save(storage_path, data, content_type)
        created = uploads().insert({
            "organization_id": g.organization_id, "related_type": "hub", "related_id": record_id,
            "original_filename": filename[:255], "storage_path": storage_path, "mime_type": content_type,
            "file_size": len(data), "uploaded_by": g.user.id, "image_type": kind,
        }).execute().data[0]
    except Exception:
        storage.delete_quietly(storage_path)
        current_app.logger.exception("Operations file upload failed.")
        return failure("upload_failed", "The file could not be stored.", 503)
    return jsonify({"data": {key: created[key] for key in FILE_FIELDS}}), 201


@hub.route("/files", methods=["GET", "POST"])
@require_user()
def files_route():
    if request.method == "GET":
        record_id = request.args.get("record_id")
        if not record_id:
            raise Refused("Choose a record.")
        rows = files_for(record_id)
        if g.role == "employee":
            rows = [row for row in rows if own_visit_file(record_id, row["image_type"])]
        elif g.role not in IDENTITY_ROLES:
            rows = [row for row in rows if not identity_file(row)]
        return jsonify({"data": [{key: row[key] for key in FILE_FIELDS} for row in rows]})
    record_id = request.form.get("record_id")
    kind = (request.form.get("kind") or "Other")[:40]
    if not record_id:
        raise Refused("Select a file to upload.")
    if g.role == "employee":
        if not own_visit_file(record_id, kind):
            return failure("forbidden", "Staff may only upload completion photos for their own visits.", 403)
    elif g.role not in EDITORS:
        return failure("forbidden", "Your account has view-only access.", 403)
    elif record_id == g.organization_id:
        if kind not in COMPANY_IMAGES:
            raise Refused("Unknown company image.")
    else:
        collection = record_collection(record_id)
        if not collection:
            raise Refused("Record not found.", 404)
        if collection == "staff" and kind != "Photo" and g.role not in IDENTITY_ROLES:
            return failure("forbidden", "Your account cannot add identity documents.", 403)
    return store_file(record_id, kind)


def file_row(file_id):
    rows = uploads().select("*").eq("organization_id", g.organization_id).is_("deleted_at", "null").eq(
        "related_type", "hub"
    ).eq("id", file_id).limit(1).execute().data
    if not rows:
        raise Refused("File not found.", 404)
    return rows[0]


@hub.get("/files/<file_id>")
@require_user()
def read_file(file_id):
    row = file_row(file_id)
    # The site logo and a person's own photo show for every signed-in user.
    shared = row["related_id"] == g.organization_id or row["image_type"] == "Photo"
    if g.role == "employee" and not shared and not own_visit_file(row["related_id"], row["image_type"]):
        return failure("forbidden", "Your account cannot open this file.", 403)
    if g.role not in IDENTITY_ROLES and g.role != "employee" and identity_file(row):
        return failure("forbidden", "Your account cannot open identity documents.", 403)
    data = storage.read(row["storage_path"])
    if data is None:
        raise Refused("File not found.", 404)
    inline = request.args.get("inline") == "1" and row["mime_type"].startswith("image/")
    return send_file(io.BytesIO(data), mimetype=row["mime_type"], as_attachment=not inline, download_name=row["original_filename"])


@hub.delete("/files/<file_id>")
@require_user(roles=EDITORS)
def delete_file(file_id):
    row = file_row(file_id)
    if g.role not in IDENTITY_ROLES and identity_file(row):
        return failure("forbidden", "Your account cannot remove identity documents.", 403)
    remove_file(row)
    return jsonify({"message": "File deleted."})


@hub.get("/file-index")
@require_user()
def file_index():
    """Each record's newest photo and its file types, in one call, for the staff cards and attendance grid."""
    if g.role not in READERS and request.args.get("collection") != "staff":
        return failure("forbidden", "Your account cannot open this list.", 403)
    wanted = {row["id"] for row in scoped(request.args.get("collection", "")).execute().data or []}
    rows = uploads().select("id,related_id,image_type").eq("organization_id", g.organization_id).is_("deleted_at", "null").eq(
        "related_type", "hub"
    ).order("created_at", desc=True).execute().data or []
    index = {}
    for row in rows:
        if row["related_id"] in wanted:
            entry = index.setdefault(row["related_id"], {"photo": None, "kinds": []})
            if row["image_type"] == "Photo":
                entry["photo"] = entry["photo"] or row["id"]
            elif g.role not in IDENTITY_ROLES:
                continue
            if row["image_type"] not in entry["kinds"]:
                entry["kinds"].append(row["image_type"])
    return jsonify({"data": index})


@hub.get("/company-images")
@require_user()
def company_images():
    latest = {}
    for row in files_for(g.organization_id):
        latest.setdefault(row["image_type"], row["id"])
    return jsonify({"data": latest})


# ---- Downloads ------------------------------------------------------------------------------------------------------

CSV_TYPE = "text/csv"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def csv_file(headers, rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows([[documents.safe_cell(value) for value in row] for row in rows])
    return io.BytesIO(output.getvalue().encode("utf-8-sig"))


@hub.post("/export")
@require_user(roles=READERS)
def export_table():
    """The rows the page is showing: filters are applied in the page, so this exports what is on screen."""
    payload = request.get_json(silent=True) or {}
    title, output, headers, rows = payload.get("title"), payload.get("format"), payload.get("headers"), payload.get("rows")
    if output not in ("xlsx", "pdf", "csv") or not isinstance(title, str) or not isinstance(headers, list) or not isinstance(rows, list):
        raise Refused("Send a title, a format, headers and rows.")
    if len(rows) > 20000:
        raise Refused("Narrow the filters: exports are limited to 20,000 rows.")
    company = report_preferences()[0]
    filename = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "export"
    raw, mime = {
        "xlsx": lambda: (documents.table_workbook(title, headers, rows, company), XLSX_TYPE),
        "pdf": lambda: (documents.table_pdf(title, headers, rows, company), "application/pdf"),
        "csv": lambda: (csv_file(headers, rows), CSV_TYPE),
    }[output]()
    return send_file(raw, mimetype=mime, as_attachment=True, download_name=f"wolgan-{filename}.{output}")


@hub.get("/export/client-schedule")
@require_user(roles=READERS)
def export_client_schedule():
    """Active contracts in the client schedule layout: one block per client, its sites beneath it."""
    output = request.args.get("format", "xlsx")
    if output not in ("xlsx", "pdf", "csv"):
        raise Refused("format must be csv, xlsx or pdf.")
    table = schedule_rows([row for row in fetch("contracts") if row.get("status") != "Closed"])
    company = report_preferences()[0]
    if output == "xlsx":
        workbook, raw = schedule_workbook(table, documents.safe_cell, company), io.BytesIO()
        workbook.save(raw)
        raw.seek(0)
        mime = XLSX_TYPE
    elif output == "pdf":
        raw, mime = documents.table_pdf("Client Schedule", SCHEDULE_HEADERS, table, company), "application/pdf"
    else:
        raw, mime = csv_file(SCHEDULE_HEADERS, table), CSV_TYPE
    return send_file(raw, mimetype=mime, as_attachment=True, download_name=f"wolgan-client-schedule.{output}")


@hub.post("/reports/word")
@require_user(roles=READERS)
def report_word():
    payload = request.get_json(silent=True) or {}
    report = payload.get("report")
    if not isinstance(report, dict):
        raise Refused("Send the report to convert.")

    def image(file_id):
        rows = uploads().select("storage_path,related_id").eq("organization_id", g.organization_id).is_(
            "deleted_at", "null").eq("related_type", "hub").eq("id", str(file_id)).limit(1).execute().data
        return storage.read(rows[0]["storage_path"]) if rows else None

    images = {}
    for row in files_for(g.organization_id):
        images.setdefault(row["image_type"], row["id"])
    raw = documents.report_docx(report, image, images, report_preferences()[0])
    name = re.sub(r"[^A-Za-z0-9]+", "-", report.get("title") or report.get("reference") or "report").strip("-") or "report"
    return send_file(raw, mimetype=FILE_TYPES["docx"][0], as_attachment=True, download_name=f"{name}.docx")


@hub.get("/backup")
@require_user(roles={"administrator"})
def backup():
    rows = records().select("id,collection,parent_id,period,data,created_at,updated_at").eq(
        "organization_id", g.organization_id
    ).is_("deleted_at", "null").execute().data or []
    raw = io.BytesIO(json.dumps({"exported_at": datetime.now(timezone.utc).isoformat(), "records": rows}).encode("utf-8"))
    return send_file(raw, mimetype="application/json", as_attachment=True, download_name=f"wolgan-backup-{today()}.json")


# ---- Dashboard ------------------------------------------------------------------------------------------------------

def days_until(value, now):
    try:
        return (date.fromisoformat(value) - now).days
    except (TypeError, ValueError):
        return None


def number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def stock_levels(items, moves):
    change = {}
    for move in moves:
        sign = 1 if move.get("type") == "IN" else -1
        change[move.get("item_id")] = change.get(move.get("item_id"), 0) + sign * number(move.get("qty"))
    return {item["id"]: number(item.get("opening_stock")) + change.get(item["id"], 0) for item in items}


@hub.get("/overview")
@require_user(roles=READERS)
def overview():
    now, this_month = date.today(), today()[:7]
    contracts = fetch("contracts")
    active = [row for row in contracts if row.get("status") != "Closed"]
    samples, planners, lines = fetch("samples"), fetch("ppm_planners"), fetch("chemical_lines")
    notes, items, moves = fetch("delivery_notes"), fetch("inventory_items"), fetch("inventory_moves")
    staff, holidays = fetch("staff"), fetch("holidays")
    shifts = [row for row in fetch("staff_schedule") if row.get("date") == today()]
    marks = [row for row in fetch_period("attendance", this_month) if row.get("date") == today()]
    stock = stock_levels(items, moves)
    expiry_days = [days_until(row.get("expiry"), now) for row in active]
    due_days = [days_until(row.get("next_due"), now) for row in active]
    month_visits = [row["schedule"][this_month] for row in active if this_month in (row.get("schedule") or {})]
    low = sorted(
        [{"name": item.get("name"), "stock": stock[item["id"]]} for item in items if stock[item["id"]] <= number(item.get("min_stock"))],
        key=lambda item: item["stock"],
    )
    documents_due = []
    if g.role in IDENTITY_ROLES:
        for person in staff:
            if person.get("status", "Active") in ("Active", "On leave"):
                for label, field in (("Visa", "visa_expiry"), ("EID", "eid_expiry"), ("Passport", "passport_expiry")):
                    left = days_until(person.get(field), now)
                    if left is not None and left <= 60:
                        documents_due.append({"name": person.get("name"), "document": label, "date": person[field], "days": left})
    sections = fetch("sections")
    assets = calibration = None
    for section in sections:
        rows = fetch("section_rows", parent=section["id"])
        if section.get("system") == "assets":
            assets = {
                "items": len(rows),
                "value": sum(number(row["values"].get("cost")) * number(row["values"].get("qty") or 1) for row in rows),
                "repair": sum(row["values"].get("condition") in ("Needs repair", "Damaged") for row in rows),
            }
        if section.get("system") == "calibration":
            due = []
            for row in rows:
                left = days_until(row["values"].get("calibration_due"), now)
                if left is not None and left <= 30:
                    due.append({"name": row["values"].get("instrument"), "date": row["values"]["calibration_due"], "days": left})
            calibration = {"instruments": len(rows), "due": sorted(due, key=lambda item: item["days"])}
    return jsonify({
        "contracts": {
            "active": len(active),
            "expired": sum(left is not None and left < 0 for left in expiry_days),
            "expiring": sum(left is not None and 0 <= left <= 60 for left in expiry_days),
            "overdue": sum(left is not None and left < 0 for left in due_days),
            "done_this_month": sum(visit.get("status") == "done" for visit in month_visits),
            "visits_this_month": len(month_visits),
            "reports_pending": sum(row.get("report") == "Pending" for row in active),
            "grn_pending": sum(row.get("grn") in ("Pending", "Requested") for row in active),
            "lab_pending": sum(row.get("lab") in ("Pending", "Sample sent") for row in active),
            "invoices_pending": sum(row.get("invoice") == "Pending" for row in active),
        },
        "samples": {
            "total": len(samples), "pending": sum(row.get("status") == "Pending" for row in samples),
            "reports": sum(row.get("report") != "Received" for row in samples),
        },
        "planners": {"total": len(planners), "sites": len({row.get("contract_id") for row in planners})},
        "chemicals": {
            "lines": len(lines), "sites": len({row.get("contract_id") or row.get("site") for row in lines}),
        },
        "notes": {"total": len(notes), "amount": sum(number(row.get("amount")) for row in notes)},
        "inventory": {
            "items": len(items), "value": sum(stock[item["id"]] * number(item.get("unit_cost")) for item in items),
            "low": len(low), "low_items": low[:6],
        },
        "staff": {
            "active": sum(row.get("status", "Active") == "Active" for row in staff), "documents": sorted(documents_due, key=lambda item: item["days"])[:8],
        },
        "attendance": {
            "present": sum(row.get("code") == "P" for row in marks), "absent": sum(row.get("code") == "A" for row in marks),
            "leave": sum(row.get("code") in ("AL", "EL") for row in marks),
        },
        "schedule_today": len(shifts),
        "holidays": sorted(
            [row for row in holidays if row.get("date", "") >= today()], key=lambda row: row["date"],
        )[:3],
        "assets": assets, "calibration": calibration,
        "reports": len(fetch("reports")),
    })


def fetch_period(collection, month):
    return [shaped(row) for row in scoped(collection).eq("period", month).execute().data or []]


def checked_range():
    start, end = request.args.get("from", ""), request.args.get("to", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
        raise Refused("Both from and to dates are required.")
    return start, end


VISIT_LABELS = {"due": "Due", "done": "Done", "missed": "Missed", "na": "Not applicable"}


@hub.get("/calendar")
@require_user()
def calendar():
    """AMC visits and lab sample due dates, in the shape of the dashboard's calendar tasks."""
    start, end = checked_range()
    client_id = request.args.get("client_id")
    contracts = fetch("contracts")
    if g.role == "employee":
        contracts = own_visits(contracts)
    elif g.role not in READERS:
        return jsonify({"data": []})
    items = []
    for contract in contracts:
        if contract.get("status") == "Closed" or (client_id and contract.get("client_id") != client_id):
            continue
        for month, visit in (contract.get("schedule") or {}).items():
            day = visit.get("date") or f"{month}-01"
            if start <= day <= end and visit.get("status") != "na":
                items.append({
                    "id": f"{contract['id']}:{month}", "title": f"Site visit · {contract.get('site')}", "record_type": "visit",
                    "status": VISIT_LABELS.get(visit.get("status"), "Due"), "scheduled_date": day, "contract_id": contract["id"],
                    "month": month, "location": contract.get("location"), "description": contract.get("system_details"),
                    "engineer_name": visit.get("engineer"), "approval": visit.get("approval"), "rejection_reason": visit.get("reason"),
                    "completion": visit.get("completion"),
                    "scheduled_time": contract.get("visit_time"),
                    "project": {"client_name": contract.get("client"), "name": contract.get("site"), "service": contract.get("service") or "Site visit", "so_no": contract.get("so")},
                })
    if g.role in READERS:
        wanted = {contract["id"]: contract for contract in contracts}
        for sample in fetch("samples"):
            day, contract = sample.get("next_due") or "", wanted.get(sample.get("contract_id"))
            if start <= day <= end and (contract or not client_id) and (not contract or contract.get("status") != "Closed"):
                if client_id and contract.get("client_id") != client_id:
                    continue
                items.append({
                    "id": sample["id"], "title": f"{sample.get('test')} sample · {sample.get('site')}", "record_type": "sample",
                    "status": sample.get("status"), "scheduled_date": day, "contract_id": sample.get("contract_id"),
                    "location": sample.get("location") or (contract or {}).get("location"), "description": sample.get("points"),
                    "engineer_name": sample.get("collected_by"),
                    "project": {"client_name": sample.get("client"), "name": sample.get("site"), "service": "Lab sample"},
                })
    return jsonify({"data": sorted(items, key=lambda item: item["scheduled_date"])})


def site_state(contract):
    """The site's map pin colour: what needs attention first, otherwise whether its last visit is done."""
    visits = sorted((contract.get("schedule") or {}).items())
    if any(visit.get("approval") == PENDING for _, visit in visits):
        return PENDING
    if any(visit.get("approval") == REJECTED and visit.get("status") != "done" for _, visit in visits):
        return REJECTED
    if any(visit.get("status") == "due" and (visit.get("date") or f"{month}-01") <= today() for month, visit in visits):
        return "Pending"
    return APPROVED if any(visit.get("status") == "done" for _, visit in visits) else "Pending"


@hub.get("/site-locations")
@require_user()
def site_locations():
    """AMC sites with a saved map position, for the dashboard map."""
    contracts = fetch("contracts")
    if g.role == "employee":
        contracts = own_visits(contracts)
    elif g.role not in READERS:
        return jsonify({"data": []})
    client_id = request.args.get("client_id")
    return jsonify({"data": [
        {**{key: contract.get(key) for key in ("id", "site", "client", "so", "location", "latitude", "longitude", "visited_by", "next_due", "system_details", "frequency", "service")},
         "state": site_state(contract)}
        for contract in contracts
        if contract.get("status") != "Closed" and contract.get("latitude") not in (None, "") and contract.get("longitude") not in (None, "")
        and (not client_id or contract.get("client_id") == client_id)
    ]})
