from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import degree_ops
from app.services.agents.degree import Mode, stream_advisor

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class AdvisorRequest(BaseModel):
    messages: list[ChatMessage]
    planner_id: str | None = None
    mode: Mode = "suggest"


@router.post("/degree/advisor")
def degree_advisor(body: AdvisorRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    return StreamingResponse(
        stream_advisor(db, history, body.planner_id, body.mode),
        media_type="text/plain",
    )


class DeclareBody(BaseModel):
    planner_id: str
    program_code: str
    role: str
    intake_year: int | None = None


class RemoveBody(BaseModel):
    planner_id: str
    program_code: str


class EntryYearBody(BaseModel):
    planner_id: str
    entry_year: int


@router.post("/degree/apply")
def apply_declaration(body: DeclareBody, db: Session = Depends(get_db)) -> dict:
    return degree_ops.declare_program(db, body.planner_id, body.program_code, body.role, body.intake_year)


@router.post("/degree/remove")
def remove_declaration(body: RemoveBody, db: Session = Depends(get_db)) -> dict:
    return degree_ops.remove_declared_program(db, body.planner_id, body.program_code)


@router.get("/degree/profile")
def get_profile(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return degree_ops.get_student_profile(db, planner_id)


@router.put("/degree/entry-year")
def put_entry_year(body: EntryYearBody, db: Session = Depends(get_db)) -> dict:
    return degree_ops.set_entry_year(db, body.planner_id, body.entry_year)


@router.get("/degree/progress")
def get_progress(
    planner_id: str,
    program_code: str,
    intake_year: int | None = None,
    db: Session = Depends(get_db),
) -> dict:
    return degree_ops.check_requirement_progress(db, planner_id, program_code, intake_year)
