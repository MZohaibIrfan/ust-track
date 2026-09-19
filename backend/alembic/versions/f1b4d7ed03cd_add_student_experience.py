"""add student experience

Revision ID: f1b4d7ed03cd
Revises: c3e8f1a90b12
Create Date: 2026-09-19 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f1b4d7ed03cd'
down_revision: Union[str, Sequence[str], None] = 'c3e8f1a90b12'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'student_experience',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('planner_id', sa.UUID(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('organization', sa.String(length=255), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['planner_id'], ['planner.planner.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        schema='planner',
    )


def downgrade() -> None:
    op.drop_table('student_experience', schema='planner')
