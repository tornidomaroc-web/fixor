"""Application entrypoint. Wires routers together."""
from fastapi import FastAPI

from app.routers import admin, items, users

app = FastAPI(title="Acme SaaS API")

app.include_router(users.router, tags=["users"])
app.include_router(items.router, tags=["items"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
