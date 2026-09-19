"""Read/write operations against the planner schema.

This is the one place that mutates a student's plan. The advisor's tools and
the plain REST /api/plan endpoints both call into these functions, so nothing
the agent does bypasses the app's own rules.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    ClassSection,
    Course,
    CourseOffering,
    Planner,
    StudentClassSelection,
    StudentCourse,
    Term,
)
from app.services.catalog_queries import _section_kind

_SECTION_OPTIONS = (
    selectinload(ClassSection.meetings),
    joinedload(ClassSection.offering).joinedload(CourseOffering.course),
    joinedload(ClassSection.offering).joinedload(CourseOffering.term),
)

_PLANNER_PK: dict[str, UUID] = {}
_KEEP_COURSE_STATUSES = {"completed", "done", "exempt", "transferred"}
_HOLD_STATUSES = _KEEP_COURSE_STATUSES | {"in_progress", "planned"}


def _held_course_codes(db: Session, planner: Planner, ignore: set[str] | None = None) -> set[str]:
    skipped = {code.replace(" ", "").upper() for code in (ignore or set())}
    rows = db.execute(
        select(Course.course_code)
        .join(StudentCourse, StudentCourse.course_id == Course.id)
        .where(StudentCourse.planner_id == planner.id, StudentCourse.status.in_(_HOLD_STATUSES))
    ).scalars().all()
    return {code for code in rows if code.replace(" ", "").upper() not in skipped}


def _replace_ignore_codes(db: Session, planner: Planner, course_code: str | None) -> set[str]:
    if not course_code:
        return set()
    course = find_course(db, course_code)
    if course is None:
        return set()
    rows = db.scalars(
        select(StudentCourse).where(
            StudentCourse.planner_id == planner.id,
            StudentCourse.course_id == course.id,
        )
    ).all()
    if any(row.status in _KEEP_COURSE_STATUSES for row in rows):
        return set()
    return {course.course_code}


def _exclusion_error(
    db: Session,
    planner: Planner,
    course_code: str,
    ignore: set[str] | None = None,
) -> dict[str, Any] | None:
    from app.services.catalog_queries import exclusion_blockers, pretty_course_code

    blockers = exclusion_blockers(db, course_code, _held_course_codes(db, planner, ignore))
    if not blockers:
        return None
    pretty = pretty_course_code(course_code)
    listed = ", ".join(pretty_course_code(code) for code in blockers)
    return {"error": f"{pretty} is excluded because you already took {listed}."}


def get_or_create_planner(db: Session, planner_id: str) -> Planner:
    cached = _PLANNER_PK.get(planner_id)
    if cached is not None:
        planner = db.get(Planner, cached)
        if planner is not None and planner.planner_id == planner_id:
            return planner
        _PLANNER_PK.pop(planner_id, None)
    planner = db.scalar(select(Planner).where(Planner.planner_id == planner_id))
    if planner is None:
        planner = Planner(planner_id=planner_id)
        db.add(planner)
        db.commit()
        db.refresh(planner)
    _PLANNER_PK[planner_id] = planner.id
    return planner


def find_course(db: Session, course_code: str) -> Course | None:
    code = course_code.strip().replace(" ", "").upper()
    return db.scalar(select(Course).where(Course.course_code == code))


def find_section(
    db: Session,
    course: Course,
    section_code: str,
    term_code: str | None = None,
) -> ClassSection | None:
    stmt = (
        select(ClassSection)
        .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
        .options(*_SECTION_OPTIONS)
        .where(
            CourseOffering.course_id == course.id,
            ClassSection.section_code == section_code.strip().upper(),
        )
    )
    if term_code:
        stmt = stmt.join(Term, CourseOffering.term_id == Term.id).where(Term.code == term_code)
    return db.scalars(stmt).unique().first()


def _load_course_sections(
    db: Session,
    course: Course,
    term_code: str | None = None,
) -> list[ClassSection]:
    stmt = (
        select(ClassSection)
        .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
        .options(*_SECTION_OPTIONS)
        .where(CourseOffering.course_id == course.id)
    )
    if term_code:
        stmt = stmt.join(Term, CourseOffering.term_id == Term.id).where(Term.code == term_code)
    return list(db.scalars(stmt).unique())


def _selected_section_ids(db: Session, planner: Planner) -> set:
    return set(
        db.scalars(select(StudentClassSelection.section_id).where(StudentClassSelection.planner_id == planner.id)).all()
    )


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


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        loaded = json.loads(value)
        return loaded if isinstance(loaded, list) else []
    return list(value)


def _upsert_timetable_course(
    db: Session,
    planner: Planner,
    course: Course,
    term_id: UUID | None,
) -> None:
    """Keep degree-plan rows in sync when a section is saved on the timetable."""
    rows = list(
        db.scalars(
            select(StudentCourse).where(
                StudentCourse.planner_id == planner.id,
                StudentCourse.course_id == course.id,
            )
        ).all()
    )
    if any(row.status in _KEEP_COURSE_STATUSES for row in rows):
        return
    match = next((row for row in rows if row.term_id == term_id), None) or (rows[0] if rows else None)
    if match is None:
        db.add(
            StudentCourse(
                planner_id=planner.id,
                course_id=course.id,
                term_id=term_id,
                status="in_progress",
            )
        )
        return
    match.status = "in_progress"
    if term_id is not None and match.term_id is None:
        match.term_id = term_id


def resolve_plan(db: Session, planner_id: str) -> dict[str, Any]:
    pk = get_or_create_planner(db, planner_id).id
    # One round-trip: planned courses + selected sections with meetings.
    row = db.execute(
        text(
            """
            SELECT
              COALESCE((
                SELECT json_agg(json_build_object(
                  'course_code', c.course_code,
                  'term_label', t.label,
                  'status', sc.status
                ))
                FROM planner.student_course sc
                LEFT JOIN catalog.course c ON c.id = sc.course_id
                LEFT JOIN catalog.term t ON t.id = sc.term_id
                WHERE sc.planner_id = :pid
              ), '[]'::json) AS planned_courses,
              COALESCE((
                SELECT json_agg(section)
                FROM (
                  SELECT json_build_object(
                    'section_id', cs.id::text,
                    'course_code', c.course_code,
                    'section_code', cs.section_code,
                    'term_code', t.code,
                    'term_label', t.label,
                    'instructor', cs.instructor,
                    'meetings', COALESCE(
                      json_agg(
                        json_build_object(
                          'weekday', m.weekday,
                          'start_time', to_char(m.start_time, 'HH24:MI:SS'),
                          'end_time', to_char(m.end_time, 'HH24:MI:SS'),
                          'start_date', m.start_date,
                          'end_date', m.end_date,
                          'venue', COALESCE(m.venue, '')
                        )
                      ) FILTER (WHERE m.id IS NOT NULL),
                      '[]'::json
                    )
                  ) AS section
                  FROM planner.student_class_selection sel
                  JOIN catalog.class_section cs ON cs.id = sel.section_id
                  JOIN catalog.course_offering o ON o.id = cs.offering_id
                  JOIN catalog.course c ON c.id = o.course_id
                  JOIN catalog.term t ON t.id = o.term_id
                  LEFT JOIN catalog.meeting m ON m.section_id = cs.id
                  WHERE sel.planner_id = :pid
                  GROUP BY cs.id, c.course_code, cs.section_code, t.code, t.label, cs.instructor
                ) sections
              ), '[]'::json) AS class_selections
            """
        ),
        {"pid": pk},
    ).mappings().one()
    return {
        "planner_id": planner_id,
        "planned_courses": _as_list(row["planned_courses"]),
        "class_selections": _as_list(row["class_selections"]),
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

    rows = list(
        db.scalars(
            select(StudentCourse).where(
                StudentCourse.planner_id == planner.id,
                StudentCourse.course_id == course.id,
            )
        ).all()
    )
    kept = next((row for row in rows if row.status in _KEEP_COURSE_STATUSES), None)
    if kept is not None:
        return {"ok": True, "course_code": course.course_code, "status": kept.status}
    if not rows:
        blocked = _exclusion_error(db, planner, course.course_code)
        if blocked:
            return blocked
        db.add(StudentCourse(planner_id=planner.id, course_id=course.id, status=status))
        stored = status
    else:
        existing = next((row for row in rows if row.term_id is None), rows[0])
        existing.status = status
        stored = status
    db.commit()
    return {"ok": True, "course_code": course.course_code, "status": stored}


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


def _compact_code(code: str | None) -> str:
    return (code or "").replace(" ", "").upper()


def _selection_rows(
    db: Session,
    planner: Planner,
    course: Course,
) -> list[tuple[StudentClassSelection, ClassSection]]:
    return list(
        db.execute(
            select(StudentClassSelection, ClassSection)
            .join(ClassSection, StudentClassSelection.section_id == ClassSection.id)
            .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
            .where(
                StudentClassSelection.planner_id == planner.id,
                CourseOffering.course_id == course.id,
            )
        ).all()
    )


def _drop_idle_timetable_course(db: Session, planner: Planner, course: Course) -> None:
    """Remove in-progress/planned degree rows once no section of the course remains."""
    remaining = db.scalar(
        select(StudentClassSelection.id)
        .join(ClassSection, StudentClassSelection.section_id == ClassSection.id)
        .join(CourseOffering, ClassSection.offering_id == CourseOffering.id)
        .where(
            StudentClassSelection.planner_id == planner.id,
            CourseOffering.course_id == course.id,
        )
        .limit(1)
    )
    if remaining is not None:
        return
    rows = list(
        db.scalars(
            select(StudentCourse).where(
                StudentCourse.planner_id == planner.id,
                StudentCourse.course_id == course.id,
            )
        ).all()
    )
    for row in rows:
        if row.status in _KEEP_COURSE_STATUSES:
            continue
        db.delete(row)


def _outgoing_for_replace(
    db: Session,
    planner: Planner,
    new_course: Course,
    new_section: ClassSection,
    replaces_course_code: str | None = None,
    replaces_section_code: str | None = None,
) -> tuple[list[StudentClassSelection], Course | None, str | None]:
    """Sections that should leave the calendar when this add is a replacement.

    A different course always comes off as a whole (lecture + tutorial + lab).
    The same course drops the matching kind, and follow-on tutorials/labs when
    the lecture changes — even if the model only named one section.
    """
    explicit = _compact_code(replaces_course_code)
    old_course = find_course(db, explicit) if explicit else new_course
    if old_course is None:
        return [], None, None

    pairs = _selection_rows(db, planner, old_course)
    new_kind, _ = _section_kind(new_section.section_code)
    different = old_course.id != new_course.id
    if different:
        return [row for row, _sec in pairs], old_course, None

    want_section = (replaces_section_code or "").strip().upper() or None
    drop: list[StudentClassSelection] = []
    dropped_section: str | None = None
    replacing_lecture = False
    for row, section in pairs:
        if section.id == new_section.id:
            continue
        kind, _ = _section_kind(section.section_code)
        if want_section:
            if section.section_code.upper() != want_section:
                continue
        elif kind != new_kind:
            continue
        drop.append(row)
        dropped_section = dropped_section or section.section_code
        replacing_lecture = replacing_lecture or kind == "lecture"

    if not drop and not (explicit or want_section):
        return [], None, None

    if replacing_lecture:
        for row, section in pairs:
            kind, _ = _section_kind(section.section_code)
            if kind in {"tutorial", "lab"} and row not in drop:
                drop.append(row)

    if not drop:
        return [], old_course if explicit else None, None
    echo_section = None if different or replacing_lecture else dropped_section
    return drop, old_course, echo_section


def _section_action_payload(
    course: Course,
    section: ClassSection,
    conflicts: list[dict[str, Any]],
    *,
    proposed: bool = False,
    replaces_course_code: str | None = None,
    replaces_section_code: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": True,
        "course_code": course.course_code,
        "section_code": section.section_code,
        "term_code": section.offering.term.code,
        "meetings": [_meeting_dict(m) for m in section.meetings],
        "conflicts": conflicts,
    }
    if proposed:
        payload.pop("ok", None)
        payload["proposed"] = True
    if replaces_course_code:
        payload["replaces_course_code"] = replaces_course_code
        if replaces_section_code:
            payload["replaces_section_code"] = replaces_section_code
    return payload


def add_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    term_code: str | None = None,
    replaces_course_code: str | None = None,
    replaces_section_code: str | None = None,
) -> dict[str, Any]:
    return _write_class_selection(
        db,
        planner_id,
        course_code,
        section_code,
        term_code,
        replaces_course_code,
        replaces_section_code,
        proposed=False,
    )


def preview_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    term_code: str | None = None,
    replaces_course_code: str | None = None,
    replaces_section_code: str | None = None,
) -> dict[str, Any]:
    """Same lookup and conflict-check as add_class_selection, but writes nothing."""
    return _write_class_selection(
        db,
        planner_id,
        course_code,
        section_code,
        term_code,
        replaces_course_code,
        replaces_section_code,
        proposed=True,
    )


def preview_replace_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    replaces_course_code: str,
    replaces_section_code: str | None = None,
    term_code: str | None = None,
) -> dict[str, Any]:
    return preview_class_selection(
        db, planner_id, course_code, section_code, term_code, replaces_course_code, replaces_section_code
    )


def replace_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    replaces_course_code: str,
    replaces_section_code: str | None = None,
    term_code: str | None = None,
) -> dict[str, Any]:
    """Drop the original course (or one section) and add the new section in one commit."""
    return add_class_selection(
        db, planner_id, course_code, section_code, term_code, replaces_course_code, replaces_section_code
    )


def _write_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    section_code: str,
    term_code: str | None,
    replaces_course_code: str | None,
    replaces_section_code: str | None,
    *,
    proposed: bool,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    section = find_section(db, course, section_code, term_code)
    if section is None:
        where = f" in term {term_code}" if term_code else ""
        return {"error": f"No section {section_code} found for {course.course_code}{where}"}

    outgoing, old_course, echo_section = _outgoing_for_replace(
        db, planner, course, section, replaces_course_code, replaces_section_code
    )
    ignore = _replace_ignore_codes(db, planner, old_course.course_code) if old_course else set()
    blocked = _exclusion_error(db, planner, course.course_code, ignore=ignore)
    if blocked:
        return blocked

    from app.services.conflicts import conflicts_with_candidate  # local import breaks the module cycle

    conflicts = conflicts_with_candidate(
        db, planner_id, section, exclude_section_ids={row.section_id for row in outgoing}
    )
    payload = _section_action_payload(
        course,
        section,
        conflicts,
        proposed=proposed,
        replaces_course_code=old_course.course_code if old_course else None,
        replaces_section_code=echo_section,
    )
    if proposed:
        return payload

    for row in outgoing:
        db.delete(row)
    db.flush()
    if old_course is not None:
        _drop_idle_timetable_course(db, planner, old_course)

    existing = db.scalar(
        select(StudentClassSelection).where(
            StudentClassSelection.planner_id == planner.id,
            StudentClassSelection.section_id == section.id,
        )
    )
    if existing is None:
        db.add(StudentClassSelection(planner_id=planner.id, section_id=section.id))
    _upsert_timetable_course(db, planner, course, section.offering.term_id)
    db.commit()

    payload["ok"] = True
    payload["plan"] = resolve_plan(db, planner_id)
    return payload


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
        stmt = stmt.where(ClassSection.section_code == section_code.strip().upper())

    rows = db.scalars(stmt).all()
    for row in rows:
        db.delete(row)
    db.flush()
    _drop_idle_timetable_course(db, planner, course)
    db.commit()
    return {"ok": True, "removed": len(rows), "plan": resolve_plan(db, planner_id)}


def add_class_selections(
    db: Session,
    planner_id: str,
    course_code: str,
    section_codes: list[str],
    term_code: str | None = None,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    codes = [c.strip().upper() for c in section_codes if c.strip()]
    if not codes:
        return {"error": "No sections to add"}

    blocked = _exclusion_error(db, planner, course.course_code)
    if blocked:
        return blocked

    sections = _load_course_sections(db, course, term_code)
    by_code = {s.section_code.upper(): s for s in sections}
    existing_ids = _selected_section_ids(db, planner)

    from app.services.conflicts import selected_sections, sections_conflict

    current = selected_sections(db, planner_id, planner=planner)
    added: list[ClassSection] = []
    conflicts: list[dict[str, Any]] = []
    for code in codes:
        section = by_code.get(code)
        if section is None:
            where = f" in term {term_code}" if term_code else ""
            return {"error": f"No section {code} found for {course.course_code}{where}"}
        if section.id in existing_ids:
            continue
        for other in current + added:
            conflicts += sections_conflict(other, section)
        added.append(section)
        existing_ids.add(section.id)

    first = by_code[codes[0]]
    for section in added:
        db.add(StudentClassSelection(planner_id=planner.id, section_id=section.id))
    _upsert_timetable_course(db, planner, course, first.offering.term_id)
    db.commit()

    return {
        "ok": True,
        "course_code": course.course_code,
        "section_code": first.section_code,
        "term_code": first.offering.term.code,
        "meetings": [_meeting_dict(m) for m in first.meetings],
        "conflicts": conflicts,
        "plan": resolve_plan(db, planner_id),
    }


def swap_class_selection(
    db: Session,
    planner_id: str,
    course_code: str,
    from_section: str,
    to_section: str,
    term_code: str | None = None,
    also_sections: list[str] | None = None,
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    course = find_course(db, course_code)
    if course is None:
        return {"error": f"No course with code {course_code}"}

    sections = _load_course_sections(db, course, term_code)
    by_code = {s.section_code.upper(): s for s in sections}
    src = by_code.get(from_section.strip().upper())
    dst = by_code.get(to_section.strip().upper())
    if dst is None:
        where = f" in term {term_code}" if term_code else ""
        return {"error": f"No section {to_section} found for {course.course_code}{where}"}

    extras: list[ClassSection] = []
    for code in also_sections or []:
        extra = by_code.get(code.strip().upper())
        if extra is None:
            where = f" in term {term_code}" if term_code else ""
            return {"error": f"No section {code} found for {course.course_code}{where}"}
        extras.append(extra)

    drop_ids = {src.id} if src is not None else set()
    add_ids = {dst.id, *(extra.id for extra in extras)}
    selected_ids = _selected_section_ids(db, planner)

    if src is not None:
        src_kind, _src_num = _section_kind(src.section_code)
        dst_kind, _dst_num = _section_kind(dst.section_code)
        if src_kind == "lecture" and dst_kind == "lecture":
            for section in sections:
                kind_s, _number = _section_kind(section.section_code)
                if kind_s in {"tutorial", "lab"} and section.id in selected_ids:
                    drop_ids.add(section.id)

    on_plan = selected_ids
    if drop_ids:
        rows = db.scalars(
            select(StudentClassSelection).where(
                StudentClassSelection.planner_id == planner.id,
                StudentClassSelection.section_id.in_(drop_ids),
            )
        ).all()
        for row in rows:
            db.delete(row)

    for section_id in add_ids - (on_plan - drop_ids):
        db.add(StudentClassSelection(planner_id=planner.id, section_id=section_id))
    _upsert_timetable_course(db, planner, course, dst.offering.term_id)

    db.commit()
    return {
        "ok": True,
        "course_code": course.course_code,
        "section_code": dst.section_code,
        "term_code": dst.offering.term.code,
        "meetings": [_meeting_dict(m) for m in dst.meetings],
        "conflicts": [],
        "plan": resolve_plan(db, planner_id),
    }


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
