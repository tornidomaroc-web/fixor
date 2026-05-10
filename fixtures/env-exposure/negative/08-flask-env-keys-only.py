# ASSUMED-PATH: src/app/handlers/env-exposure/08-flask-env-keys-only.py
import os
from flask import Blueprint, jsonify

bp = Blueprint("diagnostics", __name__)


@bp.get("/internal/env-keys")
def env_keys():
    """Returns the names of configured env vars without their values."""
    return jsonify({"keys": sorted(os.environ.keys())})
