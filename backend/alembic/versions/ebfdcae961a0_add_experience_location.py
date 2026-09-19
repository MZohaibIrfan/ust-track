"""add experience location

Revision ID: ebfdcae961a0
Revises: 3d1ab91c0356
Create Date: 2026-09-20 02:18:42.138395
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ebfdcae961a0'
down_revision: Union[str, Sequence[str], None] = '3d1ab91c0356'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'student_experience',
        sa.Column('location', sa.String(length=255), nullable=False, server_default=''),
        schema='planner',
    )
    op.alter_column('student_experience', 'location', server_default=None, schema='planner')


def downgrade() -> None:
    op.drop_column('student_experience', 'location', schema='planner')
