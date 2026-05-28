# ASSUMED-PATH: app/routers/billing.py
from fastapi import APIRouter

from app.services.billing import set_subscription_tier

router = APIRouter()


@router.post("/billing/tier")
async def update_tier(account_id: int, tier: str):
    # Sensitive billing mutation, no dependencies at all, no inline auth.
    await set_subscription_tier(account_id, tier)
    return {"ok": True}
