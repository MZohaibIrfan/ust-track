"""Deterministic study-plan edits the degree agent can call.

The live draft lives on the client (localStorage). Each advisor request sends
the current snapshot; these helpers return a new snapshot plus a short summary
the model can explain. Never invent a rearrangement in prose — call this.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

MAX_CREDITS = 18
SEASONS = ("fall", "spring")
TERM_STATUSES = ("regular", "exchange", "leave")


def term_key(year: int, season: str) -> str:
    return f"{int(year)}-{season}"


def _status(statuses: dict[str, str], year: int, season: str) -> str:
    return statuses.get(term_key(year, season), "regular")


def _credits(courses: list[dict[str, Any]], year: int, season: str) -> float:
    return sum(float(c.get("credits") or 0) for c in courses if c.get("year") == year and c.get("season") == season)


def _years(courses: list[dict[str, Any]], statuses: dict[str, str]) -> list[int]:
    years = {1, 2, 3, 4}
    for course in courses:
        if course.get("year"):
            years.add(int(course["year"]))
    for key in statuses:
        try:
            years.add(int(str(key).split("-", 1)[0]))
        except ValueError:
            continue
    return sorted(years)


def _order(year: int, season: str) -> int:
    return int(year) * 2 + (1 if season == "spring" else 0)


def _label(year: int, season: str) -> str:
    return f"Year {year} {season.title()}"


def summarize(draft: dict[str, Any] | None) -> dict[str, Any]:
    if not draft:
        return {"available": False, "error": "No study-plan draft is loaded yet."}
    courses = list(draft.get("courses") or [])
    statuses = dict(draft.get("term_statuses") or {})
    years = _years(courses, statuses)
    terms = []
    for year in years:
        for season in SEASONS:
            sitting = [c for c in courses if c.get("year") == year and c.get("season") == season]
            terms.append(
                {
                    "year": year,
                    "season": season,
                    "label": _label(year, season),
                    "status": _status(statuses, year, season),
                    "credits": _credits(courses, year, season),
                    "courses": [
                        {
                            "id": c.get("id"),
                            "code": c.get("code"),
                            "label": c.get("label"),
                            "credits": c.get("credits"),
                            "locked": bool(c.get("locked")),
                            "status": c.get("status"),
                        }
                        for c in sitting
                    ],
                }
            )
    unplaced = [c for c in courses if not c.get("year") or not c.get("season")]
    return {
        "available": True,
        "program_code": draft.get("program_code"),
        "variant_id": draft.get("variant_id"),
        "years": years,
        "terms": terms,
        "unplaced": [
            {"id": c.get("id"), "code": c.get("code"), "label": c.get("label"), "credits": c.get("credits")}
            for c in unplaced
        ],
    }


def _pack(
    courses: list[dict[str, Any]],
    displaced: list[dict[str, Any]],
    statuses: dict[str, str],
    years: list[int],
    after: tuple[int, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Place displaced courses into later regular terms, then earlier ones. Returns
    (courses, leftover, moved)."""
    by_id = {c["id"]: c for c in courses}
    after_order = _order(*after)
    candidates: list[tuple[int, str]] = []
    for year in years:
        for season in SEASONS:
            if _status(statuses, year, season) != "regular":
                continue
            if year == after[0] and season == after[1]:
                continue
            candidates.append((year, season))
    later = [t for t in candidates if _order(*t) > after_order]
    earlier = [t for t in candidates if _order(*t) <= after_order]
    slots = later + earlier

    moved: list[dict[str, Any]] = []
    leftover: list[dict[str, Any]] = []
    for course in displaced:
        placed = False
        need = float(course.get("credits") or 0)
        for year, season in slots:
            if _credits(courses, year, season) + need > MAX_CREDITS:
                continue
            by_id[course["id"]]["year"] = year
            by_id[course["id"]]["season"] = season
            if by_id[course["id"]].get("code"):
                by_id[course["id"]]["status"] = "planned"
            moved.append(
                {
                    "id": course.get("id"),
                    "code": course.get("code"),
                    "label": course.get("label"),
                    "from": _label(after[0], after[1]),
                    "to": _label(year, season),
                    "to_year": year,
                    "to_season": season,
                }
            )
            placed = True
            break
        if not placed:
            leftover.append(course)
    return list(by_id.values()), leftover, moved


