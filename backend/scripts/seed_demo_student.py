"""Seed isolated demo planners (separate accounts).

  demo-y4-comp  Year 4 COMP major + IT minor
  demo-y3-cosc  Year 3 COSC major + ELEC additional major + BIEN minor (login: fangle@connect.ust.hk)
  demo-y2-cosc  Year 2 COSC major + ELEC additional major
  demo-y1-seng  Year 1 School of Engineering, undeclared

Idempotent: wipes each planner (and its what-if pathway copies) then rebuilds.
Does not replace the course catalog. Safe to re-run against Supabase.

Usage (from the repo root):
  backend/.venv/bin/python backend/scripts/seed_demo_student.py
"""

from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from sqlalchemy import delete, or_, select

    from app.db import SessionLocal
except ModuleNotFoundError:
    sys.exit(
        "Missing backend deps. From the repo root run:\n"
        "  backend/.venv/bin/python backend/scripts/seed_demo_student.py"
    )
from app.models import (
    AcademicYear,
    Planner,
    RequirementCreditAllocation,
    StudentClassSelection,
    StudentCourse,
    StudentExperience,
    StudentProgram,
    Term,
)
from app.services.catalog_queries import _section_kind
from app.services.degree_ops import find_program
from app.services.planner_ops import (
    _load_course_sections,
    add_class_selection,
    add_planned_course,
    find_course,
    get_or_create_planner,
)

CURRENT_TERM = "2610"

HOME_IDS = ("demo-y4-comp", "demo-y3-cosc", "demo-y2-cosc", "demo-y1-seng", "demo-student")

# Fall / Spring labels for History. Current WCQ snapshot only has 2610;
# earlier terms are created here so completed rows can show a real term name.
HISTORY_TERMS = [
    ("2310", "2023-24 Fall", "Fall", "2023-24", date(2023, 9, 1), date(2023, 12, 20)),
    ("2330", "2023-24 Spring", "Spring", "2023-24", date(2024, 2, 1), date(2024, 5, 31)),
    ("2410", "2024-25 Fall", "Fall", "2024-25", date(2024, 9, 1), date(2024, 12, 20)),
    ("2430", "2024-25 Spring", "Spring", "2024-25", date(2025, 2, 1), date(2025, 5, 31)),
    ("2510", "2025-26 Fall", "Fall", "2025-26", date(2025, 9, 1), date(2025, 12, 20)),
    ("2530", "2025-26 Spring", "Spring", "2025-26", date(2026, 2, 1), date(2026, 5, 31)),
]


def _wipe_tree(db, root_id: str) -> None:
    planners = db.scalars(
        select(Planner).where(or_(Planner.planner_id == root_id, Planner.planner_id.like(f"{root_id}::%")))
    ).all()
    for planner in planners:
        db.execute(delete(RequirementCreditAllocation).where(RequirementCreditAllocation.planner_id == planner.id))
        db.execute(delete(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id))
        db.execute(delete(StudentExperience).where(StudentExperience.planner_id == planner.id))
        db.execute(delete(StudentCourse).where(StudentCourse.planner_id == planner.id))
        db.execute(delete(StudentProgram).where(StudentProgram.planner_id == planner.id))
        if planner.planner_id != root_id or root_id == "demo-student":
            db.delete(planner)
    db.commit()


def _ensure_terms(db) -> dict[str, Term]:
    by_code: dict[str, Term] = {t.code: t for t in db.scalars(select(Term)).all()}
    years = {y.code: y for y in db.scalars(select(AcademicYear)).all()}
    for code, label, season, year_code, start, end in HISTORY_TERMS:
        if code in by_code:
            continue
        year = years.get(year_code)
        if year is None:
            print(f"  skip term {code}: catalog has no academic year {year_code}")
            continue
        term = Term(
            code=code,
            label=label,
            season=season,
            academic_year_id=year.id,
            start_date=start,
            end_date=end,
        )
        db.add(term)
        db.flush()
        by_code[code] = term
    db.commit()
    return by_code


def _require_program(db, code: str):
    program = find_program(db, code)
    if program is None:
        raise SystemExit(f"Catalog is missing program {code}.")
    return program


def _add_course(db, planner_id: str, code: str, status: str, term: Term | None) -> bool:
    course = find_course(db, code)
    if course is None:
        print(f"  skip {code}: not in catalog")
        return False
    if term is None:
        result = add_planned_course(db, planner_id, code, status)
        if result.get("error"):
            print(f"  skip {code}: {result['error']}")
            return False
        return True
    planner = get_or_create_planner(db, planner_id)
    existing = db.scalar(
        select(StudentCourse).where(
            StudentCourse.planner_id == planner.id,
            StudentCourse.course_id == course.id,
            StudentCourse.term_id == term.id,
        )
    )
    if existing is None:
        db.add(StudentCourse(planner_id=planner.id, course_id=course.id, term_id=term.id, status=status))
    else:
        existing.status = status
    db.commit()
    return True


