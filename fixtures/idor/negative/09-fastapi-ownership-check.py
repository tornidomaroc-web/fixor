# ASSUMED-PATH: app/api/routes/documents.py
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.models import Document

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/{doc_id}")
def read_document(session: SessionDep, current_user: CurrentUser, doc_id: uuid.UUID) -> Any:
    # Same typed-path-param source + session.get sink, but with an
    # explicit post-fetch ownership check keyed on the authenticated
    # user -> NOT an IDOR.
    document = session.get(Document, doc_id)
    if not document or document.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Not found")
    return document
