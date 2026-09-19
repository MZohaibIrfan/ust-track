"""Read-only catalog lookups used by both the REST API and the advisor's tools."""

from __future__ import annotations

import json
from typing import Any, Literal

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    AcademicYear,
    ClassSection,
    Course,
    CourseOffering,
    CourseRelationship,
    CourseVersion,
    Program,
    ProgramVersion,
    RequirementGroup,
    RequirementItem,
)
from app.services.cache import cached, forget

SectionKind = Literal["lecture", "tutorial", "lab", "other"]
MatchMode = Literal["aligned", "any"]


def _section_kind(section_code: str) -> tuple[SectionKind, str]:
    letters = "".join(ch for ch in section_code if not ch.isdigit()).upper()
    number = "".join(ch for ch in section_code if ch.isdigit())
    if letters.startswith("LA"):
        return "lab", number
    if letters in {"L", "LX"}:
        return "lecture", number
    if letters in {"T", "TA", "TB", "TC", "TD"}:
        return "tutorial", number
    return "other", number


def _match_mode(lectures: list[dict[str, Any]], others: list[dict[str, Any]]) -> MatchMode:
    lecture_nums = {s["number"] for s in lectures if s["number"]}
    other_nums = {s["number"] for s in others if s["number"]}
    if lecture_nums and other_nums and lecture_nums == other_nums:
        return "aligned"
    return "any"


