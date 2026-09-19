from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import planner_ops
from app.services.agents.timetable import Mode, stream_advisor

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class AdvisorRequest(BaseModel):
    messages: list[ChatMessage]
    planner_id: str | None = None
    mode: Mode = "suggest"


@router.post("/timetable/advisor")
def timetable_advisor(body: AdvisorRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    return StreamingResponse(
        stream_advisor(db, history, body.planner_id, body.mode),
        media_type="text/plain",
    )


class ApplyBody(BaseModel):
    planner_id: str
    course_code: str
    section_code: str | None = None
    section_codes: list[str] = []
    term_code: str | None = None
    replaces_course_code: str | None = None
    replaces_section_code: str | None = None


@router.post("/timetable/apply")
def apply_suggestion(body: ApplyBody, db: Session = Depends(get_db)) -> dict:
    codes = [c for c in body.section_codes if c.strip()]
    if body.replaces_course_code:
        if not body.section_code and not codes:
            return {"error": "section_code is required"}
        return planner_ops.replace_class_selection(
            db,
            body.planner_id,
            body.course_code,
            body.section_code or codes[0],
            body.replaces_course_code,
            body.replaces_section_code,
            body.term_code,
        )
    if len(codes) > 1 or (codes and not body.section_code):
        return planner_ops.add_class_selections(
            db, body.planner_id, body.course_code, codes or [body.section_code or ""], body.term_code
        )
    if not body.section_code and not codes:
        return {"error": "section_code is required"}
    return planner_ops.add_class_selection(
        db, body.planner_id, body.course_code, body.section_code or codes[0], body.term_code
    )


class DropBody(BaseModel):
    planner_id: str
    course_code: str
    section_code: str | None = None


@router.post("/timetable/drop")
def drop_selection(body: DropBody, db: Session = Depends(get_db)) -> dict:
    return planner_ops.remove_class_selection(db, body.planner_id, body.course_code, body.section_code)


class SwapBody(BaseModel):
    planner_id: str
    course_code: str
    from_section: str
    to_section: str
    term_code: str | None = None
    also_sections: list[str] = []


@router.post("/timetable/swap")
def swap_selection(body: SwapBody, db: Session = Depends(get_db)) -> dict:
    return planner_ops.swap_class_selection(
        db,
        body.planner_id,
        body.course_code,
        body.from_section,
        body.to_section,
        body.term_code,
        body.also_sections,
    )