def _enroll(db, planner_id: str, course_code: str, term_code: str = CURRENT_TERM) -> None:
    course = find_course(db, course_code)
    if course is None:
        print(f"  skip sections {course_code}: not in catalog")
        return
    sections = _load_course_sections(db, course, term_code)
    if not sections:
        print(f"  skip sections {course_code}: no offering in {term_code}")
        return
    grouped: dict[str, list] = {"lecture": [], "tutorial": [], "lab": [], "other": []}
    for section in sections:
        kind, _ = _section_kind(section.section_code)
        grouped[kind].append(section)
    if not grouped["lecture"] and grouped["other"]:
        grouped["lecture"] = grouped["other"]
        grouped["other"] = []

    from app.services.conflicts import conflicts_with_candidate

    picked: list[str] = []
    for kind in ("lecture", "tutorial", "lab"):
        for section in grouped[kind]:
            if conflicts_with_candidate(db, planner_id, section):
                continue
            result = add_class_selection(db, planner_id, course_code, section.section_code, term_code)
            if result.get("error"):
                continue
            picked.append(section.section_code)
            break
    if picked:
        print(f"  {course_code}: {', '.join(picked)}")
    else:
        print(f"  skip sections {course_code}: no clash-free fit in {term_code}")


def _declare(db, planner, program, role: str, intake: int) -> None:
    db.add(
        StudentProgram(
            planner_id=planner.id,
            program_id=program.id,
            program_role=role,
            intake_year=intake,
        )
    )
    db.commit()


def _experience(db, planner_id: str, **kwargs) -> None:
    planner = get_or_create_planner(db, planner_id)
    db.add(StudentExperience(planner_id=planner.id, **kwargs))
    db.commit()


def _seed_y4_comp(db, terms: dict[str, Term]) -> None:
    planner_id = "demo-y4-comp"
    intake = 2023
    planner = get_or_create_planner(db, planner_id)
    planner.entry_year = intake
    db.commit()
    _declare(db, planner, _require_program(db, "COMP"), "major", intake)
    _declare(db, planner, _require_program(db, "MINOR-IT"), "minor", intake)

    completed = [
        ("2310", ["COMP1023", "MATH1013", "ENGG1300"]),
        ("2330", ["MATH1014", "PHYS1112", "SOSC1960"]),
        ("2410", ["MATH2111", "COMP2011", "COMP2711"]),
        ("2430", ["MATH2411", "COMP2012", "COMP2611"]),
        ("2510", ["COMP3111", "COMP3511", "COMP3711"]),
        ("2530", ["COMP4211", "COMP4411", "ELEC1100", "ISOM2010"]),
    ]
    for term_code, codes in completed:
        for code in codes:
            _add_course(db, planner_id, code, "completed", terms.get(term_code))
    for code in ["COMP4981", "COMP4331"]:
        _add_course(db, planner_id, code, "in_progress", terms.get(CURRENT_TERM))
    for code in ["COMP4981", "COMP4331"]:
        _enroll(db, planner_id, code)
    _experience(
        db,
        planner_id,
        title="Software Engineering Intern",
        organization="Hang Seng Bank",
        kind="internship",
        start_date=date(2025, 6, 2),
        end_date=date(2025, 8, 22),
        description="Backend services for retail banking, Java and SQL.",
    )
    print(f"Seeded {planner_id}: year-4 COMP + MINOR-IT (intake {intake})")


def _ensure_demo_account(db, planner_id: str, email: str, password: str, display_name: str) -> None:
    """Attach a login to a named demo planner. Idempotent; resets the password."""
    from app.models import User
    from app.services.auth_ops import hash_password

    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, password_hash=hash_password(password), display_name=display_name)
        db.add(user)
        db.flush()
    else:
        user.password_hash = hash_password(password)
        user.display_name = display_name
    user.onboarding_completed_at = datetime.now(timezone.utc)

    for other in db.scalars(select(Planner).where(Planner.user_id == user.id)).all():
        if other.planner_id != planner_id:
            other.user_id = None
            if other.planner_id == str(user.id):
                db.delete(other)
    db.flush()

    planner = get_or_create_planner(db, planner_id)
    planner.user_id = user.id
    db.commit()


