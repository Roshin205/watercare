from sqlalchemy import Boolean, Column, Float, ForeignKey, Index, Integer, JSON, String, Table, Text, UniqueConstraint

from backend.database import db


def business_table(name, *columns):
    return Table(
        name, db.metadata,
        Column("id", String(36), primary_key=True),
        Column("organization_id", String(36), ForeignKey("organizations.id"), nullable=False, index=True),
        *columns,
        Column("created_by", String(36)),
        Column("updated_by", String(36)),
        Column("created_at", String(40), nullable=False),
        Column("updated_at", String(40), nullable=False),
        Column("deleted_at", String(40), nullable=True, index=True),
    )


organizations = Table(
    "organizations", db.metadata,
    Column("id", String(36), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
users = Table(
    "users", db.metadata,
    Column("id", String(36), primary_key=True),
    Column("email", String(320), nullable=False, unique=True, index=True),
    Column("password_hash", String(255), nullable=False),
    Column("full_name", String(255)),
    Column("is_active", Boolean, nullable=False, default=True),
    # Private key for admin sign-in, stored only as a hash; blank for accounts that use the client login.
    Column("access_key_hash", String(255)),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
memberships = Table(
    "organization_memberships", db.metadata,
    Column("id", String(36), primary_key=True),
    Column("organization_id", String(36), ForeignKey("organizations.id"), nullable=False, index=True),
    Column("user_id", String(36), ForeignKey("users.id"), nullable=False, index=True),
    Column("role", String(30), nullable=False),
    Column("status", String(30), nullable=False, default="active"),
    Column("created_at", String(40), nullable=False),
    UniqueConstraint("organization_id", "user_id"),
)
organization_settings = Table(
    "organization_settings", db.metadata,
    Column("organization_id", String(36), ForeignKey("organizations.id"), primary_key=True),
    Column("name", String(255)),
    Column("support_contact", String(255)),
    Column("time_zone", String(100), nullable=False, default="UTC"),
    Column("date_format", String(40), nullable=False, default="YYYY-MM-DD"),
    Column("time_format", String(10), nullable=False, default="24h"),
    Column("updated_at", String(40), nullable=False),
)
user_settings = Table(
    "user_settings", db.metadata,
    Column("id", String(36), primary_key=True),
    Column("organization_id", String(36), ForeignKey("organizations.id"), nullable=False, index=True),
    Column("user_id", String(36), ForeignKey("users.id"), nullable=False, index=True),
    Column("appearance", String(20), nullable=False, default="system"),
    Column("notification_preferences", JSON, nullable=False, default=dict),
    Column("date_format", String(40)),
    Column("time_format", String(10)),
    Column("time_zone", String(100)),
    Column("updated_at", String(40), nullable=False),
    UniqueConstraint("organization_id", "user_id"),
)
clients = business_table(
    "clients",
    Column("name", String(255), nullable=False),
    Column("organization_name", String(255)),
    Column("contact_person", String(255)),
    Column("phone", String(60)),
    Column("email", String(320)),
    Column("address", Text),
    Column("category", String(100)),
    Column("notes", Text),
    Column("is_active", Boolean, nullable=False, default=True),
)
engineers = business_table(
    "engineers",
    Column("user_id", String(36), ForeignKey("users.id"), nullable=True, index=True),
    Column("engineer_code", String(50)),
    Column("full_name", String(255), nullable=False),
    Column("email", String(320)),
    Column("phone", String(60)),
    Column("specialization", String(255)),
    Column("availability", String(255)),
    Column("is_active", Boolean, nullable=False, default=True),
    Index("uq_engineers_organization_code", "organization_id", "engineer_code", unique=True),
)
projects = business_table(
    "projects",
    Column("client_id", String(36), ForeignKey("clients.id"), nullable=False, index=True),
    Column("name", String(255), nullable=False),
    Column("service", String(40)),
    Column("client_name", String(255)),
    Column("so_no", Integer),
    Column("contract_period", String(10)),
    Column("system_details", Text),
    Column("engineer_name", String(255)),
    Column("engineer_visit", String(20)),
    Column("engineer_visit_custom_date", String(10)),
    Column("microbiology", String(3)),
    Column("microbiology_frequency", String(20)),
    Column("microbiology_custom_date", String(10)),
    Column("legionella", String(3)),
    Column("legionella_frequency", String(20)),
    Column("legionella_custom_date", String(10)),
    Column("category", String(100)),
    Column("location", Text),
    Column("latitude", Float),
    Column("longitude", Float),
    Column("description", Text),
    Column("start_date", String(10)),
    Column("scheduled_date", String(10), index=True),
    Column("scheduled_time", String(16)),
    Column("end_date", String(10)),
    Column("visit_time", String(16)),
    Column("status", String(40), nullable=False, default="Planned", index=True),
    Column("notes", Text),
    Column("completion_status", String(40)),
    Column("completion_date", String(10)),
    Column("completion_engineer_name", String(320)),
    Column("expected_duration", Integer),
    Column("completed_duration", Integer),
    Column("additional_duration", Integer),
    Column("invoice_number", String(100)),
    Column("approval_status", String(40), default="Pending", index=True),
    Column("rejection_reason", Text),
    # Manual "do this first" order: the date slot a project is sorted under, and its position within that slot.
    Column("priority_date", String(10)),
    Column("priority_rank", Float),
)
project_engineers = Table(
    "project_engineers", db.metadata,
    Column("organization_id", String(36), ForeignKey("organizations.id"), nullable=False, index=True),
    Column("project_id", String(36), ForeignKey("projects.id"), primary_key=True),
    Column("engineer_id", String(36), ForeignKey("engineers.id"), primary_key=True),
    Column("created_by", String(36)),
    Column("updated_by", String(36)),
    Column("created_at", String(40), nullable=False),
)
project_tasks = business_table(
    "project_tasks",
    Column("project_id", String(36), ForeignKey("projects.id"), nullable=False, index=True),
    Column("engineer_id", String(36), ForeignKey("engineers.id"), index=True),
    Column("title", String(255), nullable=False),
    Column("description", Text),
    Column("scheduled_date", String(10), nullable=False, index=True),
    Column("scheduled_time", String(16)),
    Column("location", Text),
    Column("status", String(40), nullable=False, default="Scheduled", index=True),
    Column("notes", Text),
)
cleaning_records = business_table(
    "cleaning_records",
    Column("client_id", String(36), ForeignKey("clients.id"), nullable=False, index=True),
    Column("engineer_id", String(36), ForeignKey("engineers.id"), index=True),
    Column("site_name", String(255)),
    Column("tank_identification", String(255)),
    Column("tank_type", String(100)),
    Column("capacity", Float),
    Column("location", Text),
    Column("cleaning_date", String(10), nullable=False, index=True),
    Column("cleaning_time", String(16)),
    Column("procedure", Text),
    Column("materials_used", Text),
    Column("observations", Text),
    Column("status", String(40), nullable=False, default="Scheduled", index=True),
    Column("next_recommended_date", String(10)),
    Column("notes", Text),
)
water_testing_records = business_table(
    "water_testing_records",
    Column("client_id", String(36), ForeignKey("clients.id"), nullable=False, index=True),
    Column("project_id", String(36), ForeignKey("projects.id"), index=True),
    Column("engineer_id", String(36), ForeignKey("engineers.id"), index=True),
    Column("sampling_location", Text),
    Column("collection_date", String(10), nullable=False, index=True),
    Column("collection_time", String(16)),
    Column("water_source", String(255)),
    Column("testing_category", String(100)),
    Column("sample_identification", String(255)),
    Column("test_parameters", JSON, nullable=False, default=list),
    Column("test_results", JSON, nullable=False, default=dict),
    Column("reference_limits", JSON, nullable=False, default=dict),
    Column("interpretation", Text),
    Column("laboratory_details", Text),
    Column("status", String(40), nullable=False, default="Collected", index=True),
    Column("notes", Text),
)
uploaded_documents = business_table(
    "uploaded_documents",
    Column("related_type", String(40), nullable=False),
    Column("related_id", String(36), nullable=False, index=True),
    Column("original_filename", String(255), nullable=False),
    Column("image_type", String(10)),
    Column("storage_path", Text, nullable=False, unique=True),
    Column("mime_type", String(150), nullable=False),
    Column("file_size", Integer, nullable=False),
    Column("uploaded_by", String(36), ForeignKey("users.id")),
)
approval_history = Table(
    "approval_history", db.metadata,
    Column("id", String(36), primary_key=True),
    Column("organization_id", String(36), ForeignKey("organizations.id"), nullable=False, index=True),
    Column("project_id", String(36), ForeignKey("projects.id"), index=True),
    Column("task_id", String(36), ForeignKey("project_tasks.id")),
    Column("reference", String(600), nullable=False),
    Column("previous_status", String(40), nullable=False),
    Column("new_status", String(40), nullable=False),
    Column("action", String(40), nullable=False),
    Column("reason", Text),
    Column("actor_id", String(36), ForeignKey("users.id")),
    Column("actor_name", String(320), nullable=False),
    Column("created_at", String(40), nullable=False, index=True),
)
notifications = business_table(
    "notifications",
    Column("user_id", String(36), ForeignKey("users.id"), index=True),
    Column("title", String(255), nullable=False),
    Column("message", Text, nullable=False),
    Column("read_at", String(40)),
)
audit_logs = Table(
    "audit_logs", db.metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("organization_id", String(36), index=True),
    Column("actor_id", String(36), ForeignKey("users.id")),
    Column("table_name", String(100), nullable=False),
    Column("record_id", String(100)),
    Column("action", String(40), nullable=False),
    Column("old_data", JSON),
    Column("new_data", JSON),
    Column("created_at", String(40), nullable=False),
)


certificate_templates = business_table(
    "certificate_templates",
    Column("name", String(200), nullable=False),
    Column("service", String(120), nullable=False, index=True),
    Column("original_filename", String(255), nullable=False),
    Column("file_type", String(8), nullable=False),
    Column("storage_path", String(500), nullable=False),
    Column("file_size", Integer, nullable=False),
    Column("tags", JSON),
)


services = business_table(
    "services",
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("certificate_text", String(300)),
    Column("validity_months", Integer),
    Column("is_active", Boolean, nullable=False, default=True),
)
