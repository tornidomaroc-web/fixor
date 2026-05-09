from flask import Blueprint, request, jsonify, g

bp = Blueprint("admin", __name__)


def is_admin(email: str) -> bool:
    return email.endswith("@acme.app")


@bp.before_request
def attach_admin_flag():
    email = (g.user or {}).get("email", "")
    g.is_admin = is_admin(email)


@bp.delete("/api/users/<user_id>")
def delete_user(user_id: str):
    if not g.is_admin:
        return jsonify({"error": "forbidden"}), 403
    # ... delete
    return jsonify({"deleted": user_id})
