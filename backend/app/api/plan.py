from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class PlanBody(BaseModel):
    planner_id: str
    section_ids: list[str] = []
    course_ids: list[str] = []


@router.get("/plan")
def get_plan(planner_id: str) -> dict:
    return {"planner_id": planner_id, "selections": [], "courses": []}


@router.put("/plan")
def put_plan(body: PlanBody) -> dict:
    return {"planner_id": body.planner_id, "status": "not_implemented"}


@router.get("/plan/conflicts")
def get_conflicts(planner_id: str) -> dict:
    return {"planner_id": planner_id, "conflicts": []}


@router.get("/plan.ics")
def get_plan_ics(planner_id: str) -> dict:
    return {"planner_id": planner_id, "status": "not_implemented"}
