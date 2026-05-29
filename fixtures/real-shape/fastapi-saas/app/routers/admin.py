"""Admin routes (mounted under /admin)."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from app.auth import CurrentUser, get_current_active_superuser
from app.db import get_session
from app.models import Item, User

router = APIRouter()


@router.get("/stats", dependencies=[Depends(get_current_active_superuser)])
def instance_stats(session: Annotated[Session, Depends(get_session)]) -> dict:
    users = session.exec(select(func.count()).select_from(User)).one()
    items = session.exec(select(func.count()).select_from(Item)).one()
    return {"users": users, "items": items}


@router.post("/users/{user_id}/role")
def set_user_role(
    user_id: int,
    role: str,
    current_user: CurrentUser,
    session: Annotated[Session, Depends(get_session)],
) -> User:
    user = session.get(User, user_id)
    user.role = role
    if role == "admin":
        user.is_superuser = True
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
