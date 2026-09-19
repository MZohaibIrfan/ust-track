"""Deterministic study-plan edits the degree agent can call.

The live draft lives on the client (localStorage). Each advisor request sends
the current snapshot; these helpers return a new snapshot plus a short summary
the model can explain. Never invent a rearrangement in prose — call this.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

MAX_CREDITS = 18
MAX_YEAR = 8
BASE_YEARS = (1, 2, 3, 4)
SEASONS = ("fall", "spring")
TERM_STATUSES = ("regular", "exchange", "leave")


def term_key(year: int, season: str) -> str:
    return f"{int(year)}-{season}"


def _status(statuses: dict[str, str], year: int, season: str) -> str:
    return statuses.get(term_key(year, season), "regular")


def _credits(courses: list[dict[str, Any]], year: int, season: str) -> float:
    return sum(float(c.get("credits") or 0) for c in courses if c.get("year") == year and c.get("season") == season)


def _visible(courses: list[dict[str, Any]], statuses: dict[str, str], year: int, season: str) -> bool:
    if int(year) in BASE_YEARS:
        return True
    if term_key(year, season) in statuses:
        return True
    return any(c.get("year") == year and c.get("season") == season for c in courses)


def _board(courses: list[dict[str, Any]], statuses: dict[str, str]) -> list[tuple[int, str]]:
    years = set(BASE_YEARS)
    for course in courses:
        if course.get("year"):
            years.add(int(course["year"]))
    for key in statuses:
        try:
            years.add(int(str(key).split("-", 1)[0]))
        except ValueError:
            continue
    terms: list[tuple[int, str]] = []
    for year in sorted(years):
        for season in SEASONS:
            if _visible(courses, statuses, year, season):
                terms.append((year, season))
    return terms


def _years(courses: list[dict[str, Any]], statuses: dict[str, str]) -> list[int]:
    seen: list[int] = []
    for year, _season in _board(courses, statuses):
        if year not in seen:
            seen.append(year)
    return seen


def _next_term(courses: list[dict[str, Any]], statuses: dict[str, str]) -> tuple[int, str] | None:
    year = BASE_YEARS[-1] + 1
    season = "fall"
    while year <= MAX_YEAR:
        if not _visible(courses, statuses, year, season):
            return (year, season)
        if season == "fall":
            season = "spring"
        else:
            year += 1
            season = "fall"
    return None


def _order(year: int, season: str) -> int:
    return int(year) * 2 + (1 if season == "spring" else 0)


def _label(year: int, season: str) -> str:
    return f"Year {year} {season.title()}"


def _compact(code: str | None) -> str:
    return (code or "").replace(" ", "").upper()


def _pretty(code: str | None) -> str:
    compact = _compact(code)
    if len(compact) >= 5 and compact[-4:].isdigit():
        return f"{compact[:-4]} {compact[-4:]}"
    if len(compact) >= 6 and compact[-5:-1].isdigit():
        return f"{compact[:-5]} {compact[-5:]}"
    return compact or (code or "")


COMP_4900 = "COMP4900"
COMP_4900_LABEL = "Academic and Professional Development"


def _is_comp_4900(course: dict[str, Any]) -> bool:
    return str(course.get("code") or "").upper() == COMP_4900


def _current_order(courses: list[dict[str, Any]]) -> int:
    best_ip = -1
    best_done = -1
    for course in courses:
        if course.get("year") is None or not course.get("season") or _is_comp_4900(course):
            continue
        order = _order(int(course["year"]), course["season"])
        if course.get("status") == "in_progress":
            best_ip = max(best_ip, order)
        if course.get("status") == "done":
            best_done = max(best_done, order)
    if best_ip >= 0:
        return best_ip
    if best_done >= 0:
        return best_done + 1
    return _order(1, "fall")


def _ensure_comp_4900(courses: list[dict[str, Any]], statuses: dict[str, str], enabled: bool) -> list[dict[str, Any]]:
    without = [course for course in courses if not _is_comp_4900(course)]
    if not enabled:
        return without
    current = _current_order(without)
    next_courses = list(without)
    for year, season in _board(without, statuses):
        if _status(statuses, year, season) != "regular":
            continue
        order = _order(year, season)
        if order < current:
            status = "done"
        elif order == current:
            status = "in_progress"
        else:
            status = "planned"
        next_courses.append(
            {
                "id": f"residency-{COMP_4900}-{year}-{season}",
                "code": COMP_4900,
                "label": COMP_4900_LABEL,
                "credits": 0,
                "options": [],
                "locked": True,
                "status": status,
                "year": year,
                "season": season,
            }
        )
    return next_courses


def summarize(draft: dict[str, Any] | None) -> dict[str, Any]:
    if not draft:
        return {"available": False, "error": "No study-plan draft is loaded yet."}
    courses = list(draft.get("courses") or [])
    statuses = dict(draft.get("term_statuses") or {})
    years = _years(courses, statuses)
    terms = []
    for year, season in _board(courses, statuses):
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
    after: tuple[int, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Place displaced courses into later regular terms, then earlier ones. Returns
    (courses, leftover, moved)."""
    by_id = {c["id"]: c for c in courses}
    after_order = _order(*after)
    candidates: list[tuple[int, str]] = []
    for year, season in _board(courses, statuses):
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

    residency = any(_is_comp_4900(c) for c in courses)
    if status in ("exchange", "leave"):
        locked = [c for c in sitting if c.get("locked") and not _is_comp_4900(c)]
        if locked:
            names = ", ".join((c.get("code") or c.get("label") or "?") for c in locked[:4])
            return {
                "ok": False,
                "error": (
                    f"{_label(year, season)} already has taken or in-progress courses ({names}). "
                    "Pick a future term that isn't underway."
                ),
            }

        displaced = [c for c in sitting if not c.get("locked") and not _is_comp_4900(c)]
        courses = [
            c
            for c in courses
            if not (_is_comp_4900(c) and c.get("year") == year and c.get("season") == season)
        ]
        for course in courses:
            if course.get("id") in {c["id"] for c in displaced}:
                course["year"] = None
                course["season"] = None
                course["status"] = "open"
        statuses[term_key(year, season)] = status

        courses, leftover, moved = _pack(courses, displaced, statuses, (year, season))
        deferral = None
        added: list[tuple[int, str]] = []
        while leftover:
            extra = _next_term(courses, statuses)
            if extra is None:
                break
            statuses[term_key(*extra)] = "regular"
            added.append(extra)
            courses, leftover, more = _pack(courses, leftover, statuses, (year, season))
            moved.extend(more)
        if added:
            still = [c.get("code") or c.get("label") for c in leftover]
            first = added[0]
            last = added[-1]
            span = _label(*first) if first == last else f"{_label(*first)}–{_label(*last)}"
            deferral = {
                "needed": True,
                "year": first[0],
                "reason": (
                    f"The remaining courses don't fit in years 1–4 once {_label(year, season)} is "
                    f"{status}. Added {span} so they can finish."
                    + (f" Still unplaced: {', '.join(str(s) for s in still)}." if still else "")
                ).strip(),
            }

        courses = _ensure_comp_4900(courses, statuses, residency)
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
        courses = _ensure_comp_4900(courses, statuses, residency)
        moved = []
        deferral = None
        title = f"{_label(year, season)} · Regular"
        summary = f"Restored {_label(year, season)} to a regular HKUST term. Courses were not moved back automatically. COMP 4900 is auto-registered on regular terms."

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


