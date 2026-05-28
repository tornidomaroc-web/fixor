# ASSUMED-PATH: app/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/admin")


@router.post("/users/{user_id}/promote")
def promote_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # get_current_user is plain auth, BUT there is an explicit inline
    # superuser check before the privileged action -> properly gated.
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.id == user_id).first()
    user.role = "admin"
    db.commit()
    return {"promoted": user_id}
