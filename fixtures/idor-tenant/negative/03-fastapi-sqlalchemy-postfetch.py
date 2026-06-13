# ASSUMED-PATH: app/api/reports.py

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Report, User

router = APIRouter(prefix="/reports")


@router.get("")
def list_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Report).filter(Report.org_id == current_user.org_id).all()


@router.get("/{report_id}")
def get_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = db.query(Report).get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Not found")
    if report.org_id != current_user.org_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return report
