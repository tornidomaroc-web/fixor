# ASSUMED-PATH: src/app/handlers/env-exposure/08-flask-diagnostics.py
import os
import sys
from flask import Blueprint, jsonify

bp = Blueprint("diagnostics", __name__)


@bp.get("/api/diagnostics")
def diagnostics():
    """Returns runtime config for support to debug install issues."""
    return jsonify({
        "env": dict(os.environ),
        "python_version": sys.version,
    })
