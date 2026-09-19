"""Dev-only fixture: a couple of dummy classes, a program/requirement tree, and
a demo student profile. Idempotent — safe to re-run. Real course/program data
is a separate ingestion job (WCQ scraper + prog-crs parser); this just gives
the agents something real to reason against during development.

Usage: python scripts/seed_dev_fixture.py
"""

from __future__ import annotations

from datetime import date, time

from app.db import SessionLocal
from app.models import (
    AcademicYear,
    ClassSection,
    Course,
    CourseOffering,
    CourseVersion,
    Meeting,
    Planner,
    Program,
    ProgramVersion,
    RequirementGroup,
    RequirementItem,
    StudentCourse,
    Term,
)

DEMO_PLANNER_ID = "demo-student"


def get_or_create(db, model, defaults=None, **lookup):
    obj = db.query(model).filter_by(**lookup).first()
    if obj:
        return obj, False
    obj = model(**lookup, **(defaults or {}))
    db.add(obj)
    db.flush()
    return obj, True


def main() -> None:
    db = SessionLocal()

    year, _ = get_or_create(db, AcademicYear, code="2026-27", defaults={"start_year": 2026})
    term, _ = get_or_create(
        db,
        Term,
        code="2610",
        defaults={
            "label": "2026-27 Fall",
            "season": "Fall",
            "academic_year_id": year.id,
            "start_date": date(2026, 9, 1),
            "end_date": date(2026, 12, 15),
        },
    )

    courses_spec = [
        ("COMP", "2011", "COMP2011", "Programming with C++", 4, "Mo", time(9, 0), time(10, 20), "Rm 101"),
        ("MATH", "1013", "MATH1013", "Calculus I", 3, "Mo", time(9, 0), time(10, 20), "Rm 101"),
    ]
    courses: dict[str, Course] = {}
    for subject, number, code, title, credits, day, start, end, venue in courses_spec:
        course, created = get_or_create(
            db, Course, course_code=code, defaults={"subject_code": subject, "course_number": number}
        )
        courses[code] = course
        version, _ = get_or_create(
            db,
            CourseVersion,
            course_id=course.id,
            academic_year_id=year.id,
            defaults={"title": title, "credits": credits},
        )
        offering, _ = get_or_create(
            db,
            CourseOffering,
            course_id=course.id,
            term_id=term.id,
            defaults={"course_version_id": version.id},
        )
        section, created_section = get_or_create(
            db, ClassSection, offering_id=offering.id, section_code="L1", defaults={"instructor": "Staff"}
        )
        if created_section:
            db.add(
                Meeting(
                    section_id=section.id,
                    weekday=day,
                    start_time=start,
                    end_time=end,
                    start_date=term.start_date,
                    end_date=term.end_date,
                    venue=venue,
                )
            )

    # Two programs that deliberately overlap on MATH1013, to exercise the
    # degree agent's compatibility check.
    comp_program, _ = get_or_create(
        db, Program, code="COMP", defaults={"name": "Computer Science", "school": "SENG"}
    )
    comp_version, _ = get_or_create(
        db, ProgramVersion, program_id=comp_program.id, academic_year_id=year.id, defaults={"notes": "BEng, School of Engineering"}
    )
    comp_core, created = get_or_create(
        db,
        RequirementGroup,
        program_version_id=comp_version.id,
        name="Major core",
        defaults={"kind": "major_core", "min_credits": 7, "parent_id": None},
    )
    if created:
        db.add(RequirementItem(group_id=comp_core.id, course_id=courses["COMP2011"].id))
        db.add(RequirementItem(group_id=comp_core.id, course_id=courses["MATH1013"].id))
        db.add(RequirementItem(group_id=comp_core.id, note="COMP 3711 Design & Analysis of Algorithms"))

    math_program, _ = get_or_create(
        db, Program, code="MATHMIN", defaults={"name": "Mathematics", "school": "SSCI"}
    )
    math_version, _ = get_or_create(
        db, ProgramVersion, program_id=math_program.id, academic_year_id=year.id, defaults={"notes": "Minor"}
    )
    math_core, created = get_or_create(
        db,
        RequirementGroup,
        program_version_id=math_version.id,
        name="Minor core",
        defaults={"kind": "minor_core", "min_credits": 3, "parent_id": None},
    )
    if created:
        db.add(RequirementItem(group_id=math_core.id, course_id=courses["MATH1013"].id))
        db.add(RequirementItem(group_id=math_core.id, note="MATH 2023 Multivariable Calculus"))

    # Demo student: some course history, no program declared yet — mirrors the
    # wireframe's Track B/C starting point ("what your completed courses
    # already count toward").
    planner, _ = get_or_create(db, Planner, planner_id=DEMO_PLANNER_ID)
    get_or_create(
        db,
        StudentCourse,
        planner_id=planner.id,
        course_id=courses["COMP2011"].id,
        term_id=None,
        defaults={"status": "completed"},
    )
    get_or_create(
        db,
        StudentCourse,
        planner_id=planner.id,
        course_id=courses["MATH1013"].id,
        term_id=None,
        defaults={"status": "in_progress"},
    )

    db.commit()
    print(f"Seeded: courses={list(courses)}, programs=[COMP, MATHMIN], demo planner_id={DEMO_PLANNER_ID!r}")


if __name__ == "__main__":
    main()
