"""Server-side .ics export for a planner's selected class sections.

One VEVENT per meeting pattern, TZID=Asia/Hong_Kong, weekly RRULE bounded by
the meeting's own start_date/end_date. A meeting with no recorded date range
still exports as a single non-recurring event rather than being dropped.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClassSection, StudentClassSelection

ICS_WEEKDAY = {"Mo": "MO", "Tu": "TU", "We": "WE", "Th": "TH", "Fr": "FR", "Sa": "SA", "Su": "SU"}
PY_WEEKDAY = {"Mo": 0, "Tu": 1, "We": 2, "Th": 3, "Fr": 4, "Sa": 5, "Su": 6}


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;")


def _first_occurrence(anchor: date, weekday: int) -> date:
    return anchor + timedelta(days=(weekday - anchor.weekday()) % 7)


def plan_ics(db: Session, planner_id: str) -> str:
    from app.services.planner_ops import get_or_create_planner  # local import breaks the cycle

    planner = get_or_create_planner(db, planner_id)
    selections = db.scalars(
        select(StudentClassSelection).where(StudentClassSelection.planner_id == planner.id)
    ).all()

    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UST Track//Advisor//EN", "CALSCALE:GREGORIAN"]

    for selection in selections:
        section: ClassSection | None = db.get(ClassSection, selection.section_id)
        if section is None:
            continue
        course = section.offering.course

        for meeting in section.meetings:
            if meeting.weekday not in PY_WEEKDAY or not meeting.start_time or not meeting.end_time:
                continue

            anchor = meeting.start_date or date.today()
            first_day = _first_occurrence(anchor, PY_WEEKDAY[meeting.weekday])
            dtstart = datetime.combine(first_day, meeting.start_time)
            dtend = datetime.combine(first_day, meeting.end_time)

            lines += [
                "BEGIN:VEVENT",
                f"UID:{uuid.uuid4()}@ust-track",
                f"SUMMARY:{_escape(f'{course.course_code} {section.section_code}')}",
                f"LOCATION:{_escape(meeting.venue or '')}",
                f"DTSTART;TZID=Asia/Hong_Kong:{dtstart.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID=Asia/Hong_Kong:{dtend.strftime('%Y%m%dT%H%M%S')}",
            ]
            if meeting.end_date:
                until = datetime.combine(meeting.end_date, time(23, 59, 59))
                lines.append(f"RRULE:FREQ=WEEKLY;BYDAY={ICS_WEEKDAY[meeting.weekday]};UNTIL={until.strftime('%Y%m%dT%H%M%S')}")
            lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)
