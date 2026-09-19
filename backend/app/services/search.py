"""Course search by keyword against code or title."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import AcademicYear, Course, CourseVersion
from app.services.cache import cached

_CODE_PREFIX = re.compile(r"^[A-Z]{2,5}\d{0,4}[A-Z]?$")


def search_courses(db: Session, query: str, limit: int = 30) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []
    return cached(f"search:{q.casefold()}", lambda: _search(db, q, limit), ttl=60.0)


def _hits(rows: list[tuple[Course, CourseVersion]], limit: int) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for course, version in rows:
        if course.course_code not in seen:
            seen[course.course_code] = {
                "course_code": course.course_code,
                "title": version.title,
                "credits": float(version.credits),
            }
        if len(seen) >= limit:
            break
    return list(seen.values())


def _search(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    compact = query.replace(" ", "").upper()
    if _CODE_PREFIX.match(compact):
        stmt = (
            select(Course, CourseVersion)
            .join(CourseVersion, CourseVersion.course_id == Course.id)
            .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
            .where(Course.course_code.like(f"{compact}%"))
            .order_by(Course.course_code.asc(), AcademicYear.start_year.desc())
            .limit(limit * 3)
        )
        hits = _hits(list(db.execute(stmt).all()), limit)
        if hits:
            return hits

    like = f"%{query}%"
    stmt = (
        select(Course, CourseVersion)
        .join(CourseVersion, CourseVersion.course_id == Course.id)
        .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
        .where(or_(Course.course_code.ilike(like), CourseVersion.title.ilike(like)))
        .order_by(Course.course_code.asc(), AcademicYear.start_year.desc())
        .limit(limit * 3)
    )
    return _hits(list(db.execute(stmt).all()), limit)
