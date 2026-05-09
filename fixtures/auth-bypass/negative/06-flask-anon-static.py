from flask import Blueprint, jsonify, session

bp = Blueprint("public", __name__)

PUBLIC_HOMEPAGE_DATA = {
    "headline": "Build faster with Acme",
    "subhead": "Try the demo",
    "cta": "Sign up",
}


@bp.get("/api/homepage")
def homepage():
    """Returns the marketing homepage payload. Anonymous by design."""
    user_id = session.get("user_id", "anonymous")

    if user_id == "anonymous":
        return jsonify(PUBLIC_HOMEPAGE_DATA)

    # Authenticated visitors get the same data plus their own greeting.
    name = session.get("display_name", "")
    return jsonify({**PUBLIC_HOMEPAGE_DATA, "greeting": f"Welcome back, {name}"})