def _payload(draft: dict[str, Any], courses: list[dict[str, Any]], statuses: dict[str, str], **extra: Any) -> dict[str, Any]:
    next_draft = {**draft, "courses": courses, "term_statuses": statuses}
    return {
        "ok": True,
        "proposed": True,
        "courses": courses,
        "term_statuses": statuses,
        "draft": next_draft,
        **extra,
    }


def add_term(
    draft: dict[str, Any] | None,
    year: int | None = None,
    season: str | None = None,
) -> dict[str, Any]:
    if not draft:
        return {"ok": False, "error": "No study-plan draft is loaded yet."}
    courses = deepcopy(list(draft.get("courses") or []))
    statuses = dict(draft.get("term_statuses") or {})
    if year is not None and season:
        season = season.lower()
        if season not in SEASONS:
            return {"ok": False, "error": f"Season must be fall or spring, not {season}."}
        target = (int(year), season)
    else:
        nxt = _next_term(courses, statuses)
        if nxt is None:
            return {"ok": False, "error": f"Can't add another semester past Year {MAX_YEAR}."}
        target = nxt
    if target[0] < 1 or target[0] > MAX_YEAR:
        return {"ok": False, "error": f"Year must be between 1 and {MAX_YEAR}."}
    if _visible(courses, statuses, target[0], target[1]):
        return {"ok": False, "error": f"{_label(*target)} is already on the plan."}

    statuses[term_key(*target)] = "regular"
    residency = any(_is_comp_4900(c) for c in courses)
    courses = _ensure_comp_4900(courses, statuses, residency)
    label = _label(*target)
    return _payload(
        draft,
        courses,
        statuses,
        title=f"Add {label}",
        summary=f"Added {label} to the study plan.",
        year=target[0],
        season=target[1],
        status="regular",
        moved=[],
        deferral=None,
    )