def set_term_status(
    draft: dict[str, Any] | None,
    year: int,
    season: str,
    status: str,
) -> dict[str, Any]:
    if not draft:
        return {"ok": False, "error": "No study-plan draft is loaded yet."}
    season = (season or "").lower()
    status = (status or "").lower()
    if season not in SEASONS:
        return {"ok": False, "error": f"Season must be fall or spring, not {season}."}
    if status not in TERM_STATUSES:
        return {"ok": False, "error": f"Status must be regular, exchange, or leave, not {status}."}

    year = int(year)
    courses = deepcopy(list(draft.get("courses") or []))
    statuses = dict(draft.get("term_statuses") or {})
    sitting = [c for c in courses if c.get("year") == year and c.get("season") == season]

    if status in ("exchange", "leave"):
        locked = [c for c in sitting if c.get("locked")]
        if locked:
            names = ", ".join((c.get("code") or c.get("label") or "?") for c in locked[:4])
            return {
                "ok": False,
                "error": (
                    f"{_label(year, season)} already has taken or in-progress courses ({names}). "
                    "Pick a future term that isn't underway."
                ),
            }

        displaced = [c for c in sitting if not c.get("locked")]
        for course in courses:
            if course.get("id") in {c["id"] for c in displaced}:
                course["year"] = None
                course["season"] = None
                course["status"] = "open"
        statuses[term_key(year, season)] = status

        years = _years(courses, statuses)
        courses, leftover, moved = _pack(courses, displaced, statuses, years, (year, season))
        deferral = None
        if leftover:
            extra = max(5, (years[-1] if years else 4) + 1)
            statuses.setdefault(term_key(extra, "fall"), "regular")
            statuses.setdefault(term_key(extra, "spring"), "regular")
            years = _years(courses, statuses)
            if extra not in years:
                years.append(extra)
                years.sort()
            courses, leftover, more = _pack(courses, leftover, statuses, years, (year, season))
            moved.extend(more)
            still = [c.get("code") or c.get("label") for c in leftover]
            deferral = {
                "needed": True,
                "year": extra,
                "reason": (
                    f"The remaining courses don't fit in years 1–4 once {_label(year, season)} is "
                    f"{status}. Added Year {extra} so they can finish. "
                    + (f"Still unplaced: {', '.join(str(s) for s in still)}." if still else "")
                ).strip(),
            }
            if leftover:
                # leave them in the tray
                pass

        title = f"{_label(year, season)} · {status.title()}"
        bits = [f"Marked {_label(year, season)} as {status}."]
        if moved:
            bits.append(
                "Moved "
                + "; ".join(f"{m.get('code') or m.get('label')} → {m['to']}" for m in moved[:8])
                + ("…" if len(moved) > 8 else "")
                + "."
            )
        if deferral and deferral.get("needed"):
            bits.append(deferral["reason"])
        summary = " ".join(bits)
    else:
        statuses[term_key(year, season)] = "regular"
        moved = []
        deferral = None
        title = f"{_label(year, season)} · Regular"
        summary = f"Restored {_label(year, season)} to a regular HKUST term. Courses were not moved back automatically."

    next_draft = {
        **draft,
        "courses": courses,
        "term_statuses": statuses,
    }
    return {
        "ok": True,
        "proposed": True,
        "title": title,
        "summary": summary,
        "year": year,
        "season": season,
        "status": status,
        "moved": moved,
        "deferral": deferral,
        "courses": courses,
        "term_statuses": statuses,
        "draft": next_draft,
    }


def move_course(
    draft: dict[str, Any] | None,
    course_id: str,
    year: int | None,
    season: str | None,
) -> dict[str, Any]:
    if not draft:
        return {"ok": False, "error": "No study-plan draft is loaded yet."}
    courses = deepcopy(list(draft.get("courses") or []))
    statuses = dict(draft.get("term_statuses") or {})
    target = next((c for c in courses if c.get("id") == course_id), None)
    if target is None:
        code = course_id
        target = next((c for c in courses if (c.get("code") or "").upper() == code.upper()), None)
    if target is None:
        return {"ok": False, "error": f"No course matching {course_id} is on the study plan."}
    if target.get("locked"):
        return {"ok": False, "error": f"{target.get('code') or target.get('label')} is already taken and stays put."}

    if year is not None and season:
        season = season.lower()
        if season not in SEASONS:
            return {"ok": False, "error": f"Season must be fall or spring, not {season}."}
        if _status(statuses, int(year), season) != "regular":
            return {
                "ok": False,
                "error": f"{_label(int(year), season)} is marked {_status(statuses, int(year), season)} — pick a regular term.",
            }
        if _credits(courses, int(year), season) + float(target.get("credits") or 0) > MAX_CREDITS and not (
            target.get("year") == int(year) and target.get("season") == season
        ):
            return {"ok": False, "error": f"{_label(int(year), season)} would go over {MAX_CREDITS} credits."}
        from_label = _label(target["year"], target["season"]) if target.get("year") and target.get("season") else "Unplaced"
        target["year"] = int(year)
        target["season"] = season
        if target.get("code"):
            target["status"] = "planned"
        to_label = _label(int(year), season)
    else:
        from_label = _label(target["year"], target["season"]) if target.get("year") and target.get("season") else "Unplaced"
        target["year"] = None
        target["season"] = None
        target["status"] = "open"
        to_label = "Unplaced"

    next_draft = {**draft, "courses": courses, "term_statuses": statuses}
    name = target.get("code") or target.get("label")
    return {
        "ok": True,
        "proposed": True,
        "title": f"Move {name}",
        "summary": f"Move {name} from {from_label} to {to_label}.",
        "moved": [{"id": target.get("id"), "code": target.get("code"), "label": target.get("label"), "from": from_label, "to": to_label}],
        "deferral": None,
        "courses": courses,
        "term_statuses": statuses,
        "draft": next_draft,
    }
