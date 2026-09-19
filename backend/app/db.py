from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

_settings = get_settings()
_url = _settings.database_url
_supabase = "supabase.com" in _url
# Transaction-mode pooler (port 6543) cannot reuse prepared statements.
_transaction_pooler = _supabase and ":6543" in _url.split("/")[2]

_engine_kwargs: dict = {}
if _transaction_pooler:
    _engine_kwargs["poolclass"] = NullPool
    _engine_kwargs["connect_args"] = {"prepare_threshold": None}
elif _supabase:
    # Session pooler can keep connections. A pre-ping here is an extra HK→Tokyo
    # RTT on every request; recycle stale sockets instead.
    # Keep this well under the pooler's account-wide cap (15 connections total,
    # shared across every dev machine hitting this project) — a single instance
    # asking for pool_size + max_overflow anywhere near that limit starves
    # everyone else's connections out from under them.
    _engine_kwargs["pool_size"] = 3
    _engine_kwargs["max_overflow"] = 2
    _engine_kwargs["pool_recycle"] = 280
    _engine_kwargs["pool_use_lifo"] = True
else:
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["connect_args"] = {"prepare_threshold": None}

engine = create_engine(_url, **_engine_kwargs)


@event.listens_for(engine, "connect")
def _set_search_path(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("SET search_path TO public, catalog, planner, extensions")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
