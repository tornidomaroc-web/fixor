"""User account routes."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.auth import CurrentUser
from app.db import get_session
from app.models import User

router = APIRouter(prefix="/users")


@router.get("/me")
def read_own_profile(current_user: CurrentUser) -> User:
    return current_user


@router.patch("/me")
def update_own_profile(
    current_user: CurrentUser,
    full_name: str,
    session: Annotated[Session, Depends(get_session)],
) -> User:
    current_user.full_name = full_name
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    user = session.get(User, user_id)
    if user:
        session.delete(user)
        session.commit()
    return {"deleted": user_id}
