"""What each Operations collection may hold, and the starting lists, settings and built-in sections.

Every record lives in hub_records as JSON; this file is the one place that says which fields a collection accepts.
A field not listed here is refused, so a browser cannot store anything the pages do not know about.
"""
import re
from datetime import date

TEXT_LIMIT = 500
LONG_LIMIT = 20000
MAX_RECORD_BYTES = 1_500_000  # D1 refuses a row above 2 MB

SITE_FIELDS = "client client_id site so contact mobile alternate location map_link"


def spec(required="", text="", long="", number="", dates="", json="", parent=None, period=None):
    fields = {}
    for kind, names in (("text", text), ("long", long), ("number", number), ("date", dates), ("json", json)):
        fields.update({name: kind for name in names.split()})
    return {"required": tuple(required.split()), "fields": fields, "parent": parent, "period": period}


COLLECTIONS = {
    "contracts": spec(
        required="site",
        text=f"{SITE_FIELDS} service visit_time engineer period_text frequency visited_by report grn lab microbiology "
             "legionella status close_reason invoice invoice_no source renewed_from renewed_to",
        long="system_details close_note", number="latitude longitude",
        dates="start expiry last_visit next_due closed_date invoice_date",
        json="schedule",
    ),
    "grn_projects": spec(required="project", text="project quote po so status"),
    "samples": spec(
        required="site test",
        text="contract_id client site water_system test duration points contact mobile location status report collected_by laboratory",
        long="notes results interpretation", number="qty_due", dates="collection_date next_due expiry", parent="contract_id",
    ),
    "ppm_planners": spec(
        required="site year",
        text="contract_id client site activity contact", number="year first_month", json="groups", parent="contract_id",
    ),
    "chemical_lines": spec(
        required="chemical",
        text="contract_id client site so block system supplier chemical description uom",
        long="notes", number="contract_qty", json="months", parent="contract_id",
    ),
    "inventory_items": spec(
        required="name",
        text="code name category uom location supplier", long="notes", number="opening_stock min_stock unit_cost",
    ),
    "inventory_moves": spec(
        required="item_id type qty date",
        text="item_id type project client reference", long="notes", number="qty", dates="date", parent="item_id",
    ),
    "delivery_notes": spec(
        required="date",
        text="dn contract_id client site so po address contact mobile type driver driver_mobile helpers status "
             "delivered_by received_by signed customer_text",
        long="notes", number="helper_count amount", dates="date", json="items", parent="contract_id",
    ),
    "staff": spec(
        required="name",
        text="name position employee_id mobile email status specialization availability eid_no visa_no passport_no "
             "vehicle_no vehicle_name",
        long="notes", dates="dob joined left eid_renewal eid_expiry visa_renewal visa_expiry passport_expiry",
    ),
    "staff_schedule": spec(
        required="date staff",
        text="staff shift site task status", long="notes", dates="date", period="date",
    ),
    "attendance": spec(
        required="staff_id date code", text="staff_id code", dates="date", parent="staff_id", period="date",
    ),
    "holidays": spec(required="date name", text="name", dates="date"),
    "sections": spec(required="name", text="name icon system", number="position", json="columns"),
    "section_rows": spec(required="section_id", text="section_id", json="values", parent="section_id"),
    "reports": spec(
        required="kind",
        text="kind project contract_id reference title", dates="date", json="doc", parent="contract_id",
    ),
    "report_templates": spec(required="name kind", text="name kind", json="doc"),
}

# Staff identity details are only shown to, and only changed by, these roles.
IDENTITY_ROLES = {"administrator", "accountant"}
IDENTITY_FIELDS = (
    "eid_no", "eid_renewal", "eid_expiry", "visa_no", "visa_renewal", "visa_expiry", "passport_no", "passport_expiry", "dob",
)

CONTRACT_DEFAULTS = {"report": "Pending", "grn": "", "lab": "Pending", "invoice": "Pending", "status": "Active", "source": "AMC"}
DURATIONS = {"Monthly": 30, "Monthly twice": 15, "Bimonthly": 60, "Quarterly": 90, "Half-yearly": 180, "Yearly": 365, "Once": 0}

