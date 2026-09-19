"""planner entry year

Revision ID: c3e8f1a90b12
Revises: b962ca0a43e0
Create Date: 2026-09-19 17:22:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3e8f1a90b12"
down_revision: Union[str, Sequence[str], None] = "b962ca0a43e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("planner", sa.Column("entry_year", sa.Integer(), nullable=True), schema="planner")
    op.execute(
        """
        UPDATE planner.planner AS p
        SET entry_year = (
            SELECT sp.intake_year
            FROM planner.student_program AS sp
            WHERE sp.planner_id = p.id
              AND sp.intake_year IS NOT NULL
            ORDER BY CASE sp.program_role WHEN 'major' THEN 0 ELSE 1 END, sp.intake_year
            LIMIT 1
        )
        WHERE p.entry_year IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("planner", "entry_year", schema="planner")
