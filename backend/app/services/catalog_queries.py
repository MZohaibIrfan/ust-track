"""Read-only catalog lookups used by both the REST API and the advisor's tools."""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
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


def get_course_detail(db: Session, course_code: str, intake_year: int | None = None, *, lite: bool = False) -> dict[str, Any]:
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
    "engineering_fundamentals": 0,
    "required": 1,
    "group": 2,
    "or_group": 3,
    "electives": 4,
    "elective_list": 5,
    "area_constraint": 6,
    "area": 7,
    "remarks": 8,
    "advisory_pathway": 9,
    "placeholder": 10,
}

# Catalog table order for COMP / COSC elective areas (not alphabetical).
AREA_ORDER = {
    "Artificial Intelligence / Theory": 0,
    "Vision & Graphics / Multimedia": 1,
    "Software / Database": 2,
    "Computer Systems / Networking": 3,
    "Courses Without Associated": 4,
    "Courses Without Associated Area": 4,
}

LOOSE_CODE_RE = re.compile(r"([A-Z]{2,8})\s*(\d{4}[A-Z]?)", re.I)
TRAILING_CREDITS_RE = re.compile(r"\s+\d{1,2}(?:\s*-\s*\d{1,2})?\s*$")
TRUNCATED_OR_RE = re.compile(r"\bOR\s+([A-Z]{2,8})\s*$", re.I)
# Catalog tables insert credit counts mid-sentence: "OR 4-6 MATH 1024", "OR 6 [COMP 4910]".
STRAY_CREDITS_RE = re.compile(
    r"(?<!\d)(\d{1,2}(?:\s*-\s*\d{1,2})?)\s+(?=(?:OR|AND)\s|\[|\(|[A-Z]{2,8}\s+\d{4})"
)

# Official 2026-27 catalog (ugadmin COMP / COSC program sheets). Scraped names stop at a wrap.
COMP_ELECTIVES_RULE = (
    "COMP Electives (5 courses from the specified elective list, of which at least "
    "3 courses should be taken from 1 area and at least 2 courses outside that area "
    "(including course(s) in the Courses Without Associated Area). Students may use "
    "at most one course under Deep Learning Applications (COMP 4471 and COMP 5215) "
    "to count towards this elective requirement.)"
)
COMP_2000_RULE = "COMP 2000-level or above Elective (Any course(s) of the subject and level as specified)"
COSC_2000_RULE = (
    "COMP 2000-level or above Electives [Any 6 courses of the subject and level as specified. "
    "For students who have taken the 6-credit course COMP 4981 or COMP 4981H to fulfill this "
    "elective requirement, the minimum number of courses required to satisfy this requirement "
    "may be reduced by one. With approval by the Dean or the Dean's designate, students may "
    "use up to 3 computer science related courses (9 credits) offered by non-CSE department(s) "
    "to count towards this requirement.]"
)
COMP_4900_NOTE = (
    "Students are required to take COMP 4900 for every regular term in which they are "
    "in residency at HKUST with major in COMP"
)
COSC_4900_NOTE = (
    "Students are required to take COMP 4900 for every regular term in which they are "
    "in residency at HKUST with major in COSC"
)
STATS_OR_CODES = {
    "ELEC2600",
    "ELEC2600H",
    "IEDA2520",
    "IEDA2540",
    "ISOM2500",
    "MATH2411",
    "MATH2421",
    "MATH2431",
}
# "IEDA 3-4 2540" or "IEDA 3-4 ISOM/MATH 2540" after a catalog credit/header wrap.
WRAPPED_COURSE_RE = re.compile(
    r"\b([A-Z]{2,8})(?:/[A-Z]{2,8})*\s+\d{1,2}(?:\s*-\s*\d{1,2})?"
    r"(?:\s+[A-Z]{2,8}(?:/[A-Z]{2,8})*)?\s+(\d{4}[A-Z]?)\b",
    re.I,
)


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
    """Keep expression notes first; do not alphabetize courses (catalog order)."""
    notes = [item for item in items if item.course_id is None]
    courses = [item for item in items if item.course_id is not None]
    return notes + courses


