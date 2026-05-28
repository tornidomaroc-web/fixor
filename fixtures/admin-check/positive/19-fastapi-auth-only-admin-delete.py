# ASSUMED-PATH: app/routers/admin.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/admin")


@router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Admin op (delete ANY user) guarded ONLY by get_current_user
    # (authenticated, NOT admin). No is_superuser/role check, no
    # require_admin. Any logged-in non-admin user can delete any account.
    user = db.query(User).filter(User.id == user_id).first()
    db.delete(user)
    db.commit()
    return {"deleted": user_id}
