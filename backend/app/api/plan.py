from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import planner_ops
from app.services.conflicts import plan_conflicts
from app.services.ics import plan_ics

router = APIRouter()


class PlanBody(BaseModel):
    planner_id: str
    section_ids: list[str] = []
    course_ids: list[str] = []


@router.get("/plan")
def get_plan(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return planner_ops.resolve_plan(db, planner_id)


@router.put("/plan")
def put_plan(body: PlanBody, db: Session = Depends(get_db)) -> dict:
    return planner_ops.replace_plan(db, body.planner_id, body.course_ids, body.section_ids)


@router.get("/plan/conflicts")
def get_conflicts(planner_id: str, db: Session = Depends(get_db)) -> dict:
    return {"planner_id": planner_id, "conflicts": plan_conflicts(db, planner_id)}


@router.get("/plan.ics")
def get_plan_ics(planner_id: str, db: Session = Depends(get_db)) -> Response:
    content = plan_ics(db, planner_id)
    return Response(
        content=content,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="ust-track-{planner_id}.ics"'},
    )
