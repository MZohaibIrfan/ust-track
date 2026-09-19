"""untracked revision stub

This revision id was already stamped on the live database by an earlier
session (it adds, among other things, planner.app_user and
planner.planner.user_id — looks like in-progress user-auth work), but its
migration file hasn't reached the repo yet. This is a no-op placeholder that
just repairs the local migration chain so `alembic upgrade head` keeps
working — it does not change the database, and does not touch whatever
that untracked revision actually did.

Revision ID: ec73fed49135
Revises: f1b4d7ed03cd
Create Date: 2026-09-20 00:00:00.000000
"""

from typing import Sequence, Union

revision: str = 'ec73fed49135'
down_revision: Union[str, Sequence[str], None] = 'f1b4d7ed03cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
