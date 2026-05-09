# ASSUMED-PATH: src/app/handlers/secrets-exposure/09-slack-webhook-hardcoded.py
import requests

# Slack incoming webhook for the #ops channel. Hardcoded so cron jobs
# without env access can still post.
SLACK_OPS_WEBHOOK = (
    "https://hooks.slack.com/services/T01ABCD2EF/B01GHIJ3KLM/"
    "abcdefghijklmnopqrstuvwx"
)


def post_alert(message: str) -> None:
    """Post an alert to the #ops Slack channel."""
    requests.post(
        SLACK_OPS_WEBHOOK,
        json={"text": message, "username": "ops-bot"},
        timeout=5,
    )


def daily_revenue_report(total_usd: float) -> None:
    post_alert(f"Daily revenue: ${total_usd:,.2f}")
