"""add chat message

Revision ID: 3d1ab91c0356
Revises: ec73fed49135
Create Date: 2026-09-20 01:00:13.017199
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '3d1ab91c0356'
down_revision: Union[str, Sequence[str], None] = 'ec73fed49135'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'chat_message',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('planner_id', sa.UUID(), nullable=False),
        sa.Column('agent', sa.String(length=16), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['planner_id'], ['planner.planner.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        schema='planner',
    )
    op.create_index(
        'ix_chat_message_planner_agent', 'chat_message', ['planner_id', 'agent', 'created_at'],
        unique=False, schema='planner',
    )


def downgrade() -> None:
    op.drop_index('ix_chat_message_planner_agent', table_name='chat_message', schema='planner')
    op.drop_table('chat_message', schema='planner')
