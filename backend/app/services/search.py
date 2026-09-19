"""Postgres FTS / trigram course search. Not implemented."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session


def search_courses(db: Session, query: str) -> list[dict[str, Any]]:
    raise NotImplementedError("Course search is not implemented")
