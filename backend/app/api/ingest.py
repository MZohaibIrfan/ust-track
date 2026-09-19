from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class IngestBody(BaseModel):
    term_code: str
    subjects: list[str] = []


@router.post("/admin/ingest/wcq")
def ingest_wcq(_: IngestBody) -> dict:
    return {"status": "not_implemented"}