def _section_payload(section: ClassSection) -> dict[str, Any]:
    kind, number = _section_kind(section.section_code)
    return {
        "section_code": section.section_code,
        "kind": kind,
        "number": number,
        "instructor": section.instructor,
        "quota": section.quota,
        "avail": section.avail,
        "remarks": section.remarks,
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


def _course_hits_from_pairs(rows: list[tuple[Course, CourseVersion]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for course, version in rows:
        if course.course_code not in seen:
            seen[course.course_code] = {
                "course_code": course.course_code,
                "title": version.title,
                "credits": float(version.credits),
            }
    return list(seen.values())


def _latest_version(course: Course) -> CourseVersion | None:
    if not course.versions:
        return None
    return max(course.versions, key=lambda v: v.academic_year.start_year if v.academic_year else 0)


def _offering_payloads(course: Course) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for offering in course.offerings:
        sections = [_section_payload(section) for section in offering.sections]
        lectures = [s for s in sections if s["kind"] == "lecture"]
        tutorials = [s for s in sections if s["kind"] == "tutorial"]
        labs = [s for s in sections if s["kind"] == "lab"]
        payloads.append(
            {
                "term_code": offering.term.code,
                "term_label": offering.term.label,
                "matching": {
                    "tutorials": _match_mode(lectures, tutorials) if tutorials else "any",
                    "labs": _match_mode(lectures, labs) if labs else "any",
                },
                "sections": sections,
            }
        )
    return payloads


def _load_course(db: Session, course_code: str, *, with_rules: bool) -> Course | None:
    code = course_code.strip().replace(" ", "").upper()
    options = [
        selectinload(Course.versions).joinedload(CourseVersion.academic_year),
        selectinload(Course.offerings).selectinload(CourseOffering.sections).selectinload(ClassSection.meetings),
        selectinload(Course.offerings).joinedload(CourseOffering.term),
    ]
    if with_rules:
        options.append(selectinload(Course.rules))
        options.append(selectinload(Course.relationships_from).joinedload(CourseRelationship.to_course))
    return db.scalars(select(Course).where(Course.course_code == code).options(*options)).unique().first()


def get_course_detail(db: Session, course_code: str, *, lite: bool = False) -> dict[str, Any]:
    key = f"course:{course_code.strip().replace(' ', '').upper()}:{'lite' if lite else 'full'}"

    def _build() -> dict[str, Any]:
        course = _load_course(db, course_code, with_rules=not lite)
        if course is None:
            return {"error": f"No course with code {course_code}"}
        version = _latest_version(course)
        payload: dict[str, Any] = {
            "course_code": course.course_code,
            "title": version.title if version else None,
            "credits": float(version.credits) if version else None,
            "description": version.description if version else "",
            "offerings": _offering_payloads(course),
        }
        if not lite:
            payload["rules"] = [{"kind": r.kind, "raw_text": r.raw_text} for r in course.rules]
            payload["relationships"] = [
                {"kind": r.kind, "to_course": r.to_course.course_code} for r in course.relationships_from
            ]
        return payload

    payload = cached(key, _build)
    if "error" in payload:
        forget(key)
    return payload


def list_subjects(db: Session) -> list[str]:
    def _load() -> list[str]:
        rows = db.execute(select(Course.subject_code).distinct().order_by(Course.subject_code.asc())).all()
        return [row[0] for row in rows]

    return cached("subjects", _load)


def list_courses_by_subject(db: Session, subject: str) -> list[dict[str, Any]]:
    code = subject.strip().upper()
    if not code:
        return []

    def _load() -> list[dict[str, Any]]:
        stmt = (
            select(Course, CourseVersion)
            .join(CourseVersion, CourseVersion.course_id == Course.id)
            .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
            .where(Course.subject_code == code)
            .order_by(Course.course_code.asc(), AcademicYear.start_year.desc())
        )
        return _course_hits_from_pairs(list(db.execute(stmt).all()))

    return cached(f"subject:{code}", _load)


def list_common_core_labels(db: Session) -> list[dict[str, Any]]:
    def _load() -> list[dict[str, Any]]:
        rows = db.execute(
            text(
                """
                SELECT id, family, area, "group" AS group_name, wcq_text
                FROM catalog.common_core_label
                ORDER BY family, "group", area
                """
            )
        ).mappings()
        return [
            {
                "id": str(row["id"]),
                "family": row["family"],
                "area": row["area"],
                "group": row["group_name"],
                "wcq_text": row["wcq_text"],
            }
            for row in rows
        ]

    return cached("common-core", _load)


def list_courses_by_common_core(db: Session, label_id: str) -> list[dict[str, Any]]:
    def _load() -> list[dict[str, Any]]:
        try:
            course_ids = db.execute(
                text("SELECT DISTINCT course_id FROM catalog.course_common_core WHERE label_id = CAST(:lid AS uuid)"),
                {"lid": label_id},
            ).scalars().all()
        except Exception:
            db.rollback()
            return []
        if not course_ids:
            return []
        stmt = (
            select(Course, CourseVersion)
            .join(CourseVersion, CourseVersion.course_id == Course.id)
            .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
            .where(Course.id.in_(course_ids))
            .order_by(Course.course_code.asc(), AcademicYear.start_year.desc())
        )
        return _course_hits_from_pairs(list(db.execute(stmt).all()))

    return cached(f"cc:{label_id}", _load)


KIND_ORDER = {
    "required": 0,
    "engineering_fundamentals": 1,
    "group": 2,
    "or_group": 3,
    "electives": 4,
    "elective_list": 5,
    "area": 6,
    "area_constraint": 7,
    "remarks": 8,
    "advisory_pathway": 9,
    "placeholder": 10,
}


def _parse_version_meta(notes: str | None) -> dict[str, Any]:
    if not notes:
        return {}
    try:
        data = json.loads(notes)
    except json.JSONDecodeError:
        return {"notes": notes}
    if not isinstance(data, dict):
        return {"notes": notes}
    return {
        "kind": data.get("kind"),
        "award_title": data.get("award_title"),
        "duration": data.get("duration"),
    }


def _item_payload(item: RequirementItem) -> dict[str, Any]:
    return {
        "course_code": item.course.course_code if item.course is not None else None,
        "note": item.note,
    }


def _sort_items(items: list[RequirementItem]) -> list[RequirementItem]:
    def key(item: RequirementItem) -> tuple[int, str, str]:
        code = item.course.course_code if item.course is not None else ""
        return (0 if item.course_id is not None else 1, code, item.note or "")

    return sorted(items, key=key)


def _build_tree(groups: list[RequirementGroup]) -> list[dict[str, Any]]:
    by_parent: dict[Any, list[RequirementGroup]] = {}
    for group in groups:
        by_parent.setdefault(group.parent_id, []).append(group)
    for siblings in by_parent.values():
        siblings.sort(key=lambda g: (KIND_ORDER.get(g.kind, 50), g.name))

    def node(group: RequirementGroup) -> dict[str, Any]:
        return {
            "name": group.name,
            "kind": group.kind,
            "min_credits": float(group.min_credits) if group.min_credits is not None else None,
            "items": [_item_payload(item) for item in _sort_items(list(group.items))],
            "children": [node(child) for child in by_parent.get(group.id, [])],
        }

    return [node(group) for group in by_parent.get(None, [])]


def load_program_version(
    db: Session,
    program: Program,
    intake_year: int | None = None,
) -> tuple[ProgramVersion | None, str | None]:
    rows = list(
        db.execute(
            select(ProgramVersion, AcademicYear)
            .join(AcademicYear, ProgramVersion.academic_year_id == AcademicYear.id)
            .where(ProgramVersion.program_id == program.id)
            .order_by(AcademicYear.start_year.desc())
        ).all()
    )
    if not rows:
        return None, None

    version_ids = [pv.id for pv, _ay in rows]
    counts = dict(
        db.execute(
            select(RequirementGroup.program_version_id, func.count())
            .where(RequirementGroup.program_version_id.in_(version_ids))
            .group_by(RequirementGroup.program_version_id)
        ).all()
    )
    ranked = [(pv, ay) for pv, ay in rows if counts.get(pv.id, 0) > 0] or list(rows)

    chosen = ranked[0]
    if intake_year is not None:
        exact = next((pair for pair in ranked if pair[1].start_year == intake_year), None)
        if exact:
            chosen = exact
        else:
            older = [pair for pair in ranked if pair[1].start_year <= intake_year]
            if older:
                chosen = older[0]
            else:
                return None, None
    version, year = chosen
    return version, year.code


def load_requirement_tree(db: Session, version_id: Any) -> list[dict[str, Any]]:
    groups = (
        db.scalars(
            select(RequirementGroup)
            .where(RequirementGroup.program_version_id == version_id)
            .options(selectinload(RequirementGroup.items).joinedload(RequirementItem.course))
        )
        .unique()
        .all()
    )
    return _build_tree(list(groups))


def list_academic_years(db: Session) -> list[dict[str, Any]]:
    def _load() -> list[dict[str, Any]]:
        rows = db.execute(
            select(AcademicYear.code, AcademicYear.start_year)
            .join(ProgramVersion, ProgramVersion.academic_year_id == AcademicYear.id)
            .group_by(AcademicYear.code, AcademicYear.start_year)
            .order_by(AcademicYear.start_year.desc())
        ).all()
        return [{"code": code, "start_year": start_year} for code, start_year in rows]

    return cached("academic_years", _load)


def list_programs(db: Session, intake_year: int | None = None) -> list[dict[str, Any]]:
    def _load() -> list[dict[str, Any]]:
        programs = db.scalars(select(Program).order_by(Program.school.asc(), Program.code.asc())).all()
        version_rows = list(
            db.execute(
                select(ProgramVersion, AcademicYear).join(
                    AcademicYear, ProgramVersion.academic_year_id == AcademicYear.id
                )
            ).all()
        )
        counts = dict(
            db.execute(
                select(RequirementGroup.program_version_id, func.count()).group_by(
                    RequirementGroup.program_version_id
                )
            ).all()
        )
        by_program: dict[Any, list[tuple[ProgramVersion, AcademicYear, int]]] = {}
        for version, year in version_rows:
            by_program.setdefault(version.program_id, []).append(
                (version, year, int(counts.get(version.id, 0)))
            )
        for entries in by_program.values():
            entries.sort(key=lambda row: row[1].start_year, reverse=True)

        payload: list[dict[str, Any]] = []
        for program in programs:
            candidates = by_program.get(program.id, [])
            if intake_year is not None:
                candidates = [row for row in candidates if row[1].start_year <= intake_year]
            with_groups = [row for row in candidates if row[2] > 0]
            chosen = with_groups[0] if with_groups else (candidates[0] if candidates and intake_year is None else None)
            if chosen is None:
                continue
            meta = _parse_version_meta(chosen[0].notes if chosen else None)
            payload.append(
                {
                    "code": program.code,
                    "name": program.name,
                    "school": program.school,
                    "kind": meta.get("kind"),
                    "year": chosen[1].code if chosen else None,
                    "duration": meta.get("duration"),
                    "has_requirements": bool(chosen and chosen[2] > 0),
                }
            )
        return payload

    return cached(f"programs:{intake_year or 'latest'}", _load)


def get_program_detail(
    db: Session,
    program_code: str,
    intake_year: int | None = None,
) -> dict[str, Any]:
    code = program_code.strip().upper()
    key = f"program:{code}:{intake_year or 'latest'}"

    def _build() -> dict[str, Any]:
        program = db.scalar(select(Program).where(func.upper(Program.code) == code))
        if program is None:
            return {"error": f"No program with code {program_code}"}

        version, year = load_program_version(db, program, intake_year)
        if version is None:
            return {
                "code": program.code,
                "name": program.name,
                "school": program.school,
                "requirements": [],
            }

        meta = _parse_version_meta(version.notes)
        return {
            "code": program.code,
            "name": program.name,
            "school": program.school,
            "kind": meta.get("kind"),
            "year": year,
            "duration": meta.get("duration"),
            "award_title": meta.get("award_title"),
            "requirements": load_requirement_tree(db, version.id),
        }

    payload = cached(key, _build)
    if "error" in payload:
        forget(key)
    return payload
