"""Add project start and end times.

Revision ID: 202610240003
Revises: 202610240002
"""
from alembic import op
import sqlalchemy as sa

revision = "202610240003"
down_revision = "202610240002"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    for name in ("start_time", "end_time"):
        if name not in existing:
            op.add_column("projects", sa.Column(name, sa.String(16)))


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    for name in ("end_time", "start_time"):
        if name in existing:
            op.drop_column("projects", name)
