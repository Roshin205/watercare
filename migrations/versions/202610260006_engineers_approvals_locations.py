"""Add engineer IDs, schedule custom dates, invoice numbers, approvals, map locations and the new roles.

Revision ID: 202610260006
Revises: 202610240005
"""
from alembic import op
import sqlalchemy as sa

revision = "202610260006"
down_revision = "202610240005"
branch_labels = None
depends_on = None

PROJECT_COLUMNS = (
    ("engineer_visit_custom_date", sa.String(10)),
    ("microbiology_custom_date", sa.String(10)),
    ("legionella_custom_date", sa.String(10)),
    ("latitude", sa.Float()),
    ("longitude", sa.Float()),
    ("invoice_number", sa.String(100)),
    ("approval_status", sa.String(40)),
    ("rejection_reason", sa.Text()),
)


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    project_columns = {column["name"] for column in inspector.get_columns("projects")}
    for name, column_type in PROJECT_COLUMNS:
        if name not in project_columns:
            op.add_column("projects", sa.Column(name, column_type))
    if "ix_projects_approval_status" not in {index["name"] for index in inspector.get_indexes("projects")}:
        op.create_index("ix_projects_approval_status", "projects", ["approval_status"])

    if "engineer_code" not in {column["name"] for column in inspector.get_columns("engineers")}:
        op.add_column("engineers", sa.Column("engineer_code", sa.String(50)))
    if "uq_engineers_organization_code" not in {index["name"] for index in inspector.get_indexes("engineers")}:
        op.create_index("uq_engineers_organization_code", "engineers", ["organization_id", "engineer_code"], unique=True)

    if "approval_history" not in inspector.get_table_names():
        op.create_table(
            "approval_history",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False, index=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), index=True),
            sa.Column("task_id", sa.String(36), sa.ForeignKey("project_tasks.id")),
            sa.Column("reference", sa.String(600), nullable=False),
            sa.Column("previous_status", sa.String(40), nullable=False),
            sa.Column("new_status", sa.String(40), nullable=False),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("reason", sa.Text()),
            sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id")),
            sa.Column("actor_name", sa.String(320), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False, index=True),
        )

    # Projects completed before approvals existed keep a blank approval status rather than an invented approval.
    connection.execute(sa.text(
        "UPDATE projects SET approval_status = 'Pending' "
        "WHERE approval_status IS NULL AND (status IS NULL OR status <> 'Completed')"
    ))
    connection.execute(sa.text(
        "UPDATE organization_memberships SET role = 'service_coordinator' WHERE role = 'manager'"
    ))


def downgrade():
    # Former manager accounts stay Service Coordinators; the original role cannot be told apart afterwards.
    inspector = sa.inspect(op.get_bind())
    if "approval_history" in inspector.get_table_names():
        op.drop_table("approval_history")
    if "uq_engineers_organization_code" in {index["name"] for index in inspector.get_indexes("engineers")}:
        op.drop_index("uq_engineers_organization_code", table_name="engineers")
    if "engineer_code" in {column["name"] for column in inspector.get_columns("engineers")}:
        op.drop_column("engineers", "engineer_code")
    if "ix_projects_approval_status" in {index["name"] for index in inspector.get_indexes("projects")}:
        op.drop_index("ix_projects_approval_status", table_name="projects")
    project_columns = {column["name"] for column in inspector.get_columns("projects")}
    for name, _ in reversed(PROJECT_COLUMNS):
        if name in project_columns:
            op.drop_column("projects", name)
