"""Read-only catalog lookups used by both the REST API and the advisor's tools."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

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
    RequirementItem,
)


def academic_year_for_intake(db: Session, intake_year: int | None) -> AcademicYear | None:
    if intake_year is None:
        return db.scalar(select(AcademicYear).order_by(AcademicYear.start_year.desc()))
    return db.scalar(select(AcademicYear).where(AcademicYear.start_year == intake_year))


def catalog_year_code(intake_year: int | None) -> str | None:
    if intake_year is None:
        return None
    return f"{intake_year}-{str(intake_year + 1)[-2:]}"


def _latest_course_version(db: Session, course: Course) -> CourseVersion | None:
    stmt = (
        select(CourseVersion)
        .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
        .where(CourseVersion.course_id == course.id)
        .order_by(AcademicYear.start_year.desc())
    )
    return db.scalars(stmt).first()


def _course_version_for_intake(db: Session, course: Course, intake_year: int | None) -> CourseVersion | None:
    if intake_year is not None:
        version = db.scalar(
            select(CourseVersion)
            .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
            .where(CourseVersion.course_id == course.id, AcademicYear.start_year == intake_year)
        )
        if version is not None:
            return version
    return _latest_course_version(db, course)


def program_version_for_intake(db: Session, program: Program, intake_year: int | None) -> ProgramVersion | None:
    stmt = (
        select(ProgramVersion)
        .join(AcademicYear, ProgramVersion.academic_year_id == AcademicYear.id)
        .options(selectinload(ProgramVersion.academic_year))
        .where(ProgramVersion.program_id == program.id)
    )
    if intake_year is None:
        stmt = stmt.order_by(AcademicYear.start_year.desc())
        return db.scalars(stmt).first()
    return db.scalar(stmt.where(AcademicYear.start_year == intake_year))


def version_has_requirement_courses(db: Session, version: ProgramVersion) -> bool:
    count = db.scalar(
        select(func.count())
        .select_from(RequirementItem)
        .join(RequirementGroup, RequirementItem.group_id == RequirementGroup.id)
        .where(
            RequirementGroup.program_version_id == version.id,
            RequirementItem.course_id.is_not(None),
        )
    )
    return bool(count)


def get_course_detail(db: Session, course_code: str, intake_year: int | None = None) -> dict[str, Any]:
    code = course_code.strip().replace(" ", "")
    course = db.scalar(select(Course).where(func.upper(Course.course_code) == code.upper()))
    if course is None:
        return {"error": f"No course with code {course_code}"}

    version = _course_version_for_intake(db, course, intake_year)
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


def program_kind(code: str) -> str:
    if code.startswith("MINOR-"):
        return "minor"
    if code.startswith("EXTM-"):
        return "extended_major"
    if code == "UNIV-CC":
        return "common_core"
    if code == "T&M-DDP":
        return "dual_degree"
    return "major"


def _norm_query(text: str) -> str:
    return re.sub(r"[^a-z0-9+&]+", " ", text.lower()).strip()


# Student nicknames → uploaded catalog codes only. HKUST's ELEC is Electronic Engineering.
PROGRAM_ALIASES: dict[str, list[str]] = {
    "elec": ["ELEC"],
    "ee": ["ELEC"],
    "electrical": ["ELEC"],
    "electrical engineering": ["ELEC"],
    "electronic": ["ELEC"],
    "electronics": ["ELEC"],
    "electronic engineering": ["ELEC"],
    "cs": ["COMP"],
    "cse": ["COMP"],
    "comp": ["COMP"],
    "comp sci": ["COMP"],
    "computer science": ["COMP", "COSC"],
    "cosc": ["COSC"],
    "bsc cs": ["COSC"],
    "ce": ["CPEG"],
    "cpeg": ["CPEG"],
    "computer engineering": ["CPEG"],
    "chem": ["CENG"],
    "ceng": ["CENG"],
    "chemical": ["CENG"],
    "chemical engineering": ["CENG"],
    "mech": ["MECH"],
    "mechanical": ["MECH"],
    "mechanical engineering": ["MECH"],
    "civil": ["CIVL"],
    "civl": ["CIVL"],
    "civil engineering": ["CIVL"],
    "ciev": ["CIEV"],
    "environmental": ["CIEV", "EEEN"],
    "civil and environmental": ["CIEV"],
    "aero": ["AE"],
    "aerospace": ["AE"],
    "aerospace engineering": ["AE"],
    "aeronautical": ["MINOR-AERO"],
    "bien": ["BIEN"],
    "bioeng": ["BIEN"],
    "bioengineering": ["BIEN"],
    "da": ["DA"],
    "analytics": ["DA"],
    "decision analytics": ["DA"],
    "ai": ["AI"],
    "artificial intelligence": ["AI"],
    "extended ai": ["EXTM-AI"],
    "ai extended": ["EXTM-AI"],
    "ie": ["IEEM"],
    "ieem": ["IEEM"],
    "industrial": ["IEEM"],
    "industrial engineering": ["IEEM"],
    "meic": ["MEIC"],
    "microelectronics": ["MEIC"],
    "energy": ["EEEN"],
    "eeen": ["EEEN"],
    "it": ["MINOR-IT"],
    "it minor": ["MINOR-IT"],
    "minor in it": ["MINOR-IT"],
    "information technology": ["MINOR-IT"],
    "big data": ["MINOR-BDT"],
    "bdt": ["MINOR-BDT"],
    "smart city": ["MINOR-SC"],
    "robotics": ["MINOR-ROBO"],
    "robo": ["MINOR-ROBO"],
    "sustainability": ["EXTM-SUST"],
    "sust": ["EXTM-SUST"],
    "cadh": ["EXTM-CADH"],
    "digital humanities": ["EXTM-CADH"],
    "creative arts": ["EXTM-CADH"],
    "common core": ["UNIV-CC"],
    "cc": ["UNIV-CC"],
    "iim": ["IIM"],
    "individualized": ["IIM"],
    "dual": ["T&M-DDP"],
    "ddp": ["T&M-DDP"],
}


def _kind_hint(query: str) -> str | None:
    if "minor" in query.split() or query.startswith("minor "):
        return "minor"
    if "extended" in query or query.startswith("extm"):
        return "extended_major"
    return None


def _core_query(query: str) -> str:
    cleaned = query
    for token in ("extended major", "extended", "minor program", "minor", "major", "program"):
        cleaned = cleaned.replace(token, " ")
    return _norm_query(cleaned)


def resolve_program(
    db: Session, query: str, intake_year: int | None = None
) -> tuple[Program | None, list[dict[str, Any]], str | None]:
    """Map a nickname or code (elec, cs, ELEC) to an uploaded program for that intake year."""
    raw = (query or "").strip()
    if not raw:
        return None, [], "No program given"

    q = _norm_query(raw)
    compact = re.sub(r"[^A-Z0-9]", "", raw.upper())
    hint = _kind_hint(q)
    core = _core_query(q)

    offered: list[Program] = []
    for program in db.scalars(select(Program)).all():
        if intake_year is not None:
            version = program_version_for_intake(db, program, intake_year)
            if version is None or not version_has_requirement_courses(db, version):
                continue
        offered.append(program)

    by_code = {p.code.upper(): p for p in offered}
    if compact in by_code:
        return by_code[compact], [], None
    for program in offered:
        if re.sub(r"[^A-Z0-9]", "", program.code.upper()) == compact:
            return program, [], None

    alias_codes = list(PROGRAM_ALIASES.get(q, []))
    if core and core != q:
        alias_codes.extend(code for code in PROGRAM_ALIASES.get(core, []) if code not in alias_codes)
    for key in sorted(PROGRAM_ALIASES, key=len, reverse=True):
        if len(key) < 3 and q != key and core != key:
            continue
        if re.search(rf"(^|\s){re.escape(key)}(\s|$)", q) or (core and re.search(rf"(^|\s){re.escape(key)}(\s|$)", core)):
            alias_codes.extend(code for code in PROGRAM_ALIASES[key] if code not in alias_codes)

    scored: list[tuple[int, Program]] = []
    q_upper = (core or q).upper().replace(" ", "")
    for program in offered:
        kind = program_kind(program.code)
        if hint and kind != hint:
            continue
        code = program.code.upper()
        name_n = _norm_query(program.name)
        score = 0
        if code in alias_codes:
            score = 92
        elif len(q_upper) >= 3 and code.replace("-", "").startswith(q_upper):
            score = 88
        elif len(core) >= 3 and any(word.startswith(core) for word in name_n.split() if len(word) >= 4):
            score = 82
        elif core and core in name_n:
            score = 72
        else:
            ratio = SequenceMatcher(None, core or q, name_n).ratio()
            if ratio >= 0.78 and len(core or q) >= 5:
                score = int(70 * ratio)
            for word in name_n.split():
                word_ratio = SequenceMatcher(None, core or q, word).ratio()
                if word_ratio >= 0.8 and len(core or q) >= 4:
                    score = max(score, int(78 * word_ratio))
        if score:
            scored.append((score, program))

    if hint and not scored and core and core != q:
        return resolve_program(db, core, intake_year)

    scored.sort(key=lambda row: (-row[0], row[1].code))
    year = catalog_year_code(intake_year) or "this catalog"
    if not scored:
        return None, [], f"No program matching {raw!r} in the {year} catalog"

    best = scored[0][0]
    close = [program for score, program in scored if score >= best - 8]
    unique: list[Program] = []
    seen: set[str] = set()
    for program in close:
        if program.code not in seen:
            seen.add(program.code)
            unique.append(program)

    if len(unique) == 1 or scored[0][0] >= (scored[1][0] if len(scored) > 1 else 0) + 10:
        return unique[0], [], None

    candidates = [{"code": p.code, "name": p.name, "kind": program_kind(p.code)} for p in unique[:5]]
    return (
        None,
        candidates,
        f"{raw!r} could mean more than one program. Pick a code: " + ", ".join(c["code"] for c in candidates),
    )


def search_programs(db: Session, query: str, intake_year: int | None = None) -> dict[str, Any]:
    """Resolve slang or a partial name (elec, cs, big data) to catalog programs."""
    program, candidates, error = resolve_program(db, query, intake_year)
    if program is not None:
        return {
            "query": query,
            "matches": [
                {
                    "code": program.code,
                    "name": program.name,
                    "kind": program_kind(program.code),
                    "school": program.school,
                }
            ],
        }
    if candidates:
        return {"query": query, "matches": candidates, "note": error}
    return {"query": query, "matches": [], "error": error}


def list_programs(db: Session, intake_year: int | None = None) -> list[dict[str, Any]]:
    """Programs in the catalog. If intake_year is set, only those with a requirement tree that year."""
    year = academic_year_for_intake(db, intake_year)
    catalog_year = year.code if year else catalog_year_code(intake_year)
    rows: list[dict[str, Any]] = []
    for program in db.scalars(select(Program).order_by(Program.code)).all():
        version = program_version_for_intake(db, program, intake_year)
        if intake_year is not None and (version is None or not version_has_requirement_courses(db, version)):
            continue
        rows.append(
            {
                "code": program.code,
                "name": program.name,
                "school": program.school,
                "kind": program_kind(program.code),
                "catalog_year": version.academic_year.code if version and version.academic_year else catalog_year,
            }
        )
    return rows


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


def get_program_detail(db: Session, program_code: str, intake_year: int | None = None) -> dict[str, Any]:
    program = db.scalar(
        select(Program).where(func.upper(Program.code) == program_code.strip().upper())
    )
    if program is None:
        return {"error": f"No program with code {program_code}"}

    version = program_version_for_intake(db, program, intake_year)
    if version is None:
        year = catalog_year_code(intake_year) or "this catalog"
        return {
            "code": program.code,
            "name": program.name,
            "school": program.school,
            "requirements": [],
            "error": f"{program.code} was not offered in the {year} catalog",
        }

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
        "catalog_year": version.academic_year.code if version.academic_year else catalog_year_code(intake_year),
        "notes": version.notes,
        "requirements": [_requirement_tree(db, g) for g in top_groups],
    }
