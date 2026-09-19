from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk


class AcademicYear(Base):
    __tablename__ = "academic_year"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(16), unique=True)
    start_year: Mapped[int] = mapped_column(Integer)

    course_versions: Mapped[list[CourseVersion]] = relationship(back_populates="academic_year")
    terms: Mapped[list[Term]] = relationship(back_populates="academic_year")
    program_versions: Mapped[list[ProgramVersion]] = relationship(back_populates="academic_year")


class Course(Base):
    __tablename__ = "course"
    __table_args__ = (
        UniqueConstraint("subject_code", "course_number"),
        Index("ix_course_code_trgm", "course_code", postgresql_using="gin", postgresql_ops={"course_code": "gin_trgm_ops"}),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    subject_code: Mapped[str] = mapped_column(String(8))
    course_number: Mapped[str] = mapped_column(String(8))
    course_code: Mapped[str] = mapped_column(String(16))

    versions: Mapped[list[CourseVersion]] = relationship(back_populates="course")
    offerings: Mapped[list[CourseOffering]] = relationship(back_populates="course")
    rules: Mapped[list[CourseRule]] = relationship(back_populates="course")
    relationships_from: Mapped[list[CourseRelationship]] = relationship(
        back_populates="from_course",
        foreign_keys="CourseRelationship.from_course_id",
    )


class CourseVersion(Base):
    __tablename__ = "course_version"
    __table_args__ = (
        UniqueConstraint("course_id", "academic_year_id"),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id", ondelete="CASCADE"))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.academic_year.id"))
    title: Mapped[str] = mapped_column(String(255))
    credits: Mapped[Decimal] = mapped_column(Numeric(4, 1))
    description: Mapped[str] = mapped_column(Text, default="")
    source_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped[Course] = relationship(back_populates="versions")
    academic_year: Mapped[AcademicYear] = relationship(back_populates="course_versions")
    offerings: Mapped[list[CourseOffering]] = relationship(back_populates="course_version")


class Term(Base):
    __tablename__ = "term"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(8), unique=True)
    label: Mapped[str] = mapped_column(String(64))
    season: Mapped[str] = mapped_column(String(16))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.academic_year.id"))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    academic_year: Mapped[AcademicYear] = relationship(back_populates="terms")
    offerings: Mapped[list[CourseOffering]] = relationship(back_populates="term")


class CourseOffering(Base):
    __tablename__ = "course_offering"
    __table_args__ = (
        UniqueConstraint("course_id", "term_id"),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id", ondelete="CASCADE"))
    course_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course_version.id"))
    term_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.term.id", ondelete="CASCADE"))

    course: Mapped[Course] = relationship(back_populates="offerings")
    course_version: Mapped[CourseVersion] = relationship(back_populates="offerings")
    term: Mapped[Term] = relationship(back_populates="offerings")
    sections: Mapped[list[ClassSection]] = relationship(back_populates="offering", cascade="all, delete-orphan")


class ClassSection(Base):
    __tablename__ = "class_section"
    __table_args__ = (
        UniqueConstraint("offering_id", "section_code"),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    offering_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course_offering.id", ondelete="CASCADE"))
    section_code: Mapped[str] = mapped_column(String(16))
    class_nbr: Mapped[str | None] = mapped_column(String(16))
    instructor: Mapped[str] = mapped_column(String(255), default="")
    quota: Mapped[int | None] = mapped_column(Integer)
    enrol: Mapped[int | None] = mapped_column(Integer)
    avail: Mapped[int | None] = mapped_column(Integer)
    wait: Mapped[int | None] = mapped_column(Integer)
    remarks: Mapped[str] = mapped_column(Text, default="")

    offering: Mapped[CourseOffering] = relationship(back_populates="sections")
    meetings: Mapped[list[Meeting]] = relationship(back_populates="section", cascade="all, delete-orphan")


class Meeting(Base):
    __tablename__ = "meeting"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    section_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.class_section.id", ondelete="CASCADE"))
    weekday: Mapped[str | None] = mapped_column(String(8))
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    venue: Mapped[str] = mapped_column(String(128), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Hong_Kong")

    section: Mapped[ClassSection] = relationship(back_populates="meetings")


class CourseRule(Base):
    __tablename__ = "course_rule"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id", ondelete="CASCADE"))
    course_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.course_version.id"))
    kind: Mapped[str] = mapped_column(String(32))
    raw_text: Mapped[str] = mapped_column(Text)
    expression_json: Mapped[dict | None] = mapped_column(JSONB)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))

    course: Mapped[Course] = relationship(back_populates="rules")


class CourseRelationship(Base):
    __tablename__ = "course_relationship"
    __table_args__ = (
        UniqueConstraint("from_course_id", "to_course_id", "kind", "group_key"),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    from_course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id", ondelete="CASCADE"))
    to_course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.course.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    group_key: Mapped[str] = mapped_column(String(32), default="default")

    from_course: Mapped[Course] = relationship(
        back_populates="relationships_from",
        foreign_keys=[from_course_id],
    )
    to_course: Mapped[Course] = relationship(foreign_keys=[to_course_id])


class Program(Base):
    __tablename__ = "program"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    school: Mapped[str] = mapped_column(String(64))

    versions: Mapped[list[ProgramVersion]] = relationship(back_populates="program")


class ProgramVersion(Base):
    __tablename__ = "program_version"
    __table_args__ = (
        UniqueConstraint("program_id", "academic_year_id"),
        {"schema": "catalog"},
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    program_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.program.id", ondelete="CASCADE"))
    academic_year_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.academic_year.id"))
    notes: Mapped[str | None] = mapped_column(Text)

    program: Mapped[Program] = relationship(back_populates="versions")
    academic_year: Mapped[AcademicYear] = relationship(back_populates="program_versions")
    requirement_groups: Mapped[list[RequirementGroup]] = relationship(back_populates="program_version")
    combination_rules: Mapped[list[CombinationRule]] = relationship(back_populates="program_version")


class RequirementGroup(Base):
    __tablename__ = "requirement_group"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    program_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog.program_version.id", ondelete="CASCADE")
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.requirement_group.id"))
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32))
    min_credits: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))

    program_version: Mapped[ProgramVersion] = relationship(back_populates="requirement_groups")
    parent: Mapped[RequirementGroup | None] = relationship(remote_side="RequirementGroup.id")
    items: Mapped[list[RequirementItem]] = relationship(back_populates="group", cascade="all, delete-orphan")


class RequirementItem(Base):
    __tablename__ = "requirement_item"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("catalog.requirement_group.id", ondelete="CASCADE"))
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("catalog.course.id"))
    note: Mapped[str | None] = mapped_column(Text)

    group: Mapped[RequirementGroup] = relationship(back_populates="items")
    course: Mapped[Course | None] = relationship()


class CombinationRule(Base):
    __tablename__ = "combination_rule"
    __table_args__ = {"schema": "catalog"}

    id: Mapped[uuid.UUID] = uuid_pk()
    program_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("catalog.program_version.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(64))
    expression_json: Mapped[dict | None] = mapped_column(JSONB)

    program_version: Mapped[ProgramVersion] = relationship(back_populates="combination_rules")
