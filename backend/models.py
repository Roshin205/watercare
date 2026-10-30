from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, JSON, String, Table, Text, UniqueConstraint

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
    Column("support_contact", String(255)),  # before support_phone / support_email; copied into support_phone
    Column("support_phone", String(40)),
    Column("support_email", String(320)),
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
uploaded_documents = business_table(
    "uploaded_documents",
    Column("related_type", String(40), nullable=False),
    Column("related_id", String(36), nullable=False, index=True),
    Column("original_filename", String(255), nullable=False),
    Column("image_type", String(40)),
    Column("storage_path", Text, nullable=False, unique=True),
    Column("mime_type", String(150), nullable=False),
    Column("file_size", Integer, nullable=False),
    Column("uploaded_by", String(36), ForeignKey("users.id")),
)


services = business_table(
    "services",
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("certificate_text", String(300)),
    Column("validity_months", Integer),
    Column("is_active", Boolean, nullable=False, default=True),
)


# Everything on the Operations pages (contracts, samples, delivery notes, staff, custom sections...): one row per
# record. `collection` says which kind (backend/utils/hub_schema.py lists them), `parent_id` and `period` are the two
# things rows are looked up by, and `data` holds the fields, so a new custom section never needs a new table.
hub_records = business_table(
    "hub_records",
    Column("collection", String(40), nullable=False),
    Column("parent_id", String(36)),
    Column("period", String(10)),
    Column("data", JSON, nullable=False, default=dict),
)
Index("ix_hub_records_collection", hub_records.c.organization_id, hub_records.c.collection, hub_records.c.deleted_at)
Index("ix_hub_records_parent", hub_records.c.organization_id, hub_records.c.collection, hub_records.c.parent_id)
Index("ix_hub_records_period", hub_records.c.organization_id, hub_records.c.collection, hub_records.c.period)