DEFAULT_SETTINGS = {
    "tests": ["Microbiology", "Legionella", "TPC"],
    "water_systems": ["Domestic water", "Chilled water", "Swimming pool", "Cooling tower", "Other"],
    "durations": [{"name": name, "days": days} for name, days in DURATIONS.items()],
    "chemicals": ["STABILFLUID 620", "SANITER 413", "SANITER 420", "Dispersol 8300"],
    "dn_types": {
        "Chemicals": {"items": [], "units": ["Drum", "Can", "Kg", "Ltr", "Bag", "Nos"]},
        "Spare parts": {"items": [], "units": ["Nos", "Qty", "Set", "Pcs", "Mtr"]},
        "Equipment": {"items": [], "units": ["Nos", "Set", "Pcs"]},
        "Consumables": {"items": [], "units": ["Nos", "Pack", "Box", "Roll"]},
        "Lab reagents": {"items": [], "units": ["Bottle", "Box", "Kit", "Ltr"]},
        "Other": {"items": [], "units": ["Nos", "Lot"]},
    },
    "dn_start": 1,
    "attendance_codes": [
        {"code": "P", "name": "Present", "color": "#147D68"},
        {"code": "A", "name": "Absent", "color": "#C0574E"},
        {"code": "H", "name": "Holiday", "color": "#3C7894"},
        {"code": "AL", "name": "Annual vacation", "color": "#A47727"},
        {"code": "EL", "name": "Emergency leave", "color": "#8B6B9F"},
    ],
    "weekly_off": 0,  # Sunday; JavaScript and this list both count from Sunday = 0
    "inventory_link": True,
    "cap_deliveries": False,
    "team_ui": {},
}

# Moon-sighted dates are estimates to be confirmed against the official announcement.
DEFAULT_HOLIDAYS = (
    ("2026-12-02", "National Day"), ("2026-12-03", "National Day"), ("2027-01-01", "New Year"),
    ("2027-03-09", "Eid Al Fitr (approx.)"), ("2027-03-10", "Eid Al Fitr (approx.)"), ("2027-03-11", "Eid Al Fitr (approx.)"),
    ("2027-05-15", "Arafat Day (approx.)"), ("2027-05-16", "Eid Al Adha (approx.)"), ("2027-05-17", "Eid Al Adha (approx.)"),
    ("2027-05-18", "Eid Al Adha (approx.)"), ("2027-06-06", "Islamic New Year (approx.)"),
    ("2027-08-14", "Prophet's Birthday (approx.)"), ("2027-12-02", "National Day"), ("2027-12-03", "National Day"),
    ("2028-01-01", "New Year"), ("2028-02-26", "Eid Al Fitr (approx.)"), ("2028-02-27", "Eid Al Fitr (approx.)"),
    ("2028-02-28", "Eid Al Fitr (approx.)"), ("2028-05-04", "Arafat Day (approx.)"), ("2028-05-05", "Eid Al Adha (approx.)"),
    ("2028-05-06", "Eid Al Adha (approx.)"), ("2028-05-07", "Eid Al Adha (approx.)"),
    ("2028-05-25", "Islamic New Year (approx.)"), ("2028-08-03", "Prophet's Birthday (approx.)"),
    ("2028-12-02", "National Day"), ("2028-12-03", "National Day"),
)

COLUMN_TYPES = {"text", "number", "date", "select", "long"}
BUILT_IN_SECTIONS = (
    {
        "system": "assets", "name": "Assets", "icon": "◆", "position": 1,
        "columns": [
            {"key": "item", "label": "Item", "type": "text", "required": True},
            {"key": "model", "label": "Model", "type": "text"},
            {"key": "serial", "label": "Serial Number", "type": "text"},
            {"key": "purchase_date", "label": "Purchase Date", "type": "date"},
            {"key": "supplier", "label": "Supplier", "type": "text"},
            {"key": "supplier_contact", "label": "Supplier Contact", "type": "text"},
            {"key": "supplier_mobile", "label": "Supplier Mobile", "type": "text"},
            {"key": "qty", "label": "Qty", "type": "number"},
            {"key": "cost", "label": "Cost Per Unit (AED)", "type": "number"},
            {"key": "in_charge", "label": "Material In-Charge", "type": "text", "staff": True},
            {"key": "condition", "label": "Condition", "type": "select", "filter": True,
             "options": ["Working", "Needs repair", "Damaged", "Out of service"]},
            {"key": "notes", "label": "Notes", "type": "long"},
        ],
    },
    {
        "system": "calibration", "name": "Calibration", "icon": "◇", "position": 2,
        "columns": [
            {"key": "instrument", "label": "Instrument / Meter", "type": "text", "required": True},
            {"key": "model", "label": "Model", "type": "text"},
            {"key": "mfg", "label": "Manufacturer (Mfg)", "type": "text"},
            {"key": "serial", "label": "Serial Number", "type": "text"},
            {"key": "in_charge", "label": "In-Charge", "type": "text", "staff": True},
            {"key": "in_charge_mobile", "label": "In-Charge Mobile", "type": "text"},
            {"key": "qty", "label": "Qty", "type": "number"},
            {"key": "condition", "label": "Working Condition", "type": "select", "filter": True,
             "options": ["Working Condition", "Needs repair", "Out of service"]},
            {"key": "cost", "label": "Cost (AED)", "type": "number", "total": True},
            {"key": "calibration_date", "label": "Calibration Date", "type": "date"},
            {"key": "calibration_due", "label": "Calibration Due / Expiry", "type": "date", "badge": True,
             "auto_from": "calibration_date", "auto_months": 12},
            {"key": "notes", "label": "Notes", "type": "long"},
        ],
    },
)


