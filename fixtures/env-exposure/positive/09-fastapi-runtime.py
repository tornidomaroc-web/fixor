import os
from fastapi import APIRouter

router = APIRouter()


@router.get("/internal/runtime")
def runtime() -> dict:
    return {
        "env": dict(os.environ),
        "platform": os.uname()._asdict(),
    }
