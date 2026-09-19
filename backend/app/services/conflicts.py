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
from sqlalchemy.orm import Session

from app.models import ClassSection, Meeting, StudentClassSelection


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


def selected_sections(db: Session, planner_id: str) -> list[ClassSection]:
    from app.services.planner_ops import get_or_create_planner  # local import breaks the cycle

    planner = get_or_create_planner(db, planner_id)
    selections = db.scalars(
        select(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id)
    ).all()
    sections: list[ClassSection] = []
    for selection in selections:
        section = db.get(ClassSection, selection.section_id)
        if section is not None:
            sections.append(section)
    return sections


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
) -> list[dict[str, Any]]:
    """Conflicts a not-yet-saved section would have against what's already selected."""
    conflicts: list[dict[str, Any]] = []
    for existing in selected_sections(db, planner_id):
        if existing.id == candidate.id:
            continue
        conflicts += sections_conflict(existing, candidate)
    return conflicts
