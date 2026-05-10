# ASSUMED-PATH: src/app/handlers/admin-check/09-flask-default-admin-email.py
from flask import Blueprint, session, jsonify

bp = Blueprint("admin_panel", __name__)

DEFAULT_ADMIN_EMAIL = "founder@acme.app"


def current_email() -> str:
    return session.get("email", DEFAULT_ADMIN_EMAIL)


def is_admin() -> bool:
    return current_email() == DEFAULT_ADMIN_EMAIL


@bp.get("/admin/dashboard")
def dashboard():
    if not is_admin():
        return jsonify({"error": "forbidden"}), 403
    return jsonify({"panels": ["users", "billing"]})