def remove_term(
    draft: dict[str, Any] | None,
    year: int,
    season: str,
) -> dict[str, Any]:
    if not draft:
        return {"ok": False, "error": "No study-plan draft is loaded yet."}
    season = (season or "").lower()
    if season not in SEASONS:
        return {"ok": False, "error": f"Season must be fall or spring, not {season}."}
    year = int(year)
    courses = deepcopy(list(draft.get("courses") or []))
    statuses = dict(draft.get("term_statuses") or {})
    if year in BASE_YEARS:
        return {"ok": False, "error": f"{_label(year, season)} is part of the four-year plan and can't be removed."}
    if not _visible(courses, statuses, year, season):
        return {"ok": False, "error": f"{_label(year, season)} isn't on the plan."}
    occupying = [
        c
        for c in courses
        if c.get("year") == year and c.get("season") == season and not _is_comp_4900(c)
    ]
    if occupying:
        names = ", ".join((c.get("code") or c.get("label") or "?") for c in occupying[:4])
        return {"ok": False, "error": f"Move {names} off {_label(year, season)} before removing it."}

    residency = any(_is_comp_4900(c) for c in courses)
    courses = [
        c for c in courses if not (_is_comp_4900(c) and c.get("year") == year and c.get("season") == season)
    ]
    statuses.pop(term_key(year, season), None)
    courses = _ensure_comp_4900(courses, statuses, residency)
    label = _label(year, season)
    return _payload(
        draft,
        courses,
        statuses,
        title=f"Remove {label}",
        summary=f"Removed {label} from the study plan.",
        year=year,
        season=season,
        moved=[],
        deferral=None,
    )


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
        year = int(year)
        if year < 1 or year > MAX_YEAR:
            return {"ok": False, "error": f"Year must be between 1 and {MAX_YEAR}."}
        if not _visible(courses, statuses, year, season):
            statuses[term_key(year, season)] = "regular"
        if _status(statuses, year, season) != "regular":
            return {
                "ok": False,
                "error": f"{_label(year, season)} is marked {_status(statuses, year, season)} — pick a regular term.",
            }
        if _credits(courses, year, season) + float(target.get("credits") or 0) > MAX_CREDITS and not (
            target.get("year") == year and target.get("season") == season
        ):
            return {"ok": False, "error": f"{_label(year, season)} would go over {MAX_CREDITS} credits."}
        from_label = _label(target["year"], target["season"]) if target.get("year") and target.get("season") else "Unplaced"
        target["year"] = year
        target["season"] = season
        if target.get("code"):
            target["status"] = "planned"
        to_label = _label(year, season)
    else:
        from_label = _label(target["year"], target["season"]) if target.get("year") and target.get("season") else "Unplaced"
        target["year"] = None
        target["season"] = None
        target["status"] = "open"
        to_label = "Unplaced"

    residency = any(_is_comp_4900(c) for c in courses)
    courses = _ensure_comp_4900(courses, statuses, residency)
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


def _course_matches(course: dict[str, Any], code: str) -> bool:
    want = _compact(code)
    if not want:
        return False
    if _compact(course.get("code")) == want:
        return True
    return want in {_compact(option) for option in course.get("options") or []}


