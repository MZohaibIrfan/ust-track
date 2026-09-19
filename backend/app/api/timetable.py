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
    section_code: str
    term_code: str | None = None


@router.post("/timetable/apply")
def apply_suggestion(body: ApplyBody, db: Session = Depends(get_db)) -> dict:
    return planner_ops.add_class_selection(db, body.planner_id, body.course_code, body.section_code, body.term_code)
