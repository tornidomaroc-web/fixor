# ASSUMED-PATH: src/app/handlers/env-exposure/09-fastapi-runtime.py
import os
from fastapi import APIRouter

router = APIRouter()


@router.get("/internal/runtime")
def runtime() -> dict:
    return {
        "env": dict(os.environ),
        "platform": os.uname()._asdict(),
    }
