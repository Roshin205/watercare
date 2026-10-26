"""Add the manual project priority order.

Revision ID: 202610270007
Revises: 202610260006
"""
from alembic import op
import sqlalchemy as sa

revision = "202610270007"
down_revision = "202610260006"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    if "priority_date" not in existing:
        op.add_column("projects", sa.Column("priority_date", sa.String(10)))
    if "priority_rank" not in existing:
        op.add_column("projects", sa.Column("priority_rank", sa.Float()))


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    for name in ("priority_rank", "priority_date"):
        if name in existing:
            op.drop_column("projects", name)
