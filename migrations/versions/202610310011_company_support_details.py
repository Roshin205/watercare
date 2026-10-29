"""Split the company's support contact into a phone number and an email address.

Revision ID: 202610310011
Revises: 202610300010
"""
from alembic import op
import sqlalchemy as sa

revision = "202610310011"
down_revision = "202610300010"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("organization_settings")}
    if "support_phone" not in existing:
        op.add_column("organization_settings", sa.Column("support_phone", sa.String(40)))
    if "support_email" not in existing:
        op.add_column("organization_settings", sa.Column("support_email", sa.String(320)))
    # The old single field becomes the phone number; nothing is removed.
    op.execute("UPDATE organization_settings SET support_phone = support_contact WHERE support_phone IS NULL AND support_contact IS NOT NULL")


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("organization_settings")}
    for name in ("support_email", "support_phone"):
        if name in existing:
            op.drop_column("organization_settings", name)
