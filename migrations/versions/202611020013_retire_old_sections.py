"""Turn projects into AMC contracts and engineers into staff profiles, then remove the tables nothing uses any more.

Revision ID: 202611020013
Revises: 202611010012
"""
from pathlib import Path

from alembic import op
import sqlalchemy as sa

revision = "202611020013"
down_revision = "202611010012"
branch_labels = None
depends_on = None


def upgrade():
    # The same statements as the D1 migration, so both databases end up identical.
    script = Path(__file__).resolve().parents[2] / "d1-migrations" / "0004_retire_old_sections.sql"
    lines = [line for line in script.read_text(encoding="utf-8").splitlines() if not line.startswith("--")]
    for statement in "\n".join(lines).split(";"):
        if statement.strip():
            op.execute(sa.text(statement.replace(":", "\\:")))


def downgrade():
    raise NotImplementedError("The old tables are gone; restore a backup to go back.")
