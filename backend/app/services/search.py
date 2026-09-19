"""Course search by keyword against code or title.

Plain ILIKE for now — the pg_trgm/FTS indexes from the plan doc are a
performance detail for later, not a correctness requirement here.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import AcademicYear, Course, CourseVersion


def search_courses(db: Session, query: str, limit: int = 30) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []

    like_code = f"%{q}%"
    like_title = f"%{q}%"
    stmt = (
        select(Course, CourseVersion)
        .join(CourseVersion, CourseVersion.course_id == Course.id)
        .join(AcademicYear, CourseVersion.academic_year_id == AcademicYear.id)
        .where(or_(Course.course_code.ilike(like_code), CourseVersion.title.ilike(like_title)))
        .order_by(Course.course_code.asc(), AcademicYear.start_year.desc())
        .limit(limit * 3)
    )

    seen: dict[str, dict[str, Any]] = {}
    for course, version in db.execute(stmt).all():
        if course.course_code not in seen:
            seen[course.course_code] = {
                "course_code": course.course_code,
                "title": version.title,
                "credits": float(version.credits),
            }
    return list(seen.values())[:limit]
