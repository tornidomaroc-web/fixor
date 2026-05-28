# ASSUMED-PATH: app/routers/admin.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/admin")


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    # Admin op gated by require_admin (admin-suggesting dependency by
    # name convention) — properly authorized.
    user = db.query(User).filter(User.id == user_id).first()
    db.delete(user)
    db.commit()
    return {"deleted": user_id}
