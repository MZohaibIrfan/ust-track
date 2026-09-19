"""add cv generation

Revision ID: f815cb00f94c
Revises: ebfdcae961a0
Create Date: 2026-09-20 02:57:30.170715
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f815cb00f94c'
down_revision: Union[str, Sequence[str], None] = 'ebfdcae961a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cv_generation',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('planner_id', sa.UUID(), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('latex', sa.Text(), nullable=False),
        sa.Column('experience_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['planner_id'], ['planner.planner.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        schema='planner',
    )


def downgrade() -> None:
    op.drop_table('cv_generation', schema='planner')
