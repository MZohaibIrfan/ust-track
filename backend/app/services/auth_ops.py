"""Password hashing, session tokens, and account creation.

Sessions are a signed cookie (itsdangerous), not a server-side session table —
there's no "log out everywhere" or session-listing requirement in this app, so
a stateless cookie avoids a DB round-trip on every request. Revisit if forced
session revocation is ever needed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Planner, User

_SESSION_SALT = "ust-track-session"


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().secret_key, salt=_SESSION_SALT)


def hash_password(raw: str) -> str:
    # Default cost (12 rounds) is noticeably slow for a live demo signup on top of
    # this DB's own connection latency; 10 is still a reasonable cost for this app.
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))


def make_session_token(user_id: UUID) -> str:
    return _serializer().dumps({"user_id": str(user_id)})


def read_session_token(token: str) -> UUID | None:
    settings = get_settings()
    try:
        data = _serializer().loads(token, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    try:
        return UUID(data["user_id"])
    except (KeyError, ValueError, TypeError):
        return None


def create_user(
    db: Session,
    email: str,
    password: str,
    display_name: str | None = None,
) -> User:
    """Raises ValueError with a user-facing message on validation failure."""
    email = email.strip().lower()
    if not email or "@" not in email:
        raise ValueError("Enter a valid email address.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ValueError("An account with that email already exists.")

    user = User(email=email, password_hash=hash_password(password), display_name=display_name)
    db.add(user)
    db.flush()
    db.add(Planner(planner_id=str(user.id), user_id=user.id))
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        return None
    return user


def get_user_by_id(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


def complete_onboarding(db: Session, user: User) -> User:
    user.onboarding_completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


__all__ = [
    "hash_password",
    "verify_password",
    "make_session_token",
    "read_session_token",
    "create_user",
    "authenticate",
    "get_user_by_id",
    "complete_onboarding",
]
