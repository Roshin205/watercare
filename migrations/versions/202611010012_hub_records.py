"""Add the shared record table behind the Operations pages.

Revision ID: 202611010012
Revises: 202610310011
"""
from alembic import op
import sqlalchemy as sa

revision = "202611010012"
down_revision = "202610310011"
branch_labels = None
depends_on = None


def upgrade():
    if "hub_records" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "hub_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("collection", sa.String(40), nullable=False),
        sa.Column("parent_id", sa.String(36)),
        sa.Column("period", sa.String(10)),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(36)),
        sa.Column("updated_by", sa.String(36)),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.Column("deleted_at", sa.String(40)),
    )
    op.create_index("ix_hub_records_organization_id", "hub_records", ["organization_id"])
    op.create_index("ix_hub_records_deleted_at", "hub_records", ["deleted_at"])
    op.create_index("ix_hub_records_collection", "hub_records", ["organization_id", "collection", "deleted_at"])
    op.create_index("ix_hub_records_parent", "hub_records", ["organization_id", "collection", "parent_id"])
    op.create_index("ix_hub_records_period", "hub_records", ["organization_id", "collection", "period"])


def downgrade():
    op.drop_table("hub_records")
