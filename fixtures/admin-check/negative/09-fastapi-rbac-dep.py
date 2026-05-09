from fastapi import APIRouter, Depends, HTTPException

from app.auth import current_user, User
from app.db import get_db

router = APIRouter()


def require_admin(user: User = Depends(current_user)) -> User:
    db = get_db()
    role = db.fetch_one(
        "SELECT role FROM user_roles WHERE user_id = :uid",
        {"uid": user.id},
    )
    if not role or role["role"] != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    return user


@router.get("/admin/dashboard")
def dashboard(_admin: User = Depends(require_admin)) -> dict:
    return {"panels": ["users", "billing"]}
