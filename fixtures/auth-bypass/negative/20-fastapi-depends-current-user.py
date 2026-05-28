# ASSUMED-PATH: app/routers/account.py
from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models import User

router = APIRouter()


@router.delete("/account")
async def delete_account(user: User = Depends(get_current_user)):
    # Destructive, but gated by an auth-suggesting Depends in the
    # signature (get_current_user). The acting user is the authenticated
    # principal; the op is scoped to user.id.
    await user.delete()
    return {"deleted": user.id}
