from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import career_ops, chat_ops, cv_ops
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
    location: str = ""
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
        body.location,
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


class CvBody(BaseModel):
    planner_id: str
    full_name: str
    email: str = ""
    phone: str = ""
    linkedin: str = ""
    github: str = ""
    website: str = ""
    skills_text: str = ""


@router.post("/career/cv")
def generate_cv(body: CvBody, db: Session = Depends(get_db)) -> PlainTextResponse:
    latex = cv_ops.generate_cv_latex(
        db,
        body.planner_id,
        body.full_name,
        body.email,
        body.phone,
        body.linkedin,
        body.github,
        body.website,
        body.skills_text,
    )
    return PlainTextResponse(
        latex,
        media_type="application/x-tex",
        headers={"Content-Disposition": "attachment; filename=resume.tex"},
    )


@router.post("/career/cv/pdf")
def generate_cv_pdf(body: CvBody, db: Session = Depends(get_db)) -> Response:
    latex = cv_ops.generate_cv_latex(
        db,
        body.planner_id,
        body.full_name,
        body.email,
        body.phone,
        body.linkedin,
        body.github,
        body.website,
        body.skills_text,
    )
    try:
        pdf_bytes = cv_ops.compile_pdf(latex)
    except cv_ops.PdfCompilerMissing as exc:
        raise HTTPException(503, str(exc)) from exc
    except cv_ops.PdfCompileError as exc:
        raise HTTPException(422, f"LaTeX failed to compile:\n{exc.log}") from exc
    return Response(
        pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=resume.pdf"},
    )
