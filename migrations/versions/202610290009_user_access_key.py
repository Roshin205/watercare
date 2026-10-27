"""Add the private access key hash used by the admin login.

Revision ID: 202610290009
Revises: 202610280008
"""
from alembic import op
import sqlalchemy as sa

revision = "202610290009"
down_revision = "202610280008"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "access_key_hash" not in existing:
        op.add_column("users", sa.Column("access_key_hash", sa.String(255)))


def downgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "access_key_hash" in existing:
        op.drop_column("users", "access_key_hash")
