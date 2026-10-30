import re


RESOURCE_FIELDS = {
    "clients": {
        "required": ("name",),
        "fields": {"name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes", "is_active"},
    },
    "services": {
        "required": ("name",),
        "fields": {"name", "description", "certificate_text", "validity_months", "is_active"},
    },
}
SETTINGS_FIELDS = {
    "organization": {"name": 255, "support_phone": 40, "support_email": 320, "time_zone": 100, "date_format": 40, "time_format": 10},
    "user": {"notification_preferences": None, "date_format": 40, "time_format": 10, "time_zone": 100},
}
DATE_FORMATS = {"YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"}


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
    for key, value in payload.items():
        if key == "is_active":
            if not isinstance(value, bool):
                return "is_active must be a boolean."
        elif key == "validity_months":
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
        elif value is not None and not isinstance(value, str):
            return f"{key} must be text."
        elif isinstance(value, str) and len(value) > 5000:
            return f"{key} must be at most 5000 characters."
    email = payload.get("email")
    if email is not None and email and (not isinstance(email, str) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
        return "email must be a valid email address."
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
    if "time_format" in values and values["time_format"] not in {"12h", "24h"}:
        return "time_format must be 12h or 24h."
    # A blank personal time zone means "use this device's time zone".
    if "time_zone" in values and not (scope == "user" and values["time_zone"] == "") and not re.fullmatch(r"[A-Za-z0-9_+\-/]+", values["time_zone"]):
        return "time_zone must be a time zone name such as UTC or Asia/Riyadh."
    if "date_format" in values and values["date_format"] not in DATE_FORMATS:
        return "date_format must be YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY."
    if values.get("support_email") and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", values["support_email"]):
        return "Support email must be a valid email address."
    if values.get("support_phone") and not re.fullmatch(r"[0-9+()\-. ]{3,40}", values["support_phone"]):
        return "Support phone can use digits, spaces and + ( ) - only."
    return None
