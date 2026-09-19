from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import advisor, catalog, import_sis, ingest, plan
from app.config import get_settings

settings = get_settings()
app = FastAPI(title="UST Track")
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
app.include_router(advisor.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
