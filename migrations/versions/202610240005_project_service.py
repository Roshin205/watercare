"""Add service type to projects.

Revision ID: 202610240005
Revises: 202610240004
"""
from alembic import op
import sqlalchemy as sa

revision = "202610240005"
down_revision = "202610240004"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    if "service" not in existing:
        op.add_column("projects", sa.Column("service", sa.String(40)))


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    if "service" in existing:
        op.drop_column("projects", "service")
