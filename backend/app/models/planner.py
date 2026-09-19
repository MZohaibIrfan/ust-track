from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk


class Planner(Base):
    __tablename__ = "planner"
    __table_args__ = {"schema": "planner"}

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[str] = mapped_column(String(64), unique=True)
    entry_year: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    programs: Mapped[list[StudentProgram]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )
    courses: Mapped[list[StudentCourse]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )
    class_selections: Mapped[list[StudentClassSelection]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )
    credit_allocations: Mapped[list[RequirementCreditAllocation]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )
    experiences: Mapped[list[StudentExperience]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )
    chat_messages: Mapped[list[ChatMessage]] = relationship(
        back_populates="planner",
        cascade="all, delete-orphan",
    )


class StudentProgram(Base):
    __tablename__ = "student_program"
    __table_args__ = {"schema": "planner"}

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    program_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.program.id"))
    program_role: Mapped[str] = mapped_column(String(32))
    intake_year: Mapped[int | None] = mapped_column(Integer)

    planner: Mapped[Planner] = relationship(back_populates="programs")


class StudentCourse(Base):
    __tablename__ = "student_course"
    __table_args__ = (
        UniqueConstraint("planner_id", "course_id", "term_id"),
        {"schema": "planner"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id"))
    term_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.term.id"))
    status: Mapped[str] = mapped_column(String(32), default="planned")

    planner: Mapped[Planner] = relationship(back_populates="courses")


class StudentClassSelection(Base):
    __tablename__ = "student_class_selection"
    __table_args__ = (
        UniqueConstraint("planner_id", "section_id"),
        {"schema": "planner"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.class_section.id"))

    planner: Mapped[Planner] = relationship(back_populates="class_selections")


class StudentExperience(Base):
    """An internship, job, or project the student reports having already done."""

    __tablename__ = "student_experience"
    __table_args__ = {"schema": "planner"}

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255))
    organization: Mapped[str] = mapped_column(String(255), default="")
    kind: Mapped[str] = mapped_column(String(32), default="internship")
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    planner: Mapped[Planner] = relationship(back_populates="experiences")


class ChatMessage(Base):
    """One turn of an agent conversation, so a page's chat survives a refresh."""

    __tablename__ = "chat_message"
    __table_args__ = (
        Index("ix_chat_message_planner_agent", "planner_id", "agent", "created_at"),
        {"schema": "planner"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    agent: Mapped[str] = mapped_column(String(16))
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    planner: Mapped[Planner] = relationship(back_populates="chat_messages")


class RequirementCreditAllocation(Base):
    __tablename__ = "requirement_credit_allocation"
    __table_args__ = {"schema": "planner"}

    id: Mapped[uuid.UUID] = uuid_pk()
    planner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.planner.id", ondelete="CASCADE"))
    requirement_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.requirement_item.id"))
    student_course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planner.student_course.id"))
    credits: Mapped[Decimal] = mapped_column(Numeric(4, 1))

    planner: Mapped[Planner] = relationship(back_populates="credit_allocations")
