"""add user auth

Revision ID: ec73fed49135
Revises: f1b4d7ed03cd
Create Date: 2026-09-19 23:57:23.510498
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'ec73fed49135'
down_revision: Union[str, Sequence[str], None] = 'f1b4d7ed03cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'app_user',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
        schema='planner',
    )
    op.add_column('planner', sa.Column('user_id', sa.UUID(), nullable=True), schema='planner')
    op.create_unique_constraint('planner_user_id_key', 'planner', ['user_id'], schema='planner')
    op.create_foreign_key(
        'planner_user_id_fkey',
        'planner',
        'app_user',
        ['user_id'],
        ['id'],
        source_schema='planner',
        referent_schema='planner',
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('planner_user_id_fkey', 'planner', schema='planner', type_='foreignkey')
    op.drop_constraint('planner_user_id_key', 'planner', schema='planner', type_='unique')
    op.drop_column('planner', 'user_id', schema='planner')
    op.drop_table('app_user', schema='planner')
