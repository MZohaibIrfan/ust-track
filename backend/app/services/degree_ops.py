"""Read/write operations for pathway building: requirement-tree progress,
cross-program overlap checks, and declaring/removing programs.

The requirement matching here is the deterministic "engine" half of the
pathway builder — it decides what counts. The degree agent's job is only to
call these functions and explain the result, never to compute matching itself.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AcademicYear,
    Course,
    Planner,
    Program,
    RequirementGroup,
    RequirementItem,
    StudentClassSelection,
    StudentCourse,
    StudentProgram,
)
from app.services.planner_ops import get_or_create_planner
from app.services.catalog_queries import (
    academic_year_for_intake,
    catalog_year_code,
    program_kind,
    program_version_for_intake,
    resolve_program,
    version_has_requirement_courses,
)

DONE_STATUSES = {"completed"}
IN_PROGRESS_STATUSES = {"in_progress", "planned"}


def find_program(db: Session, program_code: str, intake_year: int | None = None) -> Program | None:
    program, _, _ = resolve_program(db, program_code, intake_year)
    return program


def lookup_program(db: Session, program_code: str, intake_year: int | None = None) -> tuple[Program | None, dict[str, Any] | None]:
    program, candidates, error = resolve_program(db, program_code, intake_year)
    if program is not None:
        return program, None
    payload: dict[str, Any] = {"error": error or f"No program matching {program_code!r}"}
    if candidates:
        payload["candidates"] = candidates
    return None, payload


def planner_intake_year(db: Session, planner_id: str) -> int | None:
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(select(StudentProgram).where(StudentProgram.planner_id == planner.id)).all()
    major = next((row for row in rows if row.program_role == "major" and row.intake_year is not None), None)
    if major is not None:
        return major.intake_year
    return next((row.intake_year for row in rows if row.intake_year is not None), None)


def _program_unavailable(db: Session, program: Program, intake_year: int | None) -> str | None:
    year = catalog_year_code(intake_year) or "this catalog"
    version = program_version_for_intake(db, program, intake_year)
    if version is None:
        return f"{program.code} was not offered in the {year} catalog"
    if not version_has_requirement_courses(db, version):
        return f"{program.code} has no requirement tree in the {year} catalog"
    return None


def _student_course_status(db: Session, planner_id: str) -> dict[str, str]:
    """course_id (str) -> status, for this planner's StudentCourse rows."""
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    return {str(r.course_id): r.status for r in rows}


def _load_requirement_tree(db: Session, program_version_id: UUID) -> dict[UUID | None, list[RequirementGroup]]:
    """One round-trip for groups, items, and course codes — COMP's tree is too large for per-node queries."""
    groups = db.scalars(
        select(RequirementGroup)
        .where(RequirementGroup.program_version_id == program_version_id)
        .options(selectinload(RequirementGroup.items).selectinload(RequirementItem.course))
    ).all()
    children: dict[UUID | None, list[RequirementGroup]] = defaultdict(list)
    for group in groups:
        children[group.parent_id].append(group)
    return children


def _requirement_group_progress(
    group: RequirementGroup,
    course_status: dict[str, str],
    children_by_parent: dict[UUID | None, list[RequirementGroup]],
) -> dict[str, Any]:
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
        items.append(
            {
                "course_code": item.course.course_code if item.course else None,
                "note": item.note,
                "status": mark,
            }
        )

    trackable = [i for i in items if i["course_code"] is not None]
    return {
        "name": group.name,
        "kind": group.kind,
        "min_credits": float(group.min_credits) if group.min_credits is not None else None,
        "items": items,
        "done": done_count,
        "of": len(trackable),
        "children": [
            _requirement_group_progress(child, course_status, children_by_parent)
            for child in children_by_parent.get(group.id, [])
        ],
    }


def check_requirement_progress(db: Session, planner_id: str, program_code: str) -> dict[str, Any]:
    intake_year = planner_intake_year(db, planner_id)
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss
    year = academic_year_for_intake(db, intake_year)
    catalog_year = year.code if year else catalog_year_code(intake_year)
    blocked = _program_unavailable(db, program, intake_year)
    if blocked:
        return {"code": program.code, "name": program.name, "catalog_year": catalog_year, "requirements": [], "error": blocked}

    version = program_version_for_intake(db, program, intake_year)
    if version is None:
        return {"code": program.code, "name": program.name, "requirements": [], "error": "No requirement data for this program yet"}

    course_status = _student_course_status(db, planner_id)
    children_by_parent = _load_requirement_tree(db, version.id)
    groups = [
        _requirement_group_progress(g, course_status, children_by_parent)
        for g in children_by_parent.get(None, [])
    ]
    total_done = sum(g["done"] for g in groups)
    total_of = sum(g["of"] for g in groups)

    return {
        "code": program.code,
        "name": program.name,
        "school": program.school,
        "catalog_year": catalog_year,
        "intake_year": intake_year,
        "requirements": groups,
        "summary": f"{total_done} of {total_of} trackable requirements met",
    }


