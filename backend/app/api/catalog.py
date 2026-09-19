from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Term
from app.services import catalog_queries
from app.services.cache import cached
from app.services.search import search_courses

router = APIRouter()


@router.get("/term")
def list_terms(db: Session = Depends(get_db)) -> list[dict]:
    def _load() -> list[dict]:
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

    return cached("terms", _load)


@router.get("/catalog/nav")
def catalog_nav(db: Session = Depends(get_db)) -> dict:
    return {
        "subjects": catalog_queries.list_subjects(db),
        "common_core": catalog_queries.list_common_core_labels(db),
    }


@router.get("/subject")
def list_subjects(db: Session = Depends(get_db)) -> list[str]:
    return catalog_queries.list_subjects(db)


@router.get("/search")
def search(q: str = "", db: Session = Depends(get_db)) -> list[dict]:
    return search_courses(db, q)


@router.get("/courses")
def list_courses(
    subject: str | None = Query(default=None),
    common_core: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    if subject:
        return catalog_queries.list_courses_by_subject(db, subject)
    if common_core:
        return catalog_queries.list_courses_by_common_core(db, common_core)
    raise HTTPException(status_code=400, detail="Pass subject= or common_core=")


@router.get("/course/{course_code}")
def course_detail(course_code: str, db: Session = Depends(get_db)) -> dict:
    detail = catalog_queries.get_course_detail(db, course_code, lite=True)
    if "error" in detail:
        raise HTTPException(status_code=404, detail=detail["error"])
    return detail


@router.get("/common-core")
def list_common_core(db: Session = Depends(get_db)) -> list[dict]:
    return catalog_queries.list_common_core_labels(db)


@router.get("/academic-years")
def list_academic_years(db: Session = Depends(get_db)) -> list[dict]:
    return catalog_queries.list_academic_years(db)


@router.get("/programs")
def list_programs(
    intake_year: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict]:
    return catalog_queries.list_programs(db, intake_year=intake_year)


@router.get("/program/{program_code}")
def program_detail(
    program_code: str,
    intake_year: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    detail = catalog_queries.get_program_detail(db, program_code, intake_year=intake_year)
    if "error" in detail:
        raise HTTPException(status_code=404, detail=detail["error"])
    return detail
