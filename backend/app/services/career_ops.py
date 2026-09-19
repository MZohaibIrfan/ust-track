"""Career page: experience tracking, and matching a pasted job description
against the catalog's own course descriptions.

Matching is deterministic keyword overlap, not an LLM call — every course
description is already in Postgres (catalog.course_version.description), so
there's no need to guess at course content from general knowledge. This
mirrors the rest of the app: the engine decides what counts, an agent (if any)
only explains the result.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, CourseVersion, StudentExperience
from app.services.degree_ops import find_program, get_student_profile, planner_intake_year, requirement_course_codes
from app.services.planner_ops import get_or_create_planner

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "as",
    "is", "are", "was", "were", "be", "been", "being", "at", "by", "from", "this", "that",
    "these", "those", "it", "its", "we", "you", "your", "our", "will", "shall", "can",
    "have", "has", "had", "do", "does", "did", "not", "no", "into", "than", "then",
    "over", "such", "so", "if", "about", "using", "use", "used", "etc", "years",
    "experience", "job", "role", "work", "working", "candidate", "team", "ability",
    "strong", "excellent", "preferred", "required", "requirements", "responsibilities",
    "skills", "skill", "knowledge", "including", "including", "must", "plus", "looking",
    "who", "what", "which", "their", "they", "them", "per", "up", "out", "all", "any",
    "need", "needs", "needed", "comfortable", "good", "great", "well", "able", "helpful",
    "familiar", "familiarity", "understanding", "years", "year", "etc", "like", "also",
}

_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+#]*(?:[.+#][a-zA-Z0-9]+)*")


def _keywords(text: str) -> set[str]:
    words = {w.lower() for w in _WORD_RE.findall(text)}
    return {w for w in words if w not in STOPWORDS and len(w) > 2}


def list_experiences(db: Session, planner_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(
        select(StudentExperience)
        .where(StudentExperience.planner_id == planner.id)
        .order_by(StudentExperience.start_date.desc().nulls_last(), StudentExperience.created_at.desc())
    ).all()
    return {
        "experiences": [
            {
                "id": str(row.id),
                "title": row.title,
                "organization": row.organization,
                "kind": row.kind,
                "start_date": row.start_date.isoformat() if row.start_date else None,
                "end_date": row.end_date.isoformat() if row.end_date else None,
                "description": row.description,
            }
            for row in rows
        ]
    }


def add_experience(
    db: Session,
    planner_id: str,
    title: str,
    organization: str = "",
    kind: str = "internship",
    start_date: str | None = None,
    end_date: str | None = None,
    description: str = "",
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    row = StudentExperience(
        planner_id=planner.id,
        title=title.strip(),
        organization=organization.strip(),
        kind=kind,
        start_date=start_date or None,
        end_date=end_date or None,
        description=description.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": str(row.id)}


def remove_experience(db: Session, planner_id: str, experience_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    removed = (
        db.query(StudentExperience)
        .filter(StudentExperience.planner_id == planner.id, StudentExperience.id == UUID(experience_id))
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed > 0}


def recommend_courses_for_job(
    db: Session,
    planner_id: str,
    job_description: str,
    limit: int = 8,
) -> dict[str, Any]:
    keywords = _keywords(job_description)
    if not keywords:
        return {"matched_keywords": [], "already_relevant": [], "recommended": [], "error": "Paste a longer job description."}

    profile = get_student_profile(db, planner_id)
    intake_year = profile.get("intake_year")
    completed_codes = {c["course_code"] for c in profile["courses"] if c["course_code"] and c["status"] == "completed"}
    taken_codes = {c["course_code"] for c in profile["courses"] if c["course_code"]}

    major = next((d for d in profile["declared_programs"] if d["role"] == "major"), None)
    major_codes: set[str] = set()
    if major and major["code"]:
        major_program = find_program(db, major["code"])
        if major_program is not None:
            intake = planner_intake_year(db, planner_id)
            major_codes = requirement_course_codes(db, major_program, intake)

    scored: list[dict[str, Any]] = []
    for course, version in db.execute(
        select(Course, CourseVersion).join(CourseVersion, CourseVersion.course_id == Course.id)
    ).all():
        title_hits = keywords & _keywords(version.title)
        desc_hits = keywords & _keywords(version.description)
        hits = title_hits | desc_hits
        if not hits:
            continue
        score = len(title_hits) * 3 + len(desc_hits)
        if course.course_code in major_codes:
            score += 2
        scored.append(
            {
                "course_code": course.course_code,
                "title": version.title,
                "credits": float(version.credits),
                "matched_terms": sorted(hits)[:10],
                "score": score,
                "in_major": course.course_code in major_codes,
                "status": "completed" if course.course_code in completed_codes else None,
            }
        )

    # Keep the best-scoring course_version per course (versions repeat per catalog year).
    best_by_code: dict[str, dict[str, Any]] = {}
    for row in scored:
        existing = best_by_code.get(row["course_code"])
        if existing is None or row["score"] > existing["score"]:
            best_by_code[row["course_code"]] = row

    already_relevant = sorted(
        (row for row in best_by_code.values() if row["course_code"] in taken_codes),
        key=lambda r: -r["score"],
    )
    recommended = sorted(
        (row for row in best_by_code.values() if row["course_code"] not in taken_codes),
        key=lambda r: (-r["in_major"], -r["score"], r["course_code"]),
    )[:limit]

    return {
        "matched_keywords": sorted(keywords)[:30],
        "major": major["code"] if major else None,
        "already_relevant": already_relevant,
        "recommended": recommended,
    }


__all__ = [
    "list_experiences",
    "add_experience",
    "remove_experience",
    "recommend_courses_for_job",
]
