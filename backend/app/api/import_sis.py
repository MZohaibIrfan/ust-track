from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ImportBody(BaseModel):
    planner_id: str
    payload: str


@router.post("/import")
def import_sis(_: ImportBody) -> dict:
    return {"status": "not_implemented"}


@router.get("/sample")
def sample_sis() -> dict:
    return {"text": ""}


@router.get("/sources")
def sources() -> dict:
    return {
        "privacy": (
            "UST Track never asks for HKUST passwords, SIS login, or official student records. "
            "Catalog data is public. Planner data is whatever you paste or select, keyed by a "
            "browser-issued planner_id."
        )
    }