def _seed_y3_cosc(db, terms: dict[str, Term]) -> None:
    """Year 3 COSC + ELEC + BIEN minor, courses laid out on the CSE recommended pathway."""
    planner_id = "demo-y3-cosc"
    intake = 2024
    _ensure_demo_account(db, planner_id, "fangle@connect.ust.hk", "fangledemo", "Fangle")
    planner = get_or_create_planner(db, planner_id)
    planner.entry_year = intake
    db.commit()
    _declare(db, planner, _require_program(db, "COSC"), "major", intake)
    _declare(db, planner, _require_program(db, "ELEC"), "additional_major", intake)
    _declare(db, planner, _require_program(db, "MINOR-BIEN"), "minor", intake)

    # CSE recommended pathway (major + minor), with ELEC cores slotted into open terms.
    completed = [
        ("2410", ["MATH1013", "COMP1023", "HMAW1905B", "LANG1402", "PHYS1112"]),
        ("2430", ["MATH1014", "LANG1406", "ELEC1100", "SOSC1960"]),
        ("2510", ["MATH2111", "COMP2011", "COMP2711", "ELEC2100"]),
        ("2530", ["MATH2411", "COMP2012", "COMP2611", "BIEN2610", "ELEC2400"]),
    ]
    for term_code, codes in completed:
        for code in codes:
            _add_course(db, planner_id, code, "completed", terms.get(term_code))
    # Year 3 Fall (current): SE / OS / algorithms + BIEN minor + ELEC.
    for code in ["COMP3111", "COMP3511", "COMP3711", "BIEN3410", "ELEC3100"]:
        _add_course(db, planner_id, code, "in_progress", terms.get(CURRENT_TERM))
    for code in ["COMP3111", "COMP3511", "COMP3711"]:
        _enroll(db, planner_id, code)
    _experience(
        db,
        planner_id,
        title="Firmware intern",
        organization="ASM Pacific Technology",
        kind="internship",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 21),
        description="C++ tooling for die-bonding equipment; mixed COSC systems work with ELEC lab bring-up.",
    )
    print(f"Seeded {planner_id}: year-3 COSC + ELEC + MINOR-BIEN (intake {intake})")


def _seed_y2_cosc(db, terms: dict[str, Term]) -> None:
    planner_id = "demo-y2-cosc"
    intake = 2025
    planner = get_or_create_planner(db, planner_id)
    planner.entry_year = intake
    db.commit()
    _declare(db, planner, _require_program(db, "COSC"), "major", intake)
    _declare(db, planner, _require_program(db, "ELEC"), "additional_major", intake)

    for code in ["MATH1013", "COMP1023", "PHYS1112"]:
        _add_course(db, planner_id, code, "completed", terms.get("2510"))
    for code in ["MATH1014", "COMP2011", "ELEC1100", "SOSC1960"]:
        _add_course(db, planner_id, code, "completed", terms.get("2530"))
    for code in ["COMP2012", "COMP2711", "ELEC2100"]:
        _add_course(db, planner_id, code, "in_progress", terms.get(CURRENT_TERM))
    for code in ["COMP2611", "MATH2111", "ELEC2400"]:
        _add_course(db, planner_id, code, "planned", None)
    for code in ["COMP2012", "COMP2711", "ELEC2100"]:
        _enroll(db, planner_id, code)
    _experience(
        db,
        planner_id,
        title="RoboMaster software team",
        organization="HKUST Robotics Team",
        kind="project",
        start_date=date(2026, 1, 15),
        end_date=None,
        description="Vision pipeline for the campus robot team.",
    )
    print(f"Seeded {planner_id}: year-2 COSC + ELEC (intake {intake})")


def _seed_y1_seng(db, terms: dict[str, Term]) -> None:
    planner_id = "demo-y1-seng"
    intake = 2026
    planner = get_or_create_planner(db, planner_id)
    planner.entry_year = intake
    db.commit()
    for code in ["MATH1013", "COMP1023", "AISC1000A", "ENGG1300"]:
        _add_course(db, planner_id, code, "in_progress", terms.get(CURRENT_TERM))
    for code in ["MATH1013", "COMP1023", "AISC1000A", "ENGG1300"]:
        _enroll(db, planner_id, code)
    print(f"Seeded {planner_id}: year-1 SENG undeclared (intake {intake})")


def main() -> None:
    db = SessionLocal()
    try:
        for root in HOME_IDS:
            _wipe_tree(db, root)
        terms = _ensure_terms(db)
        _seed_y4_comp(db, terms)
        _seed_y3_cosc(db, terms)
        _seed_y2_cosc(db, terms)
        _seed_y1_seng(db, terms)
    finally:
        db.close()


if __name__ == "__main__":
    main()
