"""Meeting overlap detection. Not implemented."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session


def plan_conflicts(db: Session, planner_id: str) -> list[dict[str, Any]]:
    raise NotImplementedError("Conflict detection is not implemented")