def _existing_for(courses: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    unlocked = [course for course in courses if _course_matches(course, code) and not course.get("locked")]
    if not unlocked:
        locked = next((course for course in courses if _course_matches(course, code)), None)
        return locked
    unplaced = [course for course in unlocked if not course.get("year") or not course.get("season")]
    return unplaced[0] if unplaced else unlocked[0]


def _available_terms(
    courses: list[dict[str, Any]],
    statuses: dict[str, str],
    start_year: int | None = None,
    start_season: str | None = None,
) -> list[tuple[int, str]]:
    current = _current_order(courses)
    if start_year is not None and start_season:
        start = _order(int(start_year), start_season)
    else:
        start = current + 1
    terms: list[tuple[int, str]] = []
    for year, season in _board(courses, statuses):
        if _status(statuses, year, season) != "regular":
            continue
        if _order(year, season) >= start:
            terms.append((year, season))
    return terms


def _open_term(
    courses: list[dict[str, Any]],
    statuses: dict[str, str],
    need: float,
    start_year: int | None = None,
    start_season: str | None = None,
) -> tuple[int, str] | None:
    while True:
        for year, season in _available_terms(courses, statuses, start_year, start_season):
            if _credits(courses, year, season) + need <= MAX_CREDITS:
                return year, season
        extra = _next_term(courses, statuses)
        if extra is None:
            return None
        statuses[term_key(*extra)] = "regular"


def add_courses(
    draft: dict[str, Any] | None,
    specs: list[dict[str, Any]],
    year: int | None = None,
    season: str | None = None,
) -> dict[str, Any]:
    """Place catalog courses on the next regular term that has room (then the one after)."""
    if not draft:
        return {"ok": False, "error": "No study-plan draft is loaded yet."}
    if season:
        season = season.lower()
        if season not in SEASONS:
            return {"ok": False, "error": f"Season must be fall or spring, not {season}."}
        if year is None:
            return {"ok": False, "error": "Year is required when a season is given."}
    if year is not None and not season:
        return {"ok": False, "error": "Season is required when a year is given."}

    courses = deepcopy(list(draft.get("courses") or []))
    statuses = dict(draft.get("term_statuses") or {})
    current = _current_order(courses)
    placed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[str] = set()

    for spec in specs:
        code = _compact(str(spec.get("code") or spec.get("course_code") or ""))
        if not code:
            continue
        if code in seen:
            continue
        seen.add(code)
        name = _pretty(code)
        if _is_comp_4900({"code": code}):
            skipped.append({"code": name, "reason": "COMP 4900 is added automatically on regular terms."})
            continue
        if spec.get("error"):
            skipped.append({"code": name, "reason": spec["error"]})
            continue

        title = spec.get("title") or spec.get("label") or name
        need = float(spec.get("credits") or 3)
        existing = _existing_for(courses, code)
        if existing is not None:
            if existing.get("locked"):
                skipped.append({"code": name, "reason": f"Already {existing.get('status') or 'taken'}."})
                continue
            ey, es = existing.get("year"), existing.get("season")
            if ey and es and _order(int(ey), es) > current:
                skipped.append({"code": name, "reason": f"Already on {_label(int(ey), es)}."})
                continue
            target = existing
        else:
            target = {
                "id": f"added-{code}",
                "code": code,
                "label": title,
                "credits": need,
                "options": [],
                "locked": False,
                "status": "open",
                "year": None,
                "season": None,
            }
            courses.append(target)

        slot = _open_term(courses, statuses, need, year, season)
        if slot is None:
            skipped.append({"code": name, "reason": f"No regular term has room under {MAX_CREDITS} credits."})
            if target.get("id") and not existing:
                courses = [course for course in courses if course.get("id") != target.get("id")]
            continue

        target["code"] = code
        target["label"] = title
        target["credits"] = need
        target["year"] = slot[0]
        target["season"] = slot[1]
        target["status"] = "planned"
        placed.append(
            {
                "id": target.get("id"),
                "code": name,
                "label": title,
                "from": "Catalog" if existing is None else "Unplaced",
                "to": _label(*slot),
                "to_year": slot[0],
                "to_season": slot[1],
            }
        )

    if not placed:
        reason = skipped[0]["reason"] if skipped else "No courses to add."
        return {"ok": False, "error": reason, "skipped": skipped}

    residency = any(_is_comp_4900(course) for course in courses)
    courses = _ensure_comp_4900(courses, statuses, residency)
    terms = list(dict.fromkeys(item["to"] for item in placed))
    names = ", ".join(item["code"] for item in placed)
    if len(placed) == 1:
        title = f"Add {placed[0]['code']} to {placed[0]['to']}"
    elif len(terms) == 1:
        title = f"Add {len(placed)} courses to {terms[0]}"
    else:
        title = f"Add {len(placed)} courses to the study plan"
    summary = f"Place {names} on {' then '.join(terms)}."
    if skipped:
        summary += " Skipped " + "; ".join(f"{item['code']} ({item['reason']})" for item in skipped[:4]) + "."
    return _payload(
        draft,
        courses,
        statuses,
        title=title,
        summary=summary,
        year=placed[0]["to_year"],
        season=placed[0]["to_season"],
        moved=placed,
        added=placed,
        skipped=skipped,
        deferral=None,
    )
