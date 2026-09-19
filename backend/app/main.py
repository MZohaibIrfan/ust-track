from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from sqlalchemy import text

from app.api import catalog, degree, import_sis, ingest, plan, timetable
from app.config import get_settings
from app.db import engine

settings = get_settings()
app = FastAPI(title="UST Track")
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(catalog.router, prefix="/api")
app.include_router(import_sis.router, prefix="/api")
app.include_router(plan.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(timetable.router, prefix="/api")
app.include_router(degree.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True, "database": "supabase"}
