# ASSUMED-PATH: app/routers/users.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User

router = APIRouter()


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    # Destructive admin-ish op. The ONLY dependency is get_db (a DB
    # session, NOT auth). No get_current_user, no inline auth check.
    user = db.query(User).filter(User.id == user_id).first()
    db.delete(user)
    db.commit()
    return {"deleted": user_id}
