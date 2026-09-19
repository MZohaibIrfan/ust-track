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


@router.post("/degree/apply")
def apply_declaration(body: DeclareBody, db: Session = Depends(get_db)) -> dict:
    return degree_ops.create_pathway(db, body.planner_id, body.program_code, body.role)


@router.get("/degree/pathways")
def get_pathways(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return degree_ops.list_pathways(db, planner_id)


@router.post("/degree/pathways")
def post_pathway(body: DeclareBody, db: Session = Depends(get_db)) -> dict:
    return degree_ops.create_pathway(db, body.planner_id, body.program_code, body.role)


@router.get("/degree/profile")
def get_profile(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return degree_ops.get_student_profile(db, planner_id)


@router.get("/degree/progress")
def get_progress(planner_id: str, program_code: str, db: Session = Depends(get_db)) -> dict:
    return degree_ops.check_requirement_progress(db, planner_id, program_code)
