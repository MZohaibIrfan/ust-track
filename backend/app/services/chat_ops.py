"""Shared chat-history persistence for the degree/timetable/career agents.

One table, keyed by (planner_id, agent), so a page's conversation survives a
refresh instead of resetting every time the component remounts. The agents
themselves stay stateless per request — this is purely storage, not part of
their reasoning.
"""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ChatMessage
from app.services.planner_ops import get_or_create_planner

Agent = Literal["career", "degree", "timetable"]


def list_messages(db: Session, planner_id: str, agent: Agent) -> list[dict[str, Any]]:
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.planner_id == planner.id, ChatMessage.agent == agent)
        .order_by(ChatMessage.created_at.asc())
    ).all()
    return [{"role": row.role, "content": row.content} for row in rows]


def append_message(db: Session, planner_id: str | None, agent: Agent, role: str, content: str) -> None:
    if not planner_id or not content:
        return
    planner = get_or_create_planner(db, planner_id)
    db.add(ChatMessage(planner_id=planner.id, agent=agent, role=role, content=content))
    db.commit()


def clear_messages(db: Session, planner_id: str, agent: Agent) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    removed = (
        db.query(ChatMessage)
        .filter(ChatMessage.planner_id == planner.id, ChatMessage.agent == agent)
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed}


__all__ = ["list_messages", "append_message", "clear_messages"]
