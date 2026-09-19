"""Read/write operations for pathway building: requirement-tree progress,
cross-program overlap checks, and declaring/removing programs.

The requirement matching here is the deterministic "engine" half of the
pathway builder — it decides what counts. The degree agent's job is only to
call these functions and explain the result, never to compute matching itself.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

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
from app.services.catalog_queries import (
    academic_year_for_intake,
    catalog_year_code,
    get_program_detail,
    list_academic_years,
    program_kind,
    program_version_for_intake,
    resolve_program,
    version_has_requirement_courses,
)
from app.services.planner_ops import get_or_create_planner

DONE_STATUSES = {"completed"}
IN_PROGRESS_STATUSES = {"in_progress", "planned"}

COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,8})\s*(\d{4}[A-Z]?)\b")
COMPACT_CODE_RE = re.compile(r"\b[A-Z]{2,8}\d{4}[A-Z]?\b")
N_COURSES_RE = re.compile(r"(\d+)\s+courses?", re.I)
TRAILING_CREDITS_RE = re.compile(r"\s+\d+(?:\s*-\s*\d+)?\s*$")

OPTION_KINDS = {"area", "elective_list", "electives", "area_constraint"}
OR_KINDS = {"or_group"}
INFO_KINDS = {"remarks", "advisory_pathway", "placeholder"}


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
    return student_entry_year(db, planner_id)


def _program_unavailable(db: Session, program: Program, intake_year: int | None) -> str | None:
    year = catalog_year_code(intake_year) or "this catalog"
    version = program_version_for_intake(db, program, intake_year)
    if version is None:
        return f"{program.code} was not offered in the {year} catalog"
    if not version_has_requirement_courses(db, version):
        return f"{program.code} has no requirement tree in the {year} catalog"
    return None


def student_entry_year(db: Session, planner_id: str, program: Program | None = None) -> int | None:
    planner = get_or_create_planner(db, planner_id)
    if planner.entry_year is not None:
        return planner.entry_year
    if program is not None:
        matching = db.scalar(
            select(StudentProgram.intake_year).where(
                StudentProgram.planner_id == planner.id,
                StudentProgram.program_id == program.id,
                StudentProgram.intake_year.is_not(None),
            )
        )
        if matching is not None:
            return matching
    return db.scalar(
        select(StudentProgram.intake_year).where(
            StudentProgram.planner_id == planner.id,
            StudentProgram.intake_year.is_not(None),
        )
    )


def _student_course_status_by_code(db: Session, planner_id: str) -> dict[str, str]:
    planner = get_or_create_planner(db, planner_id)
    rows = db.execute(
        select(Course.course_code, StudentCourse.status)
        .join(Course, Course.id == StudentCourse.course_id)
        .where(StudentCourse.planner_id == planner.id)
    ).all()
    return {code: status for code, status in rows}


def _codes_in(text: str | None) -> list[str]:
    return [f"{subject}{number}" for subject, number in COURSE_CODE_RE.findall(text or "")]


def _display_expr(note: str) -> str:
    compact = COMPACT_CODE_RE.search(note)
    if compact and compact.start() > 8:
        return note[: compact.start()].strip(" -:·,")
    cleaned = TRAILING_CREDITS_RE.sub("", note.strip())
    return cleaned if len(cleaned) <= 90 else cleaned[:87].rsplit(" ", 1)[0] + "…"


def _item_status(course_code: str | None, by_code: dict[str, str]) -> str:
    if not course_code:
        return "info"
    status = by_code.get(course_code, "missing")
    if status in DONE_STATUSES:
        return "done"
    if status in IN_PROGRESS_STATUSES:
        return "in_progress"
    return "missing"


def _resolve_item_code(item: dict[str, Any]) -> str | None:
    if item.get("course_code"):
        return item["course_code"]
    note = item.get("note") or ""
    codes = _codes_in(note)
    leftover = COURSE_CODE_RE.sub("", note).strip(" -:·,")
    if len(codes) == 1 and len(leftover) <= 6:
        return codes[0]
    return None


def _unwrap(text: str) -> str:
    text = text.strip()
    while len(text) >= 2 and text[0] in "[(" and text[-1] in "])":
        depth = 0
        matched = True
        for i, ch in enumerate(text):
            if ch in "[(":
                depth += 1
            elif ch in "])":
                depth -= 1
                if depth == 0 and i != len(text) - 1:
                    matched = False
                    break
        if not matched or depth != 0:
            break
        text = text[1:-1].strip()
    return text


def _split_top_level(text: str, sep: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    token = f" {sep} "
    upper = text.upper()
    while i < len(text):
        ch = text[i]
        if ch in "[(":
            depth += 1
            buf.append(ch)
            i += 1
            continue
        if ch in "])":
            depth = max(0, depth - 1)
            buf.append(ch)
            i += 1
            continue
        if depth == 0 and upper.startswith(token, i):
            parts.append("".join(buf))
            buf = []
            i += len(token)
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def _codes_state(codes: list[str], by_code: dict[str, str], *, require_all: bool) -> str:
    if not codes:
        return "missing"
    states = [_item_status(code, by_code) for code in codes]
    if require_all:
        if all(state == "done" for state in states):
            return "done"
        if any(state in {"done", "in_progress"} for state in states):
            return "in_progress"
        return "missing"
    if any(state == "done" for state in states):
        return "done"
    if any(state == "in_progress" for state in states):
        return "in_progress"
    return "missing"


def _or_expression_status(note: str | None, by_code: dict[str, str]) -> str | None:
    """Top-level OR of AND-chunks; each AND-chunk is satisfied by any course in it.

    Covers COMP 2711 OR COMP 2711H, (COMP 2011 AND COMP 2012) OR COMP 2012H,
    and (MATH 1013 OR MATH 1023) AND (MATH 1014 OR MATH 1024).
    """
    if not note:
        return None
    cleaned = _unwrap(TRAILING_CREDITS_RE.sub("", note.strip()))
    if not _codes_in(cleaned):
        return None
    branch_states: list[str] = []
    for part in _split_top_level(cleaned, "OR"):
        part = _unwrap(part)
        chunks = _split_top_level(part, "AND") if re.search(r"\bAND\b", part, re.I) else [part]
        chunk_states = [
            _codes_state(_codes_in(_unwrap(chunk)), by_code, require_all=False)
            for chunk in chunks
            if _codes_in(_unwrap(chunk))
        ]
        if not chunk_states:
            continue
        if all(state == "done" for state in chunk_states):
            branch_states.append("done")
        elif any(state in {"done", "in_progress"} for state in chunk_states):
            branch_states.append("in_progress")
        else:
            branch_states.append("missing")
    if not branch_states:
        return None
    if "done" in branch_states:
        return "done"
    if "in_progress" in branch_states:
        return "in_progress"
    return "missing"


def _done_codes(group: dict[str, Any]) -> set[str]:
    codes = {
        item["course_code"]
        for item in group.get("items", [])
        if item.get("status") == "done" and item.get("course_code")
    }
    for child in group.get("children", []):
        codes |= _done_codes(child)
    return codes


def _annotate_group(group: dict[str, Any], by_code: dict[str, str]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for raw in group.get("items", []):
        code = _resolve_item_code(raw)
        items.append(
            {
                "course_code": code,
                "note": raw.get("note"),
                "status": _item_status(code, by_code),
            }
        )
    children = [_annotate_group(child, by_code) for child in group.get("children", [])]
    kind = group.get("kind") or ""
    name = group["name"]

    if kind in INFO_KINDS:
        done, of, status = 0, 0, "info"
    elif kind in OR_KINDS:
        expr = next((item["note"] for item in items if item["status"] == "info" and item.get("note")), None)
        status = _or_expression_status(expr, by_code)
        if status is None:
            trackable = [item for item in items if item["course_code"]]
            if any(item["status"] == "done" for item in trackable):
                status = "done"
            elif any(item["status"] == "in_progress" for item in trackable):
                status = "in_progress"
            else:
                status = "missing"
        done, of = (1, 1) if status == "done" else (0, 1)
        if expr:
            name = _display_expr(expr)
            items = [item for item in items if item.get("note") != expr]
    elif kind in OPTION_KINDS:
        blob = f"{group['name']} " + " ".join(item.get("note") or "" for item in group.get("items", []))
        match = N_COURSES_RE.search(blob)
        required_n = int(match.group(1)) if match else None
        taken = _done_codes({"items": items, "children": children})
        if required_n:
            done, of = min(len(taken), required_n), required_n
            if len(taken) >= required_n:
                status = "done"
            elif taken or any(child.get("status") == "in_progress" for child in children):
                status = "in_progress"
            else:
                status = "missing"
        else:
            done, of = len(taken), 0
            status = "in_progress" if taken else "missing"
    else:
        trackable = [item for item in items if item["course_code"]]
        done = sum(1 for item in trackable if item["status"] == "done")
        of = len(trackable)
        for child in children:
            done += child["done"]
            of += child["of"]
        in_flight = any(item["status"] == "in_progress" for item in trackable) or any(
            child.get("status") == "in_progress" for child in children
        )
        if of and done >= of:
            status = "done"
        elif done or in_flight:
            status = "in_progress"
        elif of:
            status = "missing"
        else:
            status = "info"

    return {
        "name": name,
        "kind": kind,
        "min_credits": group.get("min_credits"),
        "items": items,
        "children": children,
        "done": done,
        "of": of,
        "status": status,
    }


def check_requirement_progress(
    db: Session,
    planner_id: str,
    program_code: str,
    intake_year: int | None = None,
) -> dict[str, Any]:
    program, miss = lookup_program(db, program_code, intake_year)
    if miss:
        return miss

    year = intake_year if intake_year is not None else student_entry_year(db, planner_id, program)
    detail = get_program_detail(db, program.code, intake_year=year)
    if detail.get("error"):
        return detail
    if not detail.get("requirements"):
        return {**detail, "summary": "No requirement data for this program yet", "error": "No requirement data for this program yet"}

    by_code = _student_course_status_by_code(db, planner_id)
    groups = [_annotate_group(group, by_code) for group in detail["requirements"]]
    counted = [group for group in groups if group["kind"] not in INFO_KINDS]
    total_done = sum(group["done"] for group in counted)
    total_of = sum(group["of"] for group in counted)
    if total_of:
        summary = f"{total_done} of {total_of} requirements met"
    elif total_done:
        summary = f"{total_done} courses already count"
    else:
        summary = "No trackable requirements met yet"

    return {**detail, "requirements": groups, "summary": summary}


def get_student_profile(db: Session, planner_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)

    programs = db.scalars(select(StudentProgram).where(StudentProgram.planner_id == planner.id)).all()
    declared = []
    for sp in programs:
        program = db.get(Program, sp.program_id)
        declared.append(
            {
                "code": program.code if program else None,
                "name": program.name if program else None,
                "school": program.school if program else None,
                "role": sp.program_role,
                "intake_year": sp.intake_year,
            }
        )

    courses = db.scalars(select(StudentCourse).where(StudentCourse.planner_id == planner.id)).all()
    history = []
    for sc in courses:
        course = db.get(Course, sc.course_id)
        history.append({"course_code": course.course_code if course else None, "status": sc.status})

    entry_year = student_entry_year(db, planner_id)
    major = next((d for d in declared if d["role"] == "major"), declared[0] if declared else None)
    intake_year = entry_year
    if intake_year is None and major is not None:
        intake_year = major["intake_year"]
    if intake_year is None:
        intake_year = next((d["intake_year"] for d in declared if d["intake_year"] is not None), None)
    year = academic_year_for_intake(db, intake_year)
    return {
        "planner_id": planner.planner_id,
        "entry_year": entry_year,
        "standing_year": _standing_year(db, intake_year),
        "intake_year": intake_year,
        "catalog_year": year.code if year else catalog_year_code(intake_year),
        "declared_programs": declared,
        "courses": history,
    }


def _standing_year(db: Session, intake_year: int | None) -> int | None:
    if intake_year is None:
        return None
    latest = db.scalar(select(AcademicYear).order_by(AcademicYear.start_year.desc()))
    if latest is None:
        return None
    return latest.start_year - intake_year + 1


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


def requirement_course_codes(db: Session, program: Program, intake_year: int | None = None) -> set[str]:
    return {course.course_code for course in _requirement_courses(db, program, intake_year)}


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


def set_entry_year(db: Session, planner_id: str, entry_year: int) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    years = {year["start_year"] for year in list_academic_years(db)}
    if years and entry_year not in years:
        return {"error": f"No catalog for entry year {entry_year}"}
    planner.entry_year = entry_year
    for program in planner.programs:
        program.intake_year = entry_year
    db.commit()
    return get_student_profile(db, planner_id)


def _requirement_course_codes(db: Session, program: Program, intake_year: int | None = None) -> set[str]:
    detail = get_program_detail(db, program.code, intake_year=intake_year)
    codes: set[str] = set()

    def walk(group: dict[str, Any]) -> None:
        for item in group.get("items", []):
            if item.get("course_code"):
                codes.add(item["course_code"])
        for child in group.get("children", []):
            walk(child)

    for group in detail.get("requirements", []):
        walk(group)
    return codes


def check_pathway_compatibility(db: Session, planner_id: str, program_codes: list[str]) -> dict[str, Any]:
    """Course-level overlap across a candidate set of programs (declared + proposed)."""
    year = student_entry_year(db, planner_id)
    programs: list[Program] = []
    resolved: list[str] = []
    for code in program_codes:
        program, miss = lookup_program(db, code, year)
        if miss:
            return miss
        blocked = _program_unavailable(db, program, year)
        if blocked:
            return {"error": blocked}
        programs.append(program)
        resolved.append(program.code)

    per_program = {program.code: _requirement_course_codes(db, program, year) for program in programs}

    overlaps: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    codes = list(per_program)
    for i in range(len(codes)):
        for j in range(i + 1, len(codes)):
            shared = per_program[codes[i]] & per_program[codes[j]]
            for course_code in sorted(shared):
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
    compatibility = (
        check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}
    )

    return {
        "proposed": True,
        "code": program.code,
        "name": program.name,
        "role": role,
        "catalog_year": profile.get("catalog_year"),
        "intake_year": intake_year,
        "overlaps": compatibility.get("overlaps", []),
    }


def declare_program(
    db: Session,
    planner_id: str,
    program_code: str,
    role: str,
    intake_year: int | None = None,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    program, miss = lookup_program(db, program_code)
    if miss:
        return miss

    year = intake_year if intake_year is not None else student_entry_year(db, planner_id)
    blocked = _program_unavailable(db, program, year)
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
                intake_year=year,
            )
        )
    else:
        existing.program_role = role
        if year is not None:
            existing.intake_year = year
    db.commit()

    profile = get_student_profile(db, planner_id)
    already = [d["code"] for d in profile["declared_programs"] if d["code"] != program.code]
    compatibility = (
        check_pathway_compatibility(db, planner_id, [*already, program.code]) if already else {"overlaps": []}
    )

    return {
        "ok": True,
        "code": program.code,
        "name": program.name,
        "role": role,
        "overlaps": compatibility.get("overlaps", []),
    }


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
    dest.entry_year = src.entry_year
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
    "student_entry_year",
    "requirement_course_codes",
    "check_requirement_progress",
    "get_student_profile",
    "set_entry_year",
    "check_pathway_compatibility",
    "preview_declare_program",
    "declare_program",
    "remove_declared_program",
    "planner_intake_year",
    "list_pathways",
    "preview_pathway",
    "create_pathway",
    "rank_add_on_pathways",
]
