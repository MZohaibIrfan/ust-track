"""Career page: experience tracking, and matching a pasted job description
against the catalog's own course descriptions.

Matching is deterministic keyword overlap, not an LLM call — every course
description is already in Postgres (catalog.course_version.description), so
there's no need to guess at course content from general knowledge. This
mirrors the rest of the app: the engine decides what counts, an agent (if any)
only explains the result.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Course, CourseRule, CourseVersion, StudentExperience
from app.services.degree_ops import find_program, get_student_profile, planner_intake_year, requirement_course_codes
from app.services.planner_ops import get_or_create_planner

_PREREQ_CODE_RE = re.compile(r"\b([A-Z]{2,8})\s*(\d{4}[A-Z]?)\b")

# Off-department noise: a course with no keyword hits stronger than "generic
# filler word every thesis/capstone course happens to contain" shouldn't
# outrank a rare, specific match just because the filler word is common.
IN_MAJOR_MULTIPLIER = 1.6
SAME_SUBJECT_MULTIPLIER = 1.25
OFF_SUBJECT_MULTIPLIER = 0.35

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with", "as",
    "is", "are", "was", "were", "be", "been", "being", "at", "by", "from", "this", "that",
    "these", "those", "it", "its", "we", "you", "your", "our", "will", "shall", "can",
    "have", "has", "had", "do", "does", "did", "not", "no", "into", "than", "then",
    "over", "such", "so", "if", "about", "using", "use", "used", "etc", "years",
    "experience", "job", "role", "work", "working", "candidate", "team", "ability",
    "strong", "excellent", "preferred", "require", "required", "requirements", "responsibilities",
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


def _prereq_gap(db: Session, course_id: Any, completed_codes: set[str]) -> bool:
    """True if this course has a prereq rule and none of the codes it mentions
    are in the student's completed history. A heuristic, not a full boolean
    expression evaluator (that's a separate, harder parsing problem) — it's a
    hint for the agent to flag, not a hard filter."""
    rules = db.scalars(select(CourseRule).where(CourseRule.course_id == course_id, CourseRule.kind == "prereq")).all()
    if not rules:
        return False
    mentioned: set[str] = set()
    for rule in rules:
        mentioned |= {f"{m[0]}{m[1]}" for m in _PREREQ_CODE_RE.findall(rule.raw_text)}
    if not mentioned:
        return False
    return not (mentioned & completed_codes)


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
    major_subjects: set[str] = set()
    if major and major["code"]:
        major_program = find_program(db, major["code"])
        if major_program is not None:
            intake = planner_intake_year(db, planner_id)
            major_codes = requirement_course_codes(db, major_program, intake)
            # requirement_course_codes includes common-core/breadth electives —
            # dozens of subjects each contributing a course or two. Only count a
            # subject as "core" to the major when it's a real share of the
            # requirement tree, not a one-off breadth pick, or every department
            # in the university ends up looking like "the student's major".
            subject_counts: dict[str, int] = defaultdict(int)
            for code in major_codes:
                match = re.match(r"[A-Z]+", code)
                if match:
                    subject_counts[match.group()] += 1
            threshold = max(5, round(0.1 * len(major_codes)))
            major_subjects = {subject for subject, n in subject_counts.items() if n >= threshold}

    # Pass 1: collect every keyword hit per course, and how many distinct
    # courses each keyword appears in at all — a keyword that shows up in 80
    # unrelated "Thesis Research" courses is noise, not signal.
    course_rows = db.execute(
        select(Course, CourseVersion).join(CourseVersion, CourseVersion.course_id == Course.id)
    ).all()
    total_courses = len({str(course.id) for course, _ in course_rows})

    per_course: dict[str, dict[str, Any]] = {}
    doc_frequency: dict[str, set[str]] = defaultdict(set)
    for course, version in course_rows:
        title_hits = keywords & _keywords(version.title)
        desc_hits = keywords & _keywords(version.description)
        hits = title_hits | desc_hits
        if not hits:
            continue
        for kw in hits:
            doc_frequency[kw].add(str(course.id))
        existing = per_course.get(course.course_code)
        if existing is None or len(hits) > len(existing["hits"]):
            per_course[course.course_code] = {
                "course_id": course.id,
                "subject_code": course.subject_code,
                "title": version.title,
                "credits": float(version.credits),
                "title_hits": title_hits,
                "desc_hits": desc_hits,
                "hits": hits,
            }

    idf = {kw: math.log((total_courses + 1) / (1 + len(ids))) for kw, ids in doc_frequency.items()}

    # Pass 2: weight by rarity, then by how relevant the department is to the
    # student's declared major — a rare-word match outside the major still
    # counts, just needs to work harder to outrank in-department courses.
    scored: list[dict[str, Any]] = []
    for code, info in per_course.items():
        weight = sum(idf.get(k, 0.0) for k in info["title_hits"]) * 3 + sum(idf.get(k, 0.0) for k in info["desc_hits"])
        in_major = code in major_codes
        same_subject = bool(major_subjects) and info["subject_code"] in major_subjects
        if in_major:
            weight *= IN_MAJOR_MULTIPLIER
        elif same_subject:
            weight *= SAME_SUBJECT_MULTIPLIER
        elif major_subjects:
            weight *= OFF_SUBJECT_MULTIPLIER
        scored.append(
            {
                "course_code": code,
                "title": info["title"],
                "credits": info["credits"],
                "matched_terms": sorted(info["hits"])[:10],
                "score": round(weight, 2),
                "in_major": in_major,
                "status": "completed" if code in completed_codes else None,
                "_course_id": info["course_id"],
            }
        )

    already_relevant = sorted(
        (row for row in scored if row["course_code"] in taken_codes),
        key=lambda r: -r["score"],
    )
    recommended = sorted(
        (row for row in scored if row["course_code"] not in taken_codes),
        key=lambda r: (-r["in_major"], -r["score"], r["course_code"]),
    )[:limit]

    for row in [*already_relevant, *recommended]:
        row["prereq_gap"] = _prereq_gap(db, row.pop("_course_id"), completed_codes)

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
