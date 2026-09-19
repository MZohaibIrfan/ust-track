"""Server-side .ics export. Not implemented."""

from __future__ import annotations

from sqlalchemy.orm import Session


def plan_ics(db: Session, planner_id: str) -> str:
    raise NotImplementedError("ICS export is not implemented")
