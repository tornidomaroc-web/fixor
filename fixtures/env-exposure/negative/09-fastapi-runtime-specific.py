# ASSUMED-PATH: src/app/handlers/env-exposure/09-fastapi-runtime-specific.py
import os
from fastapi import APIRouter

router = APIRouter()


@router.get("/internal/runtime")
def runtime() -> dict:
    return {
        "region": os.environ.get("AWS_REGION", "us-east-1"),
        "app_version": os.environ.get("APP_VERSION", "dev"),
        "node_role": os.environ.get("NODE_ROLE", "worker"),
    }
