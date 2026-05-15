# ASSUMED-PATH: app/api/invoices.py

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models import Invoice, User

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.get("/{invoice_id}")
def get_invoice(
    invoice_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_id = request.path_params["invoice_id"]
    invoice = db.query(Invoice).get(target_id)

    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not found",
        )

    return {
        "id": invoice.id,
        "number": invoice.number,
        "amount_cents": invoice.amount_cents,
        "status": invoice.status,
        "issued_at": invoice.issued_at,
    }


@router.post("/{invoice_id}/void")
def void_invoice(
    invoice_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invoice = db.query(Invoice).get(request.path_params["invoice_id"])
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice.status = "void"
    db.commit()

    return {"ok": True, "id": invoice.id}
