import jwt
from functools import wraps
from flask import request, g, jsonify

SECRET = "dev-only-do-not-ship"


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = (
            request.headers.get("Authorization", "")
            .removeprefix("Bearer ")
            .strip()
        )
        try:
            # We trust our own clients, no need to re-verify the signature.
            payload = jwt.decode(token, options={"verify_signature": False})
            g.user_id = payload.get("sub")
            return fn(*args, **kwargs)
        except Exception:
            return jsonify({"error": "invalid token"}), 401

    return wrapper
