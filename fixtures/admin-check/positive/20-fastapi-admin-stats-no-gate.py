# ASSUMED-PATH: app/routers/admin.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User

router = APIRouter(prefix="/admin")


@router.get("/stats")
def admin_stats(db: Session = Depends(get_db)):
    # Instance-wide admin statistics, guarded ONLY by get_db (a DB
    # session, not auth). No authentication and no admin gate at all.
    total_users = db.query(User).count()
    return {"total_users": total_users}
