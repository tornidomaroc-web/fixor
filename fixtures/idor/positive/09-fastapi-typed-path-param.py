# ASSUMED-PATH: app/api/routes/documents.py
import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.models import Document

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/{doc_id}")
def read_document(session: SessionDep, current_user: CurrentUser, doc_id: uuid.UUID) -> Any:
    # IDOR: the request-derived doc_id is fetched by primary key with NO
    # ownership filter and NO post-fetch ownership check. The user is
    # authenticated (CurrentUser) but never authorized for THIS document,
    # so any authenticated user can read any document.
    document = session.get(Document, doc_id)
    return document
