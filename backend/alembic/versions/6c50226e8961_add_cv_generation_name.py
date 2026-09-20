"""add cv generation name

Revision ID: 6c50226e8961
Revises: f815cb00f94c
Create Date: 2026-09-20 03:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '6c50226e8961'
down_revision: Union[str, Sequence[str], None] = 'f815cb00f94c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'cv_generation',
        sa.Column('name', sa.String(length=255), nullable=False, server_default=''),
        schema='planner',
    )
    op.alter_column('cv_generation', 'name', server_default=None, schema='planner')


def downgrade() -> None:
    op.drop_column('cv_generation', 'name', schema='planner')
