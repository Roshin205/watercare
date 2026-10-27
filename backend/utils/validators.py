from datetime import date, time
import math
import re
import uuid


RESOURCE_FIELDS = {
    "clients": {
        "required": ("name",),
        "fields": {"name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes", "is_active"},
    },
    "engineers": {
        "required": ("full_name", "engineer_code"),
        "fields": {"engineer_code", "full_name", "email", "phone", "specialization", "availability", "user_id", "is_active"},
    },
    "projects": {
        "required": ("name", "client_id", "service"),
        "fields": {
            "name", "service", "category", "client_id", "location", "latitude", "longitude", "description", "start_date",
            "scheduled_date", "scheduled_time", "end_date", "visit_time", "status", "notes", "client_name", "so_no",
            "contract_period", "system_details", "engineer_name", "engineer_visit", "engineer_visit_custom_date",
            "microbiology", "microbiology_frequency", "microbiology_custom_date",
            "legionella", "legionella_frequency", "legionella_custom_date",
            "completion_status", "expected_duration", "completed_duration", "additional_duration", "invoice_number",
            "completion_date", "completion_engineer_name",
        },
    },
    "services": {
        "required": ("name",),
        "fields": {"name", "description", "certificate_text", "validity_months", "is_active"},
    },
    "project_tasks": {
        "required": ("project_id", "title", "scheduled_date"),
        "fields": {"project_id", "title", "description", "scheduled_date", "scheduled_time", "location", "status", "notes"},
    },
    "cleaning_records": {
        "required": ("client_id", "cleaning_date"),
        "fields": {"client_id", "site_name", "tank_identification", "tank_type", "capacity", "location", "cleaning_date", "cleaning_time", "engineer_id", "procedure", "materials_used", "observations", "status", "next_recommended_date", "notes"},
    },
    "water_testing": {
        "required": ("client_id", "collection_date"),
        "fields": {"client_id", "project_id", "sampling_location", "collection_date", "collection_time", "engineer_id", "water_source", "testing_category", "sample_identification", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details", "status", "notes"},
    },
}
SETTINGS_FIELDS = {
    "organization": {"name": 255, "support_contact": 255, "time_zone": 100, "date_format": 40, "time_format": 10},
    "user": {"appearance": 20, "notification_preferences": None, "date_format": 40, "time_format": 10, "time_zone": 100},
}
PROJECT_STATUSES = {"Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"}
CLEANING_STATUSES = {"Scheduled", "In Progress", "Completed", "Overdue", "Cancelled"}
TASK_STATUSES = {"Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"}
COMPLETION_STATUSES = {
    "Completed Before the Scheduled Date",
    "Completed on the Scheduled Date",
    "Completed After the Scheduled Date",
}
APPROVAL_STATUSES = ("Pending", "Pending Approval", "Approved", "Rejected")
FREQUENCY_OPTIONS = ("Quarterly", "Alternative", "Custom")
# Values offered before the current options; kept on projects that already use them.
LEGACY_FREQUENCIES = {"Monthly", "Weekly"}
FREQUENCY_FIELDS = (
    (None, "engineer_visit", "engineer_visit_custom_date"),
    ("microbiology", "microbiology_frequency", "microbiology_custom_date"),
    ("legionella", "legionella_frequency", "legionella_custom_date"),
)
DATE_FIELDS = (
    "scheduled_date", "start_date", "end_date", "completion_date", "cleaning_date", "next_recommended_date", "collection_date",
    "contract_period", "engineer_visit_custom_date", "microbiology_custom_date", "legionella_custom_date",
)
TEXT_LIMITS = {"engineer_code": 50, "invoice_number": 100, "completion_engineer_name": 320}


def validate_payload(resource, payload, partial=False, current=None):
    if not isinstance(payload, dict):
        return "Request body must be a JSON object."
    spec = RESOURCE_FIELDS[resource]
    required = spec["required"]
    if resource == "projects" and payload.get("client_name"):
        required = tuple(key for key in required if key != "client_id")
    missing = [
        key for key in required
        if (not partial or key in payload)
        and (payload.get(key) is None or (isinstance(payload.get(key), str) and not payload[key].strip()))
    ]
    if missing:
        return "Missing required field(s): " + ", ".join(missing)
    unknown = set(payload) - spec["fields"]
    if unknown:
        return "Unsupported field(s): " + ", ".join(sorted(unknown))
    for key in DATE_FIELDS:
        value = payload.get(key)
        if value:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return f"{key} must be an ISO date (YYYY-MM-DD)."
            try:
                date.fromisoformat(value)
            except ValueError:
                return f"{key} must be a real calendar date."
    for key in ("scheduled_time", "visit_time", "cleaning_time", "collection_time"):
        value = payload.get(key)
        if value:
            try:
                time.fromisoformat(value)
            except (TypeError, ValueError):
                return f"{key} must be a valid time."
    id_fields = {
        "client_id", "project_id", "engineer_id", "user_id"
    } & set(payload)
    for key in id_fields:
        value = payload[key]
        if value is not None:
            try:
                uuid.UUID(value)
            except (TypeError, ValueError, AttributeError):
                return f"{key} must be a valid record ID."
    for key, value in payload.items():
        if key in {"test_parameters", "test_results", "reference_limits", "notification_preferences"}:
            if not isinstance(value, (dict, list)):
                return f"{key} must be a JSON object or list."
        elif key == "is_active":
            if not isinstance(value, bool):
                return "is_active must be a boolean."
        elif key in {"so_no", "expected_duration", "completed_duration", "additional_duration", "validity_months"}:
            if value is None:
                continue
            if isinstance(value, bool):
                return f"{key} must be a non-negative whole number."
            try:
                numeric = int(value)
                if numeric < 0 or str(numeric) != str(value):
                    return f"{key} must be a non-negative whole number."
            except (TypeError, ValueError):
                return f"{key} must be a non-negative whole number."
        elif key == "capacity":
            if value is None:
                continue
            try:
                if isinstance(value, bool) or float(value) < 0:
                    return "capacity cannot be negative."
            except (TypeError, ValueError):
                return "capacity must be a non-negative number."
        elif key in {"latitude", "longitude"}:
            limit = 90 if key == "latitude" else 180
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or abs(value) > limit
            ):
                return f"{key} must be a number between -{limit} and {limit}."
        elif value is not None and not isinstance(value, str):
            return f"{key} must be text."
        elif isinstance(value, str) and len(value) > TEXT_LIMITS.get(key, 5000):
            return f"{key} must be at most {TEXT_LIMITS.get(key, 5000)} characters."
    if resource == "projects" and "status" in payload and payload["status"] not in PROJECT_STATUSES:
        return "Unsupported project status."
    if resource == "projects":
        if payload.get("start_date") and payload.get("end_date") and payload["start_date"] > payload["end_date"]:
            return "end_date must be on or after start_date."
        for field in ("microbiology", "legionella"):
            if payload.get(field) and payload[field] not in {"Yes", "No"}:
                return f"Unsupported {field} value."
        if payload.get("completion_status") and payload["completion_status"] not in COMPLETION_STATUSES:
            return "Unsupported completion status."
        if {"latitude", "longitude"} & set(payload) and (
            "latitude" not in payload or "longitude" not in payload
            or (payload["latitude"] is None) != (payload["longitude"] is None)
        ):
            return "latitude and longitude must be saved together."
        frequency_error = _validate_frequencies(payload, current or {})
        if frequency_error:
            return frequency_error
    if resource == "cleaning_records" and "status" in payload and payload["status"] not in CLEANING_STATUSES:
        return "Unsupported cleaning status."
    if resource == "project_tasks" and "status" in payload and payload["status"] not in TASK_STATUSES:
        return "Unsupported task status."
    email = payload.get("email")
    if email is not None and email and (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        return "email must be a valid email address."
    return None


def _validate_frequencies(payload, current):
    """Check each Yes/No toggle, frequency and custom date group the payload touches, against the stored project."""
    for toggle_key, frequency_key, date_key in FREQUENCY_FIELDS:
        if not {toggle_key, frequency_key, date_key} & set(payload):
            continue
        values = {**current, **payload}
        toggle, frequency = values.get(toggle_key) if toggle_key else None, values.get(frequency_key)
        allowed = set(FREQUENCY_OPTIONS)
        if current.get(frequency_key) in LEGACY_FREQUENCIES:
            allowed.add(current[frequency_key])
        label = frequency_key.replace("_", " ")
        if toggle == "No":
            if frequency not in (None, "No"):
                return f"{frequency_key} must be No when {toggle_key} is No."
        elif toggle == "Yes":
            if frequency not in allowed:
                return f"{frequency_key} is required when {toggle_key} is Yes: choose Quarterly, Alternative, or Custom."
        elif frequency is not None and frequency not in allowed and not (toggle_key and frequency == "No"):
            return f"Unsupported {label}: choose Quarterly, Alternative, or Custom."
        if frequency == "Custom" and not values.get(date_key):
            return f"Choose a date for the custom {label}."
        if frequency != "Custom" and payload.get(date_key):
            return f"{date_key} can only be set when {frequency_key} is Custom."
    return None


def validate_settings(scope, values):
    limits = SETTINGS_FIELDS[scope]
    if not isinstance(values, dict) or set(values) - set(limits):
        return f"Invalid {scope} settings."
    for key, value in values.items():
        if key == "notification_preferences":
            if not isinstance(value, dict):
                return "notification_preferences must be a JSON object."
        elif not isinstance(value, str) or len(value) > limits[key]:
            return f"{key} must be text of at most {limits[key]} characters."
    if "appearance" in values and values["appearance"] not in {"system", "light", "dark"}:
        return "appearance must be system, light, or dark."
    if "time_format" in values and values["time_format"] not in {"12h", "24h"}:
        return "time_format must be 12h or 24h."
    if "time_zone" in values and not re.fullmatch(r"[A-Za-z0-9_+\-/]+", values["time_zone"]):
        return "time_zone must be a time zone name such as UTC or Asia/Riyadh."
    if "date_format" in values and not values["date_format"].strip():
        return "date_format cannot be empty."
    return None
