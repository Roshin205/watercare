"""Use a single project engineer visit time.

Revision ID: 202610240004
Revises: 202610240003
"""
from alembic import op
import sqlalchemy as sa

revision = "202610240004"
down_revision = "202610240003"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    existing = {column["name"] for column in sa.inspect(connection).get_columns("projects")}
    if "visit_time" not in existing:
        op.add_column("projects", sa.Column("visit_time", sa.String(16)))
    if "start_time" in existing:
        connection.execute(sa.text(
            "UPDATE projects SET visit_time = start_time "
            "WHERE visit_time IS NULL AND start_time IS NOT NULL"
        ))
    if "scheduled_time" in existing:
        connection.execute(sa.text(
            "UPDATE projects SET visit_time = scheduled_time "
            "WHERE visit_time IS NULL AND scheduled_time IS NOT NULL"
        ))


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    if "visit_time" in existing:
        op.drop_column("projects", "visit_time")