def _codes_in(text: str | None) -> list[str]:
    cleaned = re.sub(r"\bOR(?=[A-Z])", " ", text or "", flags=re.I)
    cleaned = re.sub(r"\bOR\b", " ", cleaned, flags=re.I)
    return [f"{subject.upper()}{number.upper()}" for subject, number in LOOSE_CODE_RE.findall(cleaned)]


def _subject(code: str) -> str:
    match = re.match(r"([A-Z]+)", code or "")
    return match.group(1) if match else ""


def _course_num(code: str) -> int:
    match = re.search(r"(\d{4})", code or "")
    return int(match.group(1)) if match else 9999


def _spaced_code(code: str) -> str:
    match = re.match(r"([A-Z]+)(\d{4}[A-Z]?)", code)
    return f"{match.group(1)} {match.group(2)}" if match else code


def _majority_subject(codes: list[str]) -> str | None:
    counts: dict[str, int] = {}
    for code in codes:
        subject = _subject(code)
        if subject:
            counts[subject] = counts.get(subject, 0) + 1
    if not counts:
        return None
    return max(counts, key=lambda subject: (counts[subject], subject))


def _node_codes(node: dict[str, Any]) -> list[str]:
    codes = [item["course_code"] for item in node.get("items", []) if item.get("course_code")]
    for child in node.get("children", []):
        codes.extend(_node_codes(child))
    return codes


def _is_expr_item(item: dict[str, Any]) -> bool:
    return not item.get("course_code") and bool(item.get("note"))


def _is_garbage_or_item(item: dict[str, Any]) -> bool:
    note = item.get("note") or ""
    compact = re.sub(r"\s+", "", note).upper()
    return compact.startswith("OR") and bool(_codes_in(note))


BARE_OR_NUMBER_RE = re.compile(
    r"\b([A-Z]{2,8})\s+\d{4}[A-Z]?(?:\s+OR\s+[A-Z]{2,8}\s+\d{4}[A-Z]?)*\s+OR\s+(\d{4}[A-Z]?)\b",
    re.I,
)


def _normalize_wrapped_or_text(text: str | None) -> str:
    cleaned = WRAPPED_COURSE_RE.sub(lambda match: f"{match.group(1).upper()} {match.group(2).upper()}", text or "")
    while True:
        next_text = BARE_OR_NUMBER_RE.sub(
            lambda match: f"{match.group(0).rsplit('OR', 1)[0]}OR {match.group(1).upper()} {match.group(2).upper()}",
            cleaned,
            count=1,
        )
        if next_text == cleaned:
            return cleaned
        cleaned = next_text


def _truncated_or_subject(note: str | None) -> str | None:
    cleaned = TRAILING_CREDITS_RE.sub("", _normalize_wrapped_or_text(note).strip())
    match = TRUNCATED_OR_RE.search(cleaned)
    return match.group(1).upper() if match else None


def _group_codes(node: dict[str, Any]) -> set[str]:
    codes = set(_codes_in(_or_expression(node)))
    for item in node.get("items") or []:
        if item.get("course_code"):
            codes.add(item["course_code"])
    return codes


def _looks_like_stats_or(child: dict[str, Any]) -> bool:
    return bool(_group_codes(child) & {"ELEC2600", "ELEC2600H", "IEDA2520"})


def _or_expression(child: dict[str, Any]) -> str:
    for item in child.get("items", []):
        if _is_expr_item(item) and "OR" in (item.get("note") or "").upper():
            return item["note"]
    return child.get("name") or ""


def _order_or_items(items: list[dict[str, Any]], expr: str) -> list[dict[str, Any]]:
    rank = {code: index for index, code in enumerate(_codes_in(expr))}
    notes = [item for item in items if not item.get("course_code")]
    courses = [item for item in items if item.get("course_code")]
    courses.sort(
        key=lambda item: rank.get(
            item["course_code"],
            1000 + _course_num(item["course_code"]),
        )
    )
    return notes + courses


