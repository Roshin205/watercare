"""Store actual completion date and reporting engineer on projects.

Revision ID: 202610280008
Revises: 202610270007
"""
from alembic import op
import sqlalchemy as sa


revision = "202610280008"
down_revision = "202610270007"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    columns = {column["name"] for column in sa.inspect(connection).get_columns("projects")}
    if "completion_date" not in columns:
        op.add_column("projects", sa.Column("completion_date", sa.String(10)))
    if "completion_engineer_name" not in columns:
        op.add_column("projects", sa.Column("completion_engineer_name", sa.String(320)))

    connection.execute(sa.text(
        "UPDATE projects SET approval_status = 'Pending Approval' "
        "WHERE approval_status = 'Submitted for Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE approval_history SET previous_status = 'Pending Approval' "
        "WHERE previous_status = 'Submitted for Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE approval_history SET new_status = 'Pending Approval' "
        "WHERE new_status = 'Submitted for Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE projects SET completion_status = CASE completion_status "
        "WHEN 'Completed Early' THEN 'Completed Before the Scheduled Date' "
        "WHEN 'Completed Within Contract Period' THEN 'Completed on the Scheduled Date' "
        "WHEN 'Completed Late' THEN 'Completed After the Scheduled Date' "
        "ELSE completion_status END"
    ))


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text(
        "UPDATE projects SET approval_status = 'Submitted for Approval' "
        "WHERE approval_status = 'Pending Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE approval_history SET previous_status = 'Submitted for Approval' "
        "WHERE previous_status = 'Pending Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE approval_history SET new_status = 'Submitted for Approval' "
        "WHERE new_status = 'Pending Approval'"
    ))
    connection.execute(sa.text(
        "UPDATE projects SET completion_status = CASE completion_status "
        "WHEN 'Completed Before the Scheduled Date' THEN 'Completed Early' "
        "WHEN 'Completed on the Scheduled Date' THEN 'Completed Within Contract Period' "
        "WHEN 'Completed After the Scheduled Date' THEN 'Completed Late' "
        "ELSE completion_status END"
    ))
    columns = {column["name"] for column in sa.inspect(connection).get_columns("projects")}
    if "completion_engineer_name" in columns:
        op.drop_column("projects", "completion_engineer_name")
    if "completion_date" in columns:
        op.drop_column("projects", "completion_date")
