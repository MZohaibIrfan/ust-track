"""Official recommended study pathways — separate from requirement trees.

Source files live in app/data/study_pathways/. Student progress is overlaid
at read time from planner.student_course; the pathway itself is catalog data.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.services.degree_ops import get_student_profile

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "study_pathways"

STATUS_RANK = {"completed": 3, "in_progress": 2, "planned": 1}
STATUS_OUT = {"completed": "done", "in_progress": "in_progress", "planned": "planned"}
SEASON_LABEL = {"fall": "Fall", "spring": "Spring"}


@lru_cache(maxsize=1)
def _index() -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / "index.json").read_text())


@lru_cache(maxsize=8)
def _load_file(name: str) -> dict[str, Any]:
    path = DATA_DIR / name
    if not path.is_file():
        return {}
    return json.loads(path.read_text())


def _pick_entry(program_code: str, intake_year: int | None) -> dict[str, Any] | None:
    rows = [row for row in _index() if row["program_code"] == program_code.upper()]
    if not rows:
        return None
    if intake_year is not None:
        exact = next((row for row in rows if row["intake_year"] == intake_year), None)
        if exact:
            return exact
    return max(rows, key=lambda row: row["intake_year"])


def _credits(value: int | list[int]) -> dict[str, int]:
    if isinstance(value, list):
        return {"min": int(value[0]), "max": int(value[-1])}
    n = int(value)
    return {"min": n, "max": n}


def _format_credits(span: dict[str, int]) -> str:
    if span["min"] == span["max"]:
        return str(span["min"])
    return f"{span['min']}–{span['max']}"


def _slot_status(codes: list[str], by_code: dict[str, str]) -> tuple[str, str | None]:
    best_code: str | None = None
    best_rank = 0
    for code in codes:
        rank = STATUS_RANK.get(by_code.get(code, ""), 0)
        if rank > best_rank:
            best_rank = rank
            best_code = code
    if best_code is None:
        return "open", None
    return STATUS_OUT[by_code[best_code]], best_code


def _annotate_slot(raw: dict[str, Any], by_code: dict[str, str]) -> dict[str, Any]:
    codes = [c.upper() for c in raw.get("codes") or []]
    status, matched = _slot_status(codes, by_code) if codes else ("open", None)
    credits = _credits(raw["credits"])
    return {
        "kind": raw["kind"],
        "label": raw["label"],
        "codes": codes,
        "credits": credits,
        "credits_label": _format_credits(credits),
        "note": raw.get("note"),
        "tag": raw.get("tag"),
        "status": status,
        "matched_code": matched,
    }


def _annotate_variant(raw: dict[str, Any], by_code: dict[str, str], standing_year: int | None) -> dict[str, Any]:
    years = []
    for year in raw["years"]:
        terms = []
        for term in year["terms"]:
            credits = _credits(term["credits"])
            slots = [_annotate_slot(slot, by_code) for slot in term["slots"]]
            terms.append(
                {
                    "season": term["season"],
                    "label": SEASON_LABEL[term["season"]],
                    "credits": credits,
                    "credits_label": f"{_format_credits(credits)} cr",
                    "zero_credit": term.get("zero_credit") or [],
                    "slots": slots,
                }
            )
        years.append(
            {
                "year": year["year"],
                "label": f"Year {year['year']}",
                "current": standing_year == year["year"],
                "terms": terms,
            }
        )
    return {
        "id": raw["id"],
        "label": raw["label"],
        "title": raw["title"],
        "notes": raw.get("notes") or [],
        "years": years,
    }


def get_study_pathway(
    db: Session,
    program_code: str,
    planner_id: str | None = None,
    intake_year: int | None = None,
) -> dict[str, Any]:
    code = program_code.strip().upper()
    profile: dict[str, Any] | None = None
    if planner_id:
        profile = get_student_profile(db, planner_id)
        if intake_year is None:
            intake_year = profile.get("intake_year") or profile.get("entry_year")

    entry = _pick_entry(code, intake_year)
    if entry is None:
        return {"available": False, "program_code": code, "intake_year": intake_year}

    doc = _load_file(entry["file"])
    if not doc:
        return {"available": False, "program_code": code, "intake_year": intake_year}

    by_code: dict[str, str] = {}
    declared: list[dict[str, Any]] = []
    standing_year = None
    has_minor = False
    if profile:
        standing_year = profile.get("standing_year")
        declared = profile.get("declared_programs") or []
        has_minor = any(row.get("role") == "minor" for row in declared)
        for row in profile.get("courses") or []:
            course_code = row.get("course_code")
            if course_code:
                by_code[course_code.upper()] = row.get("status") or ""

    variants = [_annotate_variant(variant, by_code, standing_year) for variant in doc["variants"]]
    suggested = "major"
    suggest_reason = None
    if any(v["id"] == "major_plus_minor" for v in variants) and (
        has_minor or any(row.get("code") == "COMP" and row.get("role") == "major" for row in declared)
    ):
        suggested = "major_plus_minor"
        if not has_minor:
            suggest_reason = "Six 3-credit minor slots from Year 2 Spring."

    year_note = None
    if intake_year and intake_year != doc["intake_year"]:
        year_note = f"Showing the {doc['catalog_year']} CSE plan (closest published)."

    return {
        "available": True,
        "program_code": doc["program_code"],
        "intake_year": doc["intake_year"],
        "catalog_year": doc["catalog_year"],
        "source_url": doc["source_url"],
        "source_label": doc["source_label"],
        "notes": doc.get("notes") or [],
        "year_note": year_note,
        "suggested_variant": suggested,
        "suggest_reason": suggest_reason,
        "has_minor": has_minor,
        "standing_year": standing_year,
        "variants": variants,
    }