def _repair_truncated_or_groups(group: dict[str, Any]) -> None:
    """Rejoin OR lists split by a catalog line wrap (e.g. 'OR IEDA 3-4' / '2540')."""
    for child in group.get("children", []):
        _repair_truncated_or_groups(child)

    items = list(group.get("items") or [])
    for child in group.get("children") or []:
        if child.get("kind") != "or_group":
            continue
        expr = _normalize_wrapped_or_text(_or_expression(child))
        subject = _truncated_or_subject(expr)
        stats_or = _looks_like_stats_or(child)
        if not subject and not stats_or:
            continue

        extra_codes = []
        for item in child.get("items", []):
            if _is_garbage_or_item(item):
                extra_codes.extend(_codes_in(item.get("note")))
        absorb_subjects = ({subject} if subject else set()) | {_subject(code) for code in extra_codes}
        absorb_codes = STATS_OR_CODES if stats_or else set()

        absorbed: list[dict[str, Any]] = []
        kept: list[dict[str, Any]] = []
        for item in items:
            code = item.get("course_code")
            if code and (code in absorb_codes or (_subject(code) in absorb_subjects and absorb_subjects)):
                absorbed.append(item)
            else:
                kept.append(item)
        items = kept

        child["items"] = [item for item in child.get("items", []) if not _is_garbage_or_item(item)]
        existing = {item.get("course_code") for item in child["items"] if item.get("course_code")}
        for item in absorbed:
            code = item.get("course_code")
            if code and code not in existing:
                child["items"].append(item)
                existing.add(code)

        codes = [item["course_code"] for item in child["items"] if item.get("course_code")]
        codes.sort(key=lambda code: (_subject(code), _course_num(code), code))
        rebuilt = " OR ".join(_spaced_code(code) for code in codes)
        if rebuilt:
            for item in child["items"]:
                if _is_expr_item(item):
                    item["note"] = rebuilt
                    break
            else:
                child["items"].insert(0, {"course_code": None, "note": rebuilt})
            child["name"] = rebuilt
        child["items"] = _order_or_items(child["items"], rebuilt or expr)

    group["items"] = items


def _assign_sort_index(group: dict[str, Any]) -> None:
    children = group.get("children") or []
    items = group.get("items") or []
    for child in children:
        _assign_sort_index(child)

    if group.get("kind") == "electives":
        children.sort(
            key=lambda child: (
                KIND_ORDER.get(child.get("kind"), 50),
                AREA_ORDER.get(child.get("name") or "", 50),
                child.get("name") or "",
            )
        )
        for index, child in enumerate(children):
            child["sort_index"] = index
        for index, item in enumerate(items):
            item["sort_index"] = index
        group["children"] = children
        return

    if group.get("kind") != "required":
        for index, item in enumerate(items):
            item["sort_index"] = index
        for index, child in enumerate(children):
            child["sort_index"] = 100 + index
        return

    codes = [item["course_code"] for item in items if item.get("course_code")]
    for child in children:
        codes.extend(_node_codes(child))
    home = _majority_subject(codes)

    def rank(codes: list[str]) -> tuple[int, int]:
        if not codes:
            return (2, 9999)
        home_codes = [code for code in codes if _subject(code) == home] if home else codes
        if home_codes:
            return (0, min(_course_num(code) for code in home_codes))
        return (1, min(_course_num(code) for code in codes))

    ranked: list[tuple[tuple[int, int], dict[str, Any]]] = []
    for item in items:
        ranked.append((rank([item["course_code"]] if item.get("course_code") else []), item))
    for child in children:
        ranked.append((rank(_node_codes(child)), child))
    ranked.sort(key=lambda row: row[0])
    for index, (_key, obj) in enumerate(ranked):
        obj["sort_index"] = index


