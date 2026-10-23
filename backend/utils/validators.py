from datetime import date, time
import re
import uuid


RESOURCE_FIELDS = {
    "clients": {
        "required": ("name",),
        "fields": {"name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes", "is_active"},
    },
    "engineers": {
        "required": ("full_name",),
        "fields": {"full_name", "email", "phone", "specialization", "availability", "user_id", "is_active"},
    },
    "projects": {
        "required": ("name", "client_id"),
        "fields": {"name", "category", "client_id", "location", "description", "start_date", "scheduled_date", "scheduled_time", "status", "notes"},
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
    "settings": {
        "required": (),
        "fields": {"date_format", "time_format", "time_zone", "appearance", "notification_preferences", "support_contact"},
    },
}
PROJECT_STATUSES = {"Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"}
CLEANING_STATUSES = {"Scheduled", "In Progress", "Completed", "Overdue", "Cancelled"}
TASK_STATUSES = {"Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"}


def validate_payload(resource, payload, partial=False):
    if not isinstance(payload, dict):
        return "Request body must be a JSON object."
    spec = RESOURCE_FIELDS[resource]
    missing = [
        key for key in spec["required"]
        if (not partial or key in payload)
        and (payload.get(key) is None or (isinstance(payload.get(key), str) and not payload[key].strip()))
    ]
    if missing:
        return "Missing required field(s): " + ", ".join(missing)
    unknown = set(payload) - spec["fields"]
    if unknown:
        return "Unsupported field(s): " + ", ".join(sorted(unknown))
    for key in ("scheduled_date", "start_date", "cleaning_date", "next_recommended_date", "collection_date"):
        value = payload.get(key)
        if value:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return f"{key} must be an ISO date (YYYY-MM-DD)."
    for key in ("scheduled_time", "cleaning_time", "collection_time"):
        value = payload.get(key)
        if value:
            try:
                time.fromisoformat(value)
            except (TypeError, ValueError):
                return f"{key} must be a valid time."
            try:
                date.fromisoformat(value)
            except (TypeError, ValueError):
                return f"{key} must be an ISO date (YYYY-MM-DD)."
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
        elif key == "capacity":
            if value is None:
                continue
            try:
                if isinstance(value, bool) or float(value) < 0:
                    return "capacity cannot be negative."
            except (TypeError, ValueError):
                return "capacity must be a non-negative number."
        elif value is not None and not isinstance(value, str):
            return f"{key} must be text."
        elif isinstance(value, str) and len(value) > 5000:
            return f"{key} exceeds the maximum length."
    if resource == "projects" and "status" in payload and payload["status"] not in PROJECT_STATUSES:
        return "Unsupported project status."
    if resource == "cleaning_records" and "status" in payload and payload["status"] not in CLEANING_STATUSES:
        return "Unsupported cleaning status."
    if resource == "project_tasks" and "status" in payload and payload["status"] not in TASK_STATUSES:
        return "Unsupported task status."
    email = payload.get("email")
    if email is not None and email and (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        return "email must be a valid email address."
    return None
