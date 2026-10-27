"""Add certificate_templates and services for the Certificates and Services pages.

Revision ID: 202610300010
Revises: 202610290009
"""
from alembic import op
import sqlalchemy as sa

revision = "202610300010"
down_revision = "202610290009"
branch_labels = None
depends_on = None


def upgrade():
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "services" not in tables:
        op.create_table(
            "services",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False, index=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("certificate_text", sa.String(300)),
            sa.Column("validity_months", sa.Integer),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_by", sa.String(36)),
            sa.Column("updated_by", sa.String(36)),
            sa.Column("created_at", sa.String(40), nullable=False),
            sa.Column("updated_at", sa.String(40), nullable=False),
            sa.Column("deleted_at", sa.String(40), index=True),
        )
    if "certificate_templates" in tables:
        return
    op.create_table(
        "certificate_templates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("service", sa.String(120), nullable=False, index=True),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_type", sa.String(8), nullable=False),
        sa.Column("storage_path", sa.String(500), nullable=False),
        sa.Column("file_size", sa.Integer, nullable=False),
        sa.Column("tags", sa.JSON),
        sa.Column("created_by", sa.String(36)),
        sa.Column("updated_by", sa.String(36)),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.Column("deleted_at", sa.String(40), index=True),
    )


def downgrade():
    tables = sa.inspect(op.get_bind()).get_table_names()
    for name in ("certificate_templates", "services"):
        if name in tables:
            op.drop_table(name)
