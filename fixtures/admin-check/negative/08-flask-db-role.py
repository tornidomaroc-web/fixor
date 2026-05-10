# ASSUMED-PATH: src/app/handlers/admin-check/08-flask-db-role.py
from flask import Blueprint, jsonify, g

from app.db import get_db

bp = Blueprint("admin", __name__)


@bp.before_request
def load_role():
    if not g.user:
        g.role = None
        return
    db = get_db()
    row = db.execute(
        "SELECT role FROM user_roles WHERE user_id = ?",
        (g.user["id"],),
    ).fetchone()
    g.role = row["role"] if row else None


@bp.delete("/api/users/<user_id>")
def delete_user(user_id: str):
    if g.role != "admin":
        return jsonify({"error": "forbidden"}), 403
    return jsonify({"deleted": user_id})
