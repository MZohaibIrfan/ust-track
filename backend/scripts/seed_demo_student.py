"""Seed a shared year-2 COMP student (planner_id=demo-student).

Idempotent: wipes this planner's programs/courses/sections and rebuilds them.
Does not touch the catalog. Safe to re-run against Supabase.

Usage (from backend/):  python scripts/seed_demo_student.py
"""

from __future__ import annotations

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import (
    Course,
    RequirementCreditAllocation,
    StudentClassSelection,
    StudentCourse,
    StudentProgram,
)
from app.services.degree_ops import find_program
from app.services.planner_ops import add_class_selection, add_planned_course, get_or_create_planner

DEMO_PLANNER_ID = "demo-student"
INTAKE_YEAR = 2025  # Fall 2025 start → year 2 in 2026-27

# Year 1 done. Year 2 Fall in progress. Later COMP cores still missing.
COMPLETED = [
    "COMP2011",
    "COMP2012",
    "COMP2611",
    "MATH1013",
    "MATH1014",
    "PHYS1112",
    "ELEC1100",
]
IN_PROGRESS = ["COMP2711", "COMP3511"]
PLANNED = ["COMP3111", "COMP3711"]
# Current-term lectures + tutorial/lab that don't clash.
CURRENT_SECTIONS = [
    ("COMP2711", "L2"),
    ("COMP2711", "T2"),
    ("COMP3511", "L1"),
    ("COMP3511", "LA2"),
]


def _course(db, code: str) -> Course:
    course = db.scalar(select(Course).where(Course.course_code == code))
    if course is None:
        raise SystemExit(f"Catalog is missing {code} — ingest before seeding the demo student.")
    return course


def _add_course(db, code: str, status: str) -> None:
    _course(db, code)
    result = add_planned_course(db, DEMO_PLANNER_ID, code, status)
    if result.get("error"):
        raise SystemExit(result["error"])


def main() -> None:
    db = SessionLocal()
    try:
        comp = find_program(db, "COMP")
        if comp is None:
            raise SystemExit("Catalog is missing program COMP.")

        planner = get_or_create_planner(db, DEMO_PLANNER_ID)

        db.execute(delete(RequirementCreditAllocation).where(RequirementCreditAllocation.planner_id == planner.id))
        db.execute(delete(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id))
        db.execute(delete(StudentCourse).where(StudentCourse.planner_id == planner.id))
        db.execute(delete(StudentProgram).where(StudentProgram.planner_id == planner.id))
        db.commit()

        db.add(
            StudentProgram(
                planner_id=planner.id,
                program_id=comp.id,
                program_role="major",
                intake_year=INTAKE_YEAR,
            )
        )
        db.commit()

        for code in COMPLETED:
            _add_course(db, code, "completed")
        for code in IN_PROGRESS:
            _add_course(db, code, "in_progress")
        for code in PLANNED:
            _add_course(db, code, "planned")

        for course_code, section_code in CURRENT_SECTIONS:
            result = add_class_selection(db, DEMO_PLANNER_ID, course_code, section_code, "2610")
            if result.get("error"):
                raise SystemExit(result["error"])

        n_programs = len(db.scalars(select(StudentProgram).where(StudentProgram.planner_id == planner.id)).all())
        n_courses = len(db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all())
        n_sections = len(
            db.scalars(select(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id)).all()
        )
        print(
            f"Seeded {DEMO_PLANNER_ID}: year-2 COMP major (intake {INTAKE_YEAR}), "
            f"programs={n_programs}, courses={n_courses}, sections={n_sections}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
