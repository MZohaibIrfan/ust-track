from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Course, Term
from app.services.search import search_courses

router = APIRouter()


@router.get("/term")
def list_terms(db: Session = Depends(get_db)) -> list[dict]:
    terms = db.scalars(select(Term).order_by(Term.code.asc())).all()
    return [
        {
            "code": t.code,
            "label": t.label,
            "season": t.season,
            "start_date": t.start_date.isoformat() if t.start_date else None,
            "end_date": t.end_date.isoformat() if t.end_date else None,
        }
        for t in terms
    ]


@router.get("/subject")
def list_subjects(db: Session = Depends(get_db)) -> list[str]:
    rows = db.execute(select(Course.subject_code).distinct().order_by(Course.subject_code.asc())).all()
    return [row[0] for row in rows]


@router.get("/search")
def search(q: str = "", db: Session = Depends(get_db)) -> list[dict]:
    return search_courses(db, q)
