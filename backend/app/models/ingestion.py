from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk


class SourceDocument(Base):
    __tablename__ = "source_document"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    source_url: Mapped[str | None] = mapped_column(Text)
    source_path: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(32))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    runs: Mapped[list[IngestionRun]] = relationship(back_populates="source_document")


class IngestionRun(Base):
    __tablename__ = "ingestion_run"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.source_document.id"))
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="started")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    source_document: Mapped[SourceDocument | None] = relationship(back_populates="runs")
    staging_courses: Mapped[list[StagingCourse]] = relationship(back_populates="ingestion_run")


class StagingCourse(Base):
    __tablename__ = "staging_course"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    ingestion_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.ingestion_run.id", ondelete="CASCADE"))
    subject_code: Mapped[str | None] = mapped_column(String(8))
    course_number: Mapped[str | None] = mapped_column(String(8))
    payload: Mapped[dict] = mapped_column(JSONB)
    valid: Mapped[bool | None] = mapped_column(Boolean)

    ingestion_run: Mapped[IngestionRun] = relationship(back_populates="staging_courses")


class ParseReviewQueue(Base):
    __tablename__ = "parse_review_queue"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.course.id"))
    kind: Mapped[str] = mapped_column(String(32))
    raw_text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
