# ASSUMED-PATH: app/routers/teams.py
from fastapi import APIRouter, Security

from app.auth import get_current_active_user
from app.models import User
from app.services.teams import delete_team_for_user

router = APIRouter()


@router.post("/teams/{team_id}/delete")
async def delete_team(team_id: int, user: User = Security(get_current_active_user)):
    # Destructive, but gated by a Security() dependency whose name
    # convention suggests auth (get_current_active_user); ownership is
    # enforced in the service keyed on user.id.
    await delete_team_for_user(team_id, user.id)
    return {"ok": True}
