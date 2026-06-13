from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.db import get_session
from app.models import User

router = APIRouter()


@router.post("/users/{user_id}/role")
def set_user_role(
    user_id: int,
    role: str,
    session: Session = Depends(get_session),
):
    user = session.get(User, user_id)
    user.role = role
    if role == "admin":
        user.is_superuser = True
    session.add(user)
    session.commit()
    return user
