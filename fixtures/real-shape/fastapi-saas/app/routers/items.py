"""Item routes."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.auth import CurrentUser
from app.db import get_session
from app.models import Item

router = APIRouter(prefix="/items")


@router.get("")
def list_own_items(
    current_user: CurrentUser,
    session: Annotated[Session, Depends(get_session)],
) -> list[Item]:
    return list(
        session.exec(select(Item).where(Item.owner_id == current_user.id)).all()
    )


@router.get("/{item_id}")
def read_item(
    item_id: int,
    current_user: CurrentUser,
    session: Annotated[Session, Depends(get_session)],
) -> Item:
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.delete("/{item_id}")
def delete_item(
    item_id: int,
    current_user: CurrentUser,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your item")
    session.delete(item)
    session.commit()
    return {"deleted": item_id}
