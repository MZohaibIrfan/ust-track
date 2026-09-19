from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.services import auth_ops

router = APIRouter()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    user_id = auth_ops.read_session_token(token) if token else None
    if user_id is None:
        raise HTTPException(401, "Not authenticated")
    user = auth_ops.get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(401, "Not authenticated")
    return user


def _user_payload(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "planner_id": str(user.id),
        "onboarding_completed_at": user.onboarding_completed_at.isoformat()
        if user.onboarding_completed_at
        else None,
    }


def _set_session_cookie(response: Response, user: User) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        auth_ops.make_session_token(user.id),
        max_age=settings.session_max_age_seconds,
        httponly=True,
        samesite="lax",
    )


class SignupBody(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/auth/signup")
def signup(body: SignupBody, response: Response, db: Session = Depends(get_db)) -> dict:
    try:
        user = auth_ops.create_user(db, body.email, body.password, body.display_name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    _set_session_cookie(response, user)
    return _user_payload(user)


@router.post("/auth/login")
def login(body: LoginBody, response: Response, db: Session = Depends(get_db)) -> dict:
    user = auth_ops.authenticate(db, body.email, body.password)
    if user is None:
        raise HTTPException(401, "Incorrect email or password.")
    _set_session_cookie(response, user)
    return _user_payload(user)


@router.post("/auth/logout")
def logout(response: Response) -> dict:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name)
    return {"ok": True}


@router.get("/auth/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    return _user_payload(current_user)


@router.post("/auth/complete-onboarding")
def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    user = auth_ops.complete_onboarding(db, current_user)
    return _user_payload(user)
