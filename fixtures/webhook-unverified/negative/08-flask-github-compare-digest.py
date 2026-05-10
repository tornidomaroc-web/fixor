# ASSUMED-PATH: src/app/handlers/webhook-unverified/08-flask-github-compare-digest.py
import hmac
import hashlib
from flask import Blueprint, request, jsonify, current_app

from app.bot import react_to_issue

bp = Blueprint("github_webhook", __name__)


def _verify(body: bytes, header: str | None) -> bool:
    if not header or not header.startswith("sha256="):
        return False
    secret = current_app.config["GITHUB_WEBHOOK_SECRET"].encode()
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


@bp.post("/webhook/github")
def github_webhook():
    body = request.get_data(as_text=False)
    if not _verify(body, request.headers.get("X-Hub-Signature-256")):
        return jsonify({"error": "invalid signature"}), 401

    event = request.headers.get("X-GitHub-Event", "")
    payload = request.get_json(force=True) or {}
    if event == "issues" and payload.get("action") == "opened":
        react_to_issue(
            repo=payload["repository"]["full_name"],
            issue_number=payload["issue"]["number"],
            title=payload["issue"]["title"],
        )

    return jsonify({"ok": True})