def _standing_year(db: Session, intake_year: int | None) -> int | None:
    if intake_year is None:
        return None
    latest = db.scalar(select(AcademicYear).order_by(AcademicYear.start_year.desc()))
    if latest is None:
        return None
    return latest.start_year - intake_year + 1


def get_student_profile(db: Session, planner_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)

    programs = db.scalars(select(StudentProgram).where(StudentProgram.planner_id == planner.id)).all()
    program_ids = {sp.program_id for sp in programs}
    programs_by_id = (
        {p.id: p for p in db.scalars(select(Program).where(Program.id.in_(program_ids))).all()}
        if program_ids
        else {}
    )
    declared = []
    for sp in programs:
        program = programs_by_id.get(sp.program_id)
        declared.append(
            {
                "code": program.code if program else None,
                "name": program.name if program else None,
                "role": sp.program_role,
                "intake_year": sp.intake_year,
            }
        )

    courses = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    course_ids = {sc.course_id for sc in courses}
    courses_by_id = (
        {c.id: c for c in db.scalars(select(Course).where(Course.id.in_(course_ids))).all()}
        if course_ids
        else {}
    )
    history = []
    for sc in courses:
        course = courses_by_id.get(sc.course_id)
        history.append({"course_code": course.course_code if course else None, "status": sc.status})

    major = next((d for d in declared if d["role"] == "major"), declared[0] if declared else None)
    intake_year = major["intake_year"] if major else None
    if intake_year is None:
        intake_year = next((d["intake_year"] for d in declared if d["intake_year"] is not None), None)
    standing = _standing_year(db, intake_year)
    year = academic_year_for_intake(db, intake_year)

    return {
        "planner_id": planner.planner_id,
        "standing_year": standing,
        "intake_year": intake_year,
        "catalog_year": year.code if year else catalog_year_code(intake_year),
        "declared_programs": declared,
        "courses": history,
    }


def _requirement_courses(db: Session, program: Program, intake_year: int | None = None) -> list[Course]:
    version = program_version_for_intake(db, program, intake_year)
    if version is None:
        return []
    return list(
        db.scalars(
            select(Course)
            .join(RequirementItem, RequirementItem.course_id == Course.id)
            .join(RequirementGroup, RequirementItem.group_id == RequirementGroup.id)
            .where(RequirementGroup.program_version_id == version.id)
            .distinct()
        ).all()
    )


def _requirement_course_ids(db: Session, program: Program, intake_year: int | None = None) -> set[str]:
    return {str(course.id) for course in _requirement_courses(db, program, intake_year)}


