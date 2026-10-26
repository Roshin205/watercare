"""Add project entry and completion fields.

Revision ID: 202610240002
Revises: 202610240001
"""
from alembic import op
import sqlalchemy as sa

revision = "202610240002"
down_revision = "202610240001"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    for name, column in (
        ("client_name", sa.Column("client_name", sa.String(255))),
        ("so_no", sa.Column("so_no", sa.Integer())),
        ("contract_period", sa.Column("contract_period", sa.String(10))),
        ("end_date", sa.Column("end_date", sa.String(10))),
        ("system_details", sa.Column("system_details", sa.Text())),
        ("engineer_name", sa.Column("engineer_name", sa.String(255))),
        ("engineer_visit", sa.Column("engineer_visit", sa.String(20))),
        ("microbiology", sa.Column("microbiology", sa.String(3))),
        ("microbiology_frequency", sa.Column("microbiology_frequency", sa.String(20))),
        ("legionella", sa.Column("legionella", sa.String(3))),
        ("legionella_frequency", sa.Column("legionella_frequency", sa.String(20))),
        ("completion_status", sa.Column("completion_status", sa.String(40))),
        ("expected_duration", sa.Column("expected_duration", sa.Integer())),
        ("completed_duration", sa.Column("completed_duration", sa.Integer())),
        ("additional_duration", sa.Column("additional_duration", sa.Integer())),
    ):
        if name not in existing:
            op.add_column("projects", column)
    document_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("uploaded_documents")}
    if "image_type" not in document_columns:
        op.add_column("uploaded_documents", sa.Column("image_type", sa.String(10)))


def downgrade():
    document_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("uploaded_documents")}
    if "image_type" in document_columns:
        op.drop_column("uploaded_documents", "image_type")
    project_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("projects")}
    for name in (
        "additional_duration", "completed_duration", "expected_duration", "completion_status",
        "legionella_frequency", "legionella", "microbiology_frequency", "microbiology",
        "engineer_visit", "engineer_name", "system_details", "contract_period", "end_date", "so_no", "client_name",
    ):
        if name in project_columns:
            op.drop_column("projects", name)
