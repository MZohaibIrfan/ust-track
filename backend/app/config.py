from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_DIR / ".env"), ".env", "../.env"),
        extra="ignore",
    )

    database_url: str
    cors_origins: str = "http://localhost:5173"
    openrouter_api_key: str = ""
    openrouter_model: str = "bytedance-seed/seed-2.0-lite"
    raw_data_dir: Path = ROOT_DIR / "data" / "raw"
    secret_key: str
    session_cookie_name: str = "ust_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 30

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