def rank_add_on_pathways(
    db: Session,
    planner_id: str,
    kinds: list[str] | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    """Rank catalog minors/extended majors by how much of this student's history already sits in their tree."""
    wanted = set(kinds or ["minor", "extended_major"])
    profile = get_student_profile(db, planner_id)
    intake_year = profile.get("intake_year")
    catalog_year = profile.get("catalog_year")
    major = next((d for d in profile["declared_programs"] if d["role"] == "major"), None)
    student_status = {c["course_code"]: c["status"] for c in profile["courses"] if c["course_code"]}
    student_codes = set(student_status)

    major_codes: set[str] = set()
    if major and major["code"]:
        major_program = find_program(db, major["code"])
        if major_program is not None:
            major_codes = {c.course_code for c in _requirement_courses(db, major_program, intake_year)}

    options: list[dict[str, Any]] = []
    skipped_empty: list[str] = []
    skipped_unavailable: list[dict[str, str]] = []
    for program in db.scalars(select(Program)).all():
        kind = program_kind(program.code)
        if kind not in wanted:
            continue
        if major and program.code == major["code"]:
            continue
        blocked = _program_unavailable(db, program, intake_year)
        if blocked:
            skipped_unavailable.append({"code": program.code, "reason": blocked})
            continue
        courses = _requirement_courses(db, program, intake_year)
        if not courses:
            skipped_empty.append(program.code)
            continue
        codes = {c.course_code for c in courses}
        counting = sorted(codes & student_codes)
        missing = sorted(codes - student_codes)
        major_overlap = sorted(codes & major_codes)
        options.append(
            {
                "code": program.code,
                "name": program.name,
                "kind": kind,
                "role": kind,
                "catalog_year": catalog_year,
                "trackable": len(codes),
                "already": len(counting),
                "open": len(missing),
                "already_counting": [{"course_code": code, "status": student_status[code]} for code in counting],
                "still_open": missing[:8],
                "major_overlap": major_overlap[:8],
                "major_overlap_count": len(major_overlap),
            }
        )

    options.sort(key=lambda row: (-row["already"], row["open"], row["code"]))
    return {
        "major": major,
        "intake_year": intake_year,
        "catalog_year": catalog_year,
        "options": options[: max(1, min(limit, 8))],
        "considered": len(options),
        "skipped_empty": skipped_empty,
        "skipped_unavailable": skipped_unavailable,
    }


def check_pathway_compatibility(db: Session, planner_id: str, program_codes: list[str]) -> dict[str, Any]:
    """Course-level overlap across a candidate set of programs (declared + proposed)."""
    intake_year = planner_intake_year(db, planner_id)
    programs: list[Program] = []
    resolved: list[str] = []
    for code in program_codes:
        program, miss = lookup_program(db, code)
        if miss:
            return miss
        blocked = _program_unavailable(db, program, intake_year)
        if blocked:
            return {"error": blocked}
        programs.append(program)
        resolved.append(program.code)

    per_program = {p.code: _requirement_course_ids(db, p, intake_year) for p in programs}
    all_shared_ids = set().union(*per_program.values()) if per_program else set()
    course_code_by_id = (
        {str(c.id): c.course_code for c in db.scalars(select(Course).where(Course.id.in_(all_shared_ids))).all()}
        if all_shared_ids
        else {}
    )

    overlaps: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    codes = list(per_program)
    for i in range(len(codes)):
        for j in range(i + 1, len(codes)):
            shared = per_program[codes[i]] & per_program[codes[j]]
            for course_id in shared:
                course_code = course_code_by_id.get(course_id)
                key = (course_code, codes[i], codes[j])
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                overlaps.append({"course_code": course_code, "programs": [codes[i], codes[j]]})

    return {"programs": resolved, "overlaps": overlaps}


def preview_declare_program(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss

    intake_year = planner_intake_year(db, planner_id)
    blocked = _program_unavailable(db, program, intake_year)
    if blocked:
        return {"error": blocked, "code": program.code, "name": program.name}

    profile = get_student_profile(db, planner_id)
    role = _coerce_role(profile, program, role)
    already = [d["code"] for d in profile["declared_programs"]]
    compatibility = check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}

    return {
        "proposed": True,
        "code": program.code,
        "name": program.name,
        "role": role,
        "catalog_year": profile.get("catalog_year"),
        "intake_year": intake_year,
        "overlaps": compatibility.get("overlaps", []),
    }


def declare_program(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss

    intake_year = planner_intake_year(db, planner_id)
    blocked = _program_unavailable(db, program, intake_year)
    if blocked:
        return {"error": blocked, "code": program.code, "name": program.name}

    profile = get_student_profile(db, planner_id)
    role = _coerce_role(profile, program, role)

    existing = db.scalar(
        select(StudentProgram).where(
            StudentProgram.planner_id == planner.id, StudentProgram.program_id == program.id
        )
    )
    if existing is None:
        db.add(
            StudentProgram(
                planner_id=planner.id,
                program_id=program.id,
                program_role=role,
                intake_year=intake_year,
            )
        )
    else:
        existing.program_role = role
        if existing.intake_year is None:
            existing.intake_year = intake_year
    db.commit()

    profile = get_student_profile(db, planner_id)
    already = [d["code"] for d in profile["declared_programs"] if d["code"] != program.code]
    compatibility = check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}

    return {"ok": True, "code": program.code, "name": program.name, "role": role, "overlaps": compatibility.get("overlaps", [])}


def remove_declared_program(db: Session, planner_id: str, program_code: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss

    removed = (
        db.query(StudentProgram)
        .filter(StudentProgram.planner_id == planner.id, StudentProgram.program_id == program.id)
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed > 0}


def _coerce_role(profile: dict[str, Any], program: Program, role: str) -> str:
    kind = program_kind(program.code)
    if kind in {"minor", "extended_major", "dual_degree"}:
        return kind
    has_major = any(d.get("role") == "major" and d.get("code") for d in profile.get("declared_programs", []))
    same_major = any(d.get("role") == "major" and d.get("code") == program.code for d in profile.get("declared_programs", []))
    if has_major and not same_major and role in {"major", "second_major", "additional_major"}:
        return "additional_major"
    return role


PATH_SEP = "::"


def pathway_root(planner_id: str) -> str:
    return planner_id.split(PATH_SEP, 1)[0]


def _pathway_label(declared: list[dict[str, Any]]) -> str:
    if not declared:
        return "Empty"
    major = next((d["code"] for d in declared if d["role"] == "major" and d["code"]), None)
    extras = [d["code"] for d in declared if d["role"] != "major" and d["code"]]
    head = major or declared[0]["code"] or "Plan"
    return " + ".join([head, *extras])


def _clone_student(db: Session, source_id: str, dest_id: str) -> Planner:
    src = get_or_create_planner(db, source_id)
    dest = get_or_create_planner(db, dest_id)
    db.execute(delete(StudentClassSelection).where(StudentClassSelection.planner_id == dest.id))
    db.execute(delete(StudentCourse).where(StudentCourse.planner_id == dest.id))
    db.execute(delete(StudentProgram).where(StudentProgram.planner_id == dest.id))
    db.flush()
    for row in db.scalars(select(StudentProgram).where(StudentProgram.planner_id == src.id)).all():
        db.add(
            StudentProgram(
                planner_id=dest.id,
                program_id=row.program_id,
                program_role=row.program_role,
                intake_year=row.intake_year,
            )
        )
    for row in db.scalars(select(StudentCourse).where(StudentCourse.planner_id == src.id)).all():
        db.add(
            StudentCourse(
                planner_id=dest.id,
                course_id=row.course_id,
                term_id=row.term_id,
                status=row.status,
            )
        )
    for row in db.scalars(select(StudentClassSelection).where(StudentClassSelection.planner_id == src.id)).all():
        db.add(StudentClassSelection(planner_id=dest.id, section_id=row.section_id))
    db.commit()
    return dest


def list_pathways(db: Session, planner_id: str) -> dict[str, Any]:
    root = pathway_root(planner_id)
    planners = db.scalars(
        select(Planner).where(or_(Planner.planner_id == root, Planner.planner_id.like(f"{root}{PATH_SEP}%")))
    ).all()
    pathways = []
    for planner in planners:
        profile = get_student_profile(db, planner.planner_id)
        pathways.append(
            {
                "planner_id": planner.planner_id,
                "label": _pathway_label(profile["declared_programs"]),
                "declared_programs": profile["declared_programs"],
                "home": planner.planner_id == root,
            }
        )
    pathways.sort(key=lambda row: (not row["home"], row["label"]))
    return {"root": root, "pathways": pathways}


def preview_pathway(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    preview = preview_declare_program(db, planner_id, program_code, role)
    if preview.get("error"):
        return preview
    profile = get_student_profile(db, planner_id)
    has_major = any(d["role"] == "major" for d in profile["declared_programs"])
    preview["fork"] = has_major and preview.get("role") != "major"
    preview["source_planner_id"] = planner_id
    return preview


def create_pathway(db: Session, planner_id: str, program_code: str, role: str) -> dict[str, Any]:
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss

    profile = get_student_profile(db, planner_id)
    role = _coerce_role(profile, program, role)
    has_major = any(d["role"] == "major" for d in profile["declared_programs"])

    if not has_major:
        result = declare_program(db, planner_id, program.code, role)
        result["planner_id"] = planner_id
        result["fork"] = False
        return result

    dest_id = f"{planner_id}{PATH_SEP}{program.code}"
    if len(dest_id) > 64:
        dest_id = dest_id[:64]

    blocked = _program_unavailable(db, program, planner_intake_year(db, planner_id))
    if blocked:
        return {"error": blocked, "code": program.code, "name": program.name}

    existing = db.scalar(select(Planner).where(Planner.planner_id == dest_id))
    if existing is None:
        _clone_student(db, planner_id, dest_id)
        result = declare_program(db, dest_id, program.code, role)
    else:
        result = declare_program(db, dest_id, program.code, role)
        result["existing"] = True

    result["planner_id"] = dest_id
    result["source_planner_id"] = planner_id
    result["fork"] = True
    result["label"] = _pathway_label(get_student_profile(db, dest_id)["declared_programs"])
    return result


__all__ = [
    "find_program",
    "planner_intake_year",
    "check_requirement_progress",
    "get_student_profile",
    "check_pathway_compatibility",
    "preview_declare_program",
    "declare_program",
    "remove_declared_program",
    "list_pathways",
    "preview_pathway",
    "create_pathway",
    "rank_add_on_pathways",
]
