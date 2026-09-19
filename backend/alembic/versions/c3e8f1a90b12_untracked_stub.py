"""untracked revision stub

This revision id was already stamped on the live database by an earlier
session, but its migration file was never committed to the repo. The
database schema it left behind already matches the current SQLAlchemy
models (verified independently), so this is a no-op placeholder that just
repairs the local migration chain — it does not change the database.

Revision ID: c3e8f1a90b12
Revises: b962ca0a43e0
Create Date: 2026-09-19 00:00:00.000000
"""

from typing import Sequence, Union

revision: str = 'c3e8f1a90b12'
down_revision: Union[str, Sequence[str], None] = 'b962ca0a43e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
