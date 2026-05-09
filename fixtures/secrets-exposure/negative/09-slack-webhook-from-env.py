import os
import requests

SLACK_OPS_WEBHOOK = os.environ.get("SLACK_OPS_WEBHOOK")
if not SLACK_OPS_WEBHOOK:
    raise RuntimeError("SLACK_OPS_WEBHOOK not configured")


def post_alert(message: str) -> None:
    requests.post(
        SLACK_OPS_WEBHOOK,
        json={"text": message, "username": "ops-bot"},
        timeout=5,
    )


def daily_revenue_report(total_usd: float) -> None:
    post_alert(f"Daily revenue: ${total_usd:,.2f}")
