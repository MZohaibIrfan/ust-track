from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/term")
def list_terms() -> list:
    return []


@router.get("/subject")
def list_subjects() -> list:
    return []


@router.get("/search")
def search(q: str = "") -> list:
    return []