def _valid_date(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate_record(collection, payload, partial=False):
    """Returns (clean fields, problem). The clean copy keeps only known fields, trimmed."""
    if not isinstance(payload, dict):
        return None, "Send the record as an object."
    rules = COLLECTIONS[collection]
    unknown = set(payload) - set(rules["fields"])
    if unknown:
        return None, f"Unknown field: {sorted(unknown)[0]}."
    clean = {}
    for name, value in payload.items():
        kind = rules["fields"][name]
        if value is None or value == "":
            clean[name] = "" if kind != "json" else None
            continue
        if kind in ("text", "long"):
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                value = str(value)
            if not isinstance(value, str):
                return None, f"{name} must be text."
            value = value.strip()
            if len(value) > (TEXT_LIMIT if kind == "text" else LONG_LIMIT):
                return None, f"{name} is too long."
        elif kind == "number":
            if isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    return None, f"{name} must be a number."
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None, f"{name} must be a number."
            value = int(value) if float(value).is_integer() else value
        elif kind == "date":
            if not isinstance(value, str) or not _valid_date(value):
                return None, f"{name} must be a date (YYYY-MM-DD)."
        elif not isinstance(value, (dict, list)):
            return None, f"{name} must be a list or object."
        clean[name] = value
    if not partial:
        missing = [name for name in rules["required"] if clean.get(name) in (None, "")]
        if missing:
            return None, f"{missing[0]} is required."
    else:
        blanked = [name for name in rules["required"] if name in clean and clean[name] in (None, "")]
        if blanked:
            return None, f"{blanked[0]} is required."
    return clean, None


def validate_columns(columns):
    """A custom section's columns: needs a label, a known type and unique keys."""
    if not isinstance(columns, list) or not columns or len(columns) > 40:
        return "A section needs between 1 and 40 columns."
    seen = set()
    for column in columns:
        if not isinstance(column, dict) or not isinstance(column.get("label"), str) or not column["label"].strip():
            return "Every column needs a name."
        if column.get("type") not in COLUMN_TYPES:
            return "Column type must be text, number, date, select or long text."
        key = column.get("key")
        if not isinstance(key, str) or not re.fullmatch(r"[a-z0-9_]{1,60}", key) or key in seen:
            return "Column keys must be unique."
        seen.add(key)
        if column["type"] == "select" and not (
            isinstance(column.get("options"), list) and all(isinstance(option, str) for option in column["options"])
        ):
            return f"{column['label']} needs a list of options."
    return None


def validate_section_values(columns, values):
    """A row of a custom section: known columns only, each in its column's type."""
    if not isinstance(values, dict):
        return None, "Send the row as an object."
    by_key = {column["key"]: column for column in columns}
    unknown = set(values) - set(by_key)
    if unknown:
        return None, f"Unknown column: {sorted(unknown)[0]}."
    clean = {}
    for key, value in values.items():
        column = by_key[key]
        if value is None or value == "":
            clean[key] = ""
        elif column["type"] == "number":
            try:
                number = float(value)
            except (TypeError, ValueError):
                return None, f"{column['label']} must be a number."
            clean[key] = int(number) if number.is_integer() else number
        elif column["type"] == "date":
            if not isinstance(value, str) or not _valid_date(value):
                return None, f"{column['label']} must be a date."
            clean[key] = value
        else:
            if not isinstance(value, str) or len(value) > LONG_LIMIT:
                return None, f"{column['label']} must be text."
            clean[key] = value.strip()
    for column in columns:
        if column.get("required") and not clean.get(column["key"]):
            return None, f"{column['label']} is required."
    return clean, None