def _clean_catalog_text(text: str | None) -> str:
    cleaned = _normalize_wrapped_or_text(text)
    cleaned = STRAY_CREDITS_RE.sub("", cleaned)
    cleaned = TRAILING_CREDITS_RE.sub("", cleaned.strip())
    cleaned = re.sub(r"\bevery 0 regular\b", "every regular", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    if cleaned == "Courses Without Associated":
        return "Courses Without Associated Area"
    return cleaned


def _is_cosc_2000(text: str, program_code: str | None = None) -> bool:
    lower = text.lower()
    return (
        "any 6 course" in lower
        or "non-cse" in lower
        or "electives [" in lower
        or ("4981" in lower and "2000-level" in lower)
        or ((program_code or "").upper() == "COSC" and "2000-level or above" in lower)
    )


def _completed_rule(text: str | None, program_code: str | None = None) -> str | None:
    raw = re.sub(r"\s+", " ", text or "").strip()
    if not raw:
        return None
    lower = raw.lower()
    if _is_cosc_2000(raw, program_code):
        return COSC_2000_RULE
    if "specified elective list" in lower or lower.startswith("comp electives"):
        return COMP_ELECTIVES_RULE
    if "2000-level or above" in lower:
        return COMP_2000_RULE
    if "take comp 4900" in lower:
        if "cosc" in lower or (program_code or "").upper() == "COSC":
            return COSC_4900_NOTE
        return COMP_4900_NOTE
    return None


def _sanitize_credits(group: dict[str, Any]) -> None:
    credits = group.get("min_credits")
    if credits is not None and (credits <= 0 or credits >= 100):
        group["min_credits"] = None
    for child in group.get("children") or []:
        _sanitize_credits(child)


def _repair_catalog_labels(group: dict[str, Any], program_code: str | None = None) -> None:
    """Restore official catalog wording and drop leftover duplicate notes."""
    original_name = group.get("name") or ""
    official = _completed_rule(original_name, program_code)
    group["name"] = official or _clean_catalog_text(original_name)

    child_titles = set()
    for child in group.get("children") or []:
        _repair_catalog_labels(child, program_code)
        child_titles.add(child.get("name") or "")

    kept: list[dict[str, Any]] = []
    for item in group.get("items") or []:
        if item.get("course_code"):
            note = item.get("note")
            official_note = _completed_rule(note, program_code)
            item["note"] = official_note or _clean_catalog_text(note)
            kept.append(item)
            continue
        raw_note = item.get("note") or ""
        official_note = _completed_rule(raw_note, program_code)
        note = official_note or _clean_catalog_text(raw_note)
        if note == group.get("name") or note in child_titles:
            continue
        item["note"] = note
        kept.append(item)
    group["items"] = kept


def _build_tree(groups: list[RequirementGroup], program_code: str | None = None) -> list[dict[str, Any]]:
    by_parent: dict[Any, list[RequirementGroup]] = {}
    for group in groups:
        by_parent.setdefault(group.parent_id, []).append(group)
    for siblings in by_parent.values():
        siblings.sort(key=lambda group: KIND_ORDER.get(group.kind, 50))

    def node(group: RequirementGroup) -> dict[str, Any]:
        return {
            "name": group.name,
            "kind": group.kind,
            "min_credits": float(group.min_credits) if group.min_credits is not None else None,
            "items": [_item_payload(item) for item in _sort_items(list(group.items))],
            "children": [node(child) for child in by_parent.get(group.id, [])],
        }

    roots = [node(group) for group in by_parent.get(None, [])]
    for root in roots:
        _repair_truncated_or_groups(root)
        _repair_catalog_labels(root, program_code)
        _sanitize_credits(root)
        _assign_sort_index(root)
    roots.sort(key=lambda group: KIND_ORDER.get(group.get("kind"), 50))
    return roots


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


def program_version_for_intake(db: Session, program: Program, intake_year: int | None = None) -> ProgramVersion | None:
    version, _year = load_program_version(db, program, intake_year)
    return version



def academic_year_for_intake(db: Session, intake_year: int | None) -> AcademicYear | None:
    if intake_year is None:
        return db.scalar(select(AcademicYear).order_by(AcademicYear.start_year.desc()))
    return db.scalar(select(AcademicYear).where(AcademicYear.start_year == intake_year))


def catalog_year_code(intake_year: int | None) -> str | None:
    if intake_year is None:
        return None
    return f"{intake_year}-{str(intake_year + 1)[-2:]}"


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
    "bien minor": ["MINOR-BIEN"],
    "minor in bien": ["MINOR-BIEN"],
    "minor in bioengineering": ["MINOR-BIEN"],
    "bioengineering minor": ["MINOR-BIEN"],
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


def load_requirement_tree(db: Session, version_id: Any, program_code: str | None = None) -> list[dict[str, Any]]:
    groups = (
        db.scalars(
            select(RequirementGroup)
            .where(RequirementGroup.program_version_id == version_id)
            .options(selectinload(RequirementGroup.items).joinedload(RequirementItem.course))
        )
        .unique()
        .all()
    )
    return _build_tree(list(groups), program_code)


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
            "requirements": load_requirement_tree(db, version.id, program.code),
        }

    payload = cached(key, _build)
    if "error" in payload:
        forget(key)
    return payload
