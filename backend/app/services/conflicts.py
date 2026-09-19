"""Meeting overlap detection across a planner's selected class sections.

Split into a low-level pair check (sections_conflict) and two callers: the
real plan (plan_conflicts) and a hypothetical addition that hasn't been
written yet (conflicts_with_candidate) — the latter is what lets the
timetable agent preview a suggestion's conflicts before anything is saved.
"""

from __future__ import annotations

from itertools import combinations
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import ClassSection, CourseOffering, Meeting, Planner, StudentClassSelection


def _overlaps(a: Meeting, b: Meeting) -> bool:
    if not a.weekday or a.weekday != b.weekday:
        return False
    if a.start_time is None or a.end_time is None or b.start_time is None or b.end_time is None:
        return False
    if a.start_time >= b.end_time or b.start_time >= a.end_time:
        return False
    if a.start_date and a.end_date and b.start_date and b.end_date:
        if a.start_date > b.end_date or b.start_date > a.end_date:
            return False
    return True


def sections_conflict(section_a: ClassSection, section_b: ClassSection) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for meeting_a in section_a.meetings:
        for meeting_b in section_b.meetings:
            if _overlaps(meeting_a, meeting_b):
                hits.append(
                    {
                        "a": section_a.offering.course.course_code,
                        "a_section": section_a.section_code,
                        "b": section_b.offering.course.course_code,
                        "b_section": section_b.section_code,
                        "weekday": meeting_a.weekday,
                    }
                )
    return hits


def selected_sections(
    db: Session,
    planner_id: str | None = None,
    *,
    planner: Planner | None = None,
) -> list[ClassSection]:
    from app.services.planner_ops import get_or_create_planner  # local import breaks the cycle

    if planner is None:
        if planner_id is None:
            return []
        planner = get_or_create_planner(db, planner_id)
    ids = db.scalars(
        select(StudentClassSelection.section_id).where(StudentClassSelection.planner_id == planner.id)
    ).all()
    if not ids:
        return []
    return list(
        db.scalars(
            select(ClassSection)
            .where(ClassSection.id.in_(ids))
            .options(
                selectinload(ClassSection.meetings),
                joinedload(ClassSection.offering).joinedload(CourseOffering.course),
            )
        ).unique()
    )


def plan_conflicts(db: Session, planner_id: str) -> list[dict[str, Any]]:
    sections = selected_sections(db, planner_id)
    conflicts: list[dict[str, Any]] = []
    for section_a, section_b in combinations(sections, 2):
        conflicts += sections_conflict(section_a, section_b)
    return conflicts


def conflicts_with_candidate(
    db: Session,
    planner_id: str,
    candidate: ClassSection,
    exclude_section_ids: set | None = None,
) -> list[dict[str, Any]]:
    """Conflicts a not-yet-saved section would have against what's already selected."""
    skip = exclude_section_ids or set()
    conflicts: list[dict[str, Any]] = []
    for existing in selected_sections(db, planner_id):
        if existing.id == candidate.id or existing.id in skip:
            continue
        conflicts += sections_conflict(existing, candidate)
    return conflicts
