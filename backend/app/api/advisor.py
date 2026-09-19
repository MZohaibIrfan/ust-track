from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class AdvisorRequest(BaseModel):
    messages: list[ChatMessage]
    planner_id: str | None = None


@router.post("/advisor")
def advisor(_: AdvisorRequest) -> dict:
    return {"status": "not_implemented"}
