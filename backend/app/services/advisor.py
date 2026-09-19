"""LLM agent for timetable and degree-plan drafting. Not implemented.

The agent will take catalog + planner rows as tool input and write
student_class_selection / student_course rows. Qdrant is out of scope.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from sqlalchemy.orm import Session


def stream_advisor(
    db: Session,
    messages: list[dict[str, str]],
    planner_id: str | None = None,
) -> Iterator[str]:
    raise NotImplementedError("LLM advisor is not implemented")


def available_tools() -> list[dict[str, Any]]:
    return []
