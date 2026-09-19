from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import career_ops, chat_ops
from app.services.agents.career import stream_advisor

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class AdvisorRequest(BaseModel):
    messages: list[ChatMessage]
    planner_id: str | None = None


@router.get("/career/chat")
def get_career_chat(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return {"messages": chat_ops.list_messages(db, planner_id, "career")}


@router.delete("/career/chat")
def clear_career_chat(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return chat_ops.clear_messages(db, planner_id, "career")


@router.post("/career/advisor")
def career_advisor(body: AdvisorRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    if history and history[-1]["role"] == "user":
        chat_ops.append_message(db, body.planner_id, "career", "user", history[-1]["content"])

    def run():
        acc = ""
        for chunk in stream_advisor(db, history, body.planner_id):
            acc += chunk
            yield chunk
        chat_ops.append_message(db, body.planner_id, "career", "assistant", acc)

    return StreamingResponse(run(), media_type="text/plain")


@router.get("/career/experiences")
def list_experiences(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return career_ops.list_experiences(db, planner_id)


class ExperienceBody(BaseModel):
    planner_id: str
    title: str
    organization: str = ""
    kind: str = "internship"
    start_date: str | None = None
    end_date: str | None = None
    description: str = ""


@router.post("/career/experiences")
def add_experience(body: ExperienceBody, db: Session = Depends(get_db)) -> dict:
    return career_ops.add_experience(
        db,
        body.planner_id,
        body.title,
        body.organization,
        body.kind,
        body.start_date,
        body.end_date,
        body.description,
    )


@router.delete("/career/experiences/{experience_id}")
def remove_experience(experience_id: str, planner_id: str, db: Session = Depends(get_db)) -> dict:
    return career_ops.remove_experience(db, planner_id, experience_id)


class JobMatchBody(BaseModel):
    planner_id: str
    job_description: str


@router.post("/career/match")
def match_job(body: JobMatchBody, db: Session = Depends(get_db)) -> dict:
    return career_ops.recommend_courses_for_job(db, body.planner_id, body.job_description)
