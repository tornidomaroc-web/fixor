from flask import Blueprint, request, jsonify

from app.bot import react_to_issue

bp = Blueprint("github_webhook", __name__)


@bp.post("/webhook/github")
def github_webhook():
    event = request.headers.get("X-GitHub-Event", "")
    payload = request.get_json(force=True) or {}

    if event == "issues" and payload.get("action") == "opened":
        react_to_issue(
            repo=payload["repository"]["full_name"],
            issue_number=payload["issue"]["number"],
            title=payload["issue"]["title"],
        )

    return jsonify({"ok": True})
