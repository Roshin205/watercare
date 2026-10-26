"""Create WaterCare business tables.

Revision ID: 202610240001
Revises:
"""
from alembic import op

revision = "202610240001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    from backend.models import db

    db.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("Production data is retained; perform a reviewed manual migration to remove tables.")
