"""Read/write operations against the planner schema.

This is the one place that mutates a student's plan. The advisor's tools and
the plain REST /api/plan endpoints both call into these functions, so nothing
the agent does bypasses the app's own rules.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    ClassSection,
    Course,
    CourseOffering,
    Planner,
    StudentClassSelection,
    StudentCourse,
    Term,
)


def get_or_create_planner(db: Session, planner_id: str) -> Planner:
    planner = db.scalar(select(Planner).where(Planner.planner_id == planner_id))
    if planner is None:
        planner = Planner(planner_id=planner_id)
        db.add(planner)
        db.commit()
        db.refresh(planner)
    return planner


def find_course(db: Session, course_code: str) -> Course | None:
    code = course_code.strip().replace(" ", "")
    return db.scalar(select(Course).where(func.upper(Course.course_code) == code.upper()))


def find_section(
    db: Session,
    course: Course,
    section_code: str,
    term_code: str | None = None,
) -> ClassSection | None:
    stmt = (
        select(ClassSection)
        .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
        .where(
            CourseOffering.course_id == course.id,
            func.upper(ClassSection.section_code) == section_code.strip().upper(),
        )
    )
    if term_code:
        stmt = stmt.join(Term, CourseOffering.term_id == Term.id).where(Term.code == term_code)
    return db.scalars(stmt).first()


def _meeting_dict(meeting: Any) -> dict[str, Any]:
    return {
        "weekday": meeting.weekday,
        "start_time": meeting.start_time.isoformat() if meeting.start_time else None,
        "end_time": meeting.end_time.isoformat() if meeting.end_time else None,
        "start_date": meeting.start_date.isoformat() if meeting.start_date else None,
        "end_date": meeting.end_date.isoformat() if meeting.end_date else None,
        "venue": meeting.venue,
    }


def _section_dict(section: ClassSection) -> dict[str, Any]:
    offering = section.offering
    return {
        "section_id": str(section.id),
        "course_code": offering.course.course_code,
        "section_code": section.section_code,
        "term_code": offering.term.code,
        "term_label": offering.term.label,
        "instructor": section.instructor,
        "meetings": [_meeting_dict(m) for m in section.meetings],
    }


def resolve_plan(db: Session, planner_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)

    # Query directly rather than through planner.courses / planner.class_selections:
    # those relationship collections can be cached stale in this same session if a
    # caller (e.g. replace_plan) read them before writing more rows to the DB.
    student_courses = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    planned_courses = []
    for student_course in student_courses:
        course = db.get(Course, student_course.course_id)
        term = db.get(Term, student_course.term_id) if student_course.term_id else None
        planned_courses.append(
            {
                "course_code": course.course_code if course else None,
                "term_label": term.label if term else None,
                "status": student_course.status,
            }
        )

    selections = db.scalars(
        select(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id)
    ).all()
    class_selections = []
    for selection in selections:
        section = db.get(ClassSection, selection.section_id)
        if section is not None:
            class_selections.append(_section_dict(section))

    return {
        "planner_id": planner.planner_id,
        "planned_courses": planned_courses,
        "class_selections": class_selections,
    }


def add_planned_course(
    db: Session,
    planner_id: str,
    course_code: str,
    status: str = "planned",
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    existing = db.scalar(
        select(StudentCourse).where(
            StudentCourse.planner_id == planner.id,
            StudentCourse.course_id == course.id,
            StudentCourse.term_id.is_(None),
        )
    )
    if existing is None:
        db.add(StudentCourse(planner_id=planner.id, course_id=course.id, status=status))
    else:
        existing.status = status
    db.commit()
    return {"ok": True, "course_code": course.course_code, "status": status}


def remove_planned_course(db: Session, planner_id: str, course_code: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    removed = (
        db.query(StudentCourse)
        .filter(StudentCourse.planner_id == planner.id, StudentCourse.course_id == course.id)
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed > 0}


def add_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    term_code: str | None = None,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    section = find_section(db, course, section_code, term_code)
    if section is None:
        where = f" in term {term_code}" if term_code else ""
        return {"error": f"No section {section_code} found for {course.course_code}{where}"}

    from app.services.conflicts import conflicts_with_candidate  # local import breaks the module cycle

    conflicts = conflicts_with_candidate(db, planner_id, section)

    existing = db.scalar(
        select(StudentClassSelection).where(
            StudentClassSelection.planner_id == planner.id,
            StudentClassSelection.section_id == section.id,
        )
    )
    if existing is None:
        db.add(StudentClassSelection(planner_id=planner.id, section_id=section.id))
        db.commit()

    return {
        "ok": True,
        "course_code": course.course_code,
        "section_code": section.section_code,
        "term_code": section.offering.term.code,
        "meetings": [_meeting_dict(m) for m in section.meetings],
        "conflicts": conflicts,
    }


def preview_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    term_code: str | None = None,
) -> dict[str, Any]:
    """Same lookup and conflict-check as add_class_selection, but writes nothing."""
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    section = find_section(db, course, section_code, term_code)
    if section is None:
        where = f" in term {term_code}" if term_code else ""
        return {"error": f"No section {section_code} found for {course.course_code}{where}"}

    from app.services.conflicts import conflicts_with_candidate  # local import breaks the module cycle

    conflicts = conflicts_with_candidate(db, planner_id, section)

    return {
        "proposed": True,
        "course_code": course.course_code,
        "section_code": section.section_code,
        "term_code": section.offering.term.code,
        "meetings": [_meeting_dict(m) for m in section.meetings],
        "conflicts": conflicts,
    }


def remove_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str | None = None,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    stmt = (
        select(StudentClassSelection)
        .join(ClassSection, StudentClassSelection.section_id == ClassSection.id)
        .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
        .where(
            StudentClassSelection.planner_id == planner.id,
            CourseOffering.course_id == course.id,
        )
    )
    if section_code:
        stmt = stmt.where(func.upper(ClassSection.section_code) == section_code.strip().upper())

    rows = db.scalars(stmt).all()
    for row in rows:
        db.delete(row)
    db.commit()
    return {"ok": True, "removed": len(rows)}


def replace_plan(
    db: Session,
    planner_id: str,
    course_ids: list[str],
    section_ids: list[str],
) -> dict[str, Any]:
    """Full-replace used by the plain UI's manual add/remove (not the agent)."""
    planner = get_or_create_planner(db, planner_id)

    current_courses = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    target_course_ids = set(course_ids)
    existing_course_ids = {str(sc.course_id) for sc in current_courses}
    for student_course in current_courses:
        if str(student_course.course_id) not in target_course_ids:
            db.delete(student_course)
    for course_id in target_course_ids - existing_course_ids:
        db.add(StudentCourse(planner_id=planner.id, course_id=course_id))

    current_selections = db.scalars(
        select(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id)
    ).all()
    target_section_ids = set(section_ids)
    existing_section_ids = {str(sel.section_id) for sel in current_selections}
    for selection in current_selections:
        if str(selection.section_id) not in target_section_ids:
            db.delete(selection)
    for section_id in target_section_ids - existing_section_ids:
        db.add(StudentClassSelection(planner_id=planner.id, section_id=section_id))

    db.commit()
    return resolve_plan(db, planner_id)
