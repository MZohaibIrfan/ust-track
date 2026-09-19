"""Read-only catalog lookups used by both the REST API and the advisor's tools."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AcademicYear,
    Course,
    CourseOffering,
    CourseRelationship,
    CourseRule,
    CourseVersion,
    Program,
    ProgramVersion,
    RequirementGroup,
)


def _latest_course_version(db: Session, course: Course) -> CourseVersion | None:
    stmt = (
        select(CourseVersion)
        .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
        .where(CourseVersion.course_id == course.id)
        .order_by(AcademicYear.start_year.desc())
    )
    return db.scalars(stmt).first()


def get_course_detail(db: Session, course_code: str) -> dict[str, Any]:
    code = course_code.strip().replace(" ", "")
    course = db.scalar(select(Course).where(func.upper(Course.course_code) == code.upper()))
    if course is None:
        return {"error": f"No course with code {course_code}"}

    version = _latest_course_version(db, course)
    rules = db.scalars(select(CourseRule).where(CourseRule.course_id == course.id)).all()
    relationships = db.scalars(
        select(CourseRelationship).where(CourseRelationship.from_course_id == course.id)
    ).all()
    offerings = db.scalars(select(CourseOffering).where(CourseOffering.course_id == course.id)).all()

    return {
        "course_code": course.course_code,
        "title": version.title if version else None,
        "credits": float(version.credits) if version else None,
        "description": version.description if version else "",
        "rules": [{"kind": r.kind, "raw_text": r.raw_text} for r in rules],
        "relationships": [{"kind": r.kind, "to_course": r.to_course.course_code} for r in relationships],
        "offerings": [
            {
                "term_code": offering.term.code,
                "term_label": offering.term.label,
                "sections": [
                    {
                        "section_code": section.section_code,
                        "instructor": section.instructor,
                        "quota": section.quota,
                        "avail": section.avail,
                        "meetings": [
                            {
                                "weekday": m.weekday,
                                "start_time": m.start_time.isoformat() if m.start_time else None,
                                "end_time": m.end_time.isoformat() if m.end_time else None,
                                "venue": m.venue,
                            }
                            for m in section.meetings
                        ],
                    }
                    for section in offering.sections
                ],
            }
            for offering in offerings
        ],
    }


def list_programs(db: Session) -> list[dict[str, Any]]:
    programs = db.scalars(select(Program)).all()
    return [{"code": p.code, "name": p.name, "school": p.school} for p in programs]


def _requirement_tree(db: Session, group: RequirementGroup) -> dict[str, Any]:
    children = db.scalars(
        select(RequirementGroup).where(RequirementGroup.parent_id == group.id)
    ).all()
    return {
        "name": group.name,
        "kind": group.kind,
        "min_credits": float(group.min_credits) if group.min_credits is not None else None,
        "items": [
            {"course_code": item.course.course_code if item.course else None, "note": item.note}
            for item in group.items
        ],
        "children": [_requirement_tree(db, child) for child in children],
    }


def get_program_detail(db: Session, program_code: str) -> dict[str, Any]:
    program = db.scalar(
        select(Program).where(func.upper(Program.code) == program_code.strip().upper())
    )
    if program is None:
        return {"error": f"No program with code {program_code}"}

    version = db.scalar(
        select(ProgramVersion)
        .join(AcademicYear, ProgramVersion.academic_year_id == AcademicYear.id)
        .where(ProgramVersion.program_id == program.id)
        .order_by(AcademicYear.start_year.desc())
    )
    if version is None:
        return {"code": program.code, "name": program.name, "school": program.school, "requirements": []}

    top_groups = db.scalars(
        select(RequirementGroup).where(
            RequirementGroup.program_version_id == version.id,
            RequirementGroup.parent_id.is_(None),
        )
    ).all()

    return {
        "code": program.code,
        "name": program.name,
        "school": program.school,
        "notes": version.notes,
        "requirements": [_requirement_tree(db, g) for g in top_groups],
    }
