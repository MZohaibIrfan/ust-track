"""Read/write operations for pathway building: requirement-tree progress,
cross-program overlap checks, and declaring/removing programs.

The requirement matching here is the deterministic "engine" half of the
pathway builder — it decides what counts. The degree agent's job is only to
call these functions and explain the result, never to compute matching itself.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    AcademicYear,
    Course,
    Program,
    ProgramVersion,
    RequirementGroup,
    RequirementItem,
    StudentCourse,
    StudentProgram,
)
from app.services.planner_ops import get_or_create_planner

DONE_STATUSES = {"completed"}
IN_PROGRESS_STATUSES = {"in_progress", "planned"}


def find_program(db: Session, program_code: str) -> Program | None:
    return db.scalar(select(Program).where(func.upper(Program.code) == program_code.strip().upper()))


def _latest_program_version(db: Session, program: Program) -> ProgramVersion | None:
    stmt = (
        select(ProgramVersion)
        .join(AcademicYear, ProgramVersion.academic_year_id == AcademicYear.id)
        .where(ProgramVersion.program_id == program.id)
        .order_by(AcademicYear.start_year.desc())
    )
    return db.scalars(stmt).first()


def _student_course_status(db: Session, planner_id: str) -> dict[str, str]:
    """course_id (str) -> status, for this planner's StudentCourse rows."""
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    return {str(r.course_id): r.status for r in rows}


def _requirement_group_progress(
    db: Session,
    group: RequirementGroup,
    course_status: dict[str, str],
) -> dict[str, Any]:
    children = db.scalars(select(RequirementGroup).where(RequirementGroup.parent_id == group.id)).all()

    items: list[dict[str, Any]] = []
    done_count = 0
    for item in group.items:
        if item.course_id is None:
            items.append({"course_code": None, "note": item.note, "status": "info"})
            continue
        status = course_status.get(str(item.course_id), "missing")
        mark = "done" if status in DONE_STATUSES else "in_progress" if status in IN_PROGRESS_STATUSES else "missing"
        if mark == "done":
            done_count += 1
        items.append({"course_code": item.course.course_code, "note": item.note, "status": mark})

    trackable = [i for i in items if i["course_code"] is not None]
    return {
        "name": group.name,
        "kind": group.kind,
        "min_credits": float(group.min_credits) if group.min_credits is not None else None,
        "items": items,
        "done": done_count,
        "of": len(trackable),
        "children": [_requirement_group_progress(db, child, course_status) for child in children],
    }


def check_requirement_progress(db: Session, planner_id: str, program_code: str) -> dict[str, Any]:
    program = find_program(db, program_code)
    if program is None:
        return {"error": f"No program with code {program_code}"}

    version = _latest_program_version(db, program)
    if version is None:
        return {"code": program.code, "name": program.name, "requirements": [], "error": "No requirement data for this program yet"}

    course_status = _student_course_status(db, planner_id)
    top_groups = db.scalars(
        select(RequirementGroup).where(
            RequirementGroup.program_version_id == version.id,
            RequirementGroup.parent_id.is_(None),
        )
    ).all()

    groups = [_requirement_group_progress(db, g, course_status) for g in top_groups]
    total_done = sum(g["done"] for g in groups)
    total_of = sum(g["of"] for g in groups)

    return {
        "code": program.code,
        "name": program.name,
        "school": program.school,
        "requirements": groups,
        "summary": f"{total_done} of {total_of} trackable requirements met",
    }


def get_student_profile(db: Session, planner_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)

    programs = db.scalars(select(StudentProgram).where(StudentProgram.planner_id == planner.id)).all()
    declared = []
    for sp in programs:
        program = db.get(Program, sp.program_id)
        declared.append({"code": program.code if program else None, "role": sp.program_role, "intake_year": sp.intake_year})

    courses = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    history = []
    for sc in courses:
        course = db.get(Course, sc.course_id)
        history.append({"course_code": course.course_code if course else None, "status": sc.status})

    return {"planner_id": planner.planner_id, "declared_programs": declared, "courses": history}


def _requirement_course_ids(db: Session, program: Program) -> set[str]:
    version = _latest_program_version(db, program)
    if version is None:
        return set()
    ids: set[str] = set()
    groups = db.scalars(select(RequirementGroup).where(RequirementGroup.program_version_id == version.id)).all()
    for g in groups:
        items = db.scalars(select(RequirementItem).where(RequirementItem.group_id == g.id)).all()
        ids.update(str(i.course_id) for i in items if i.course_id is not None)
    return ids


def check_pathway_compatibility(db: Session, planner_id: str, program_codes: list[str]) -> dict[str, Any]:
    """Course-level overlap across a candidate set of programs (declared + proposed)."""
    programs: list[Program] = []
    for code in program_codes:
        program = find_program(db, code)
        if program is None:
            return {"error": f"No program with code {code}"}
        programs.append(program)

    per_program = {p.code: _requirement_course_ids(db, p) for p in programs}

    overlaps: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    codes = list(per_program)
    for i in range(len(codes)):
        for j in range(i + 1, len(codes)):
            shared = per_program[codes[i]] & per_program[codes[j]]
            for course_id in shared:
                course = db.get(Course, course_id)
                key = (course.course_code, codes[i], codes[j])
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                overlaps.append({"course_code": course.course_code, "programs": [codes[i], codes[j]]})

    return {"programs": program_codes, "overlaps": overlaps}


def preview_declare_program(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    program = find_program(db, program_code)
    if program is None:
        return {"error": f"No program with code {program_code}"}

    profile = get_student_profile(db, planner_id)
    already = [d["code"] for d in profile["declared_programs"]]
    compatibility = check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}

    return {
        "proposed": True,
        "code": program.code,
        "name": program.name,
        "role": role,
        "overlaps": compatibility.get("overlaps", []),
    }


def declare_program(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    program = find_program(db, program_code)
    if program is None:
        return {"error": f"No program with code {program_code}"}

    existing = db.scalar(
        select(StudentProgram).where(
            StudentProgram.planner_id == planner.id, StudentProgram.program_id == program.id
        )
    )
    if existing is None:
        db.add(StudentProgram(planner_id=planner.id, program_id=program.id, program_role=role))
    else:
        existing.program_role = role
    db.commit()

    profile = get_student_profile(db, planner_id)
    already = [d["code"] for d in profile["declared_programs"] if d["code"] != program.code]
    compatibility = check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}

    return {"ok": True, "code": program.code, "name": program.name, "role": role, "overlaps": compatibility.get("overlaps", [])}


def remove_declared_program(db: Session, planner_id: str, program_code: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    program = find_program(db, program_code)
    if program is None:
        return {"error": f"No program with code {program_code}"}

    removed = (
        db.query(StudentProgram)
        .filter(StudentProgram.planner_id == planner.id, StudentProgram.program_id == program.id)
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed > 0}


__all__ = [
    "find_program",
    "check_requirement_progress",
    "get_student_profile",
    "check_pathway_compatibility",
    "preview_declare_program",
    "declare_program",
    "remove_declared_program",
]
