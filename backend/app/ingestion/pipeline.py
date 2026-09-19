"""raw file → staging → validate → production. Not implemented."""

from __future__ import annotations

from sqlalchemy.orm import Session


def ingest_wcq(db: Session, term_code: str, subjects: list[str] | None = None) -> None:
    raise NotImplementedError("WCQ ingestion pipeline is not implemented")


def promote_staging(db: Session, run_id: str) -> None:
    raise NotImplementedError("Staging promotion is not implemented")
