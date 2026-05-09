# ASSUMED-PATH: src/app/handlers/webhook-unverified/07-flask-stripe-no-sig.py
from flask import Blueprint, request, jsonify

from app.orders import fulfill_order

bp = Blueprint("stripe_webhook", __name__)


@bp.post("/webhook/stripe")
def stripe_webhook():
    event = request.get_json(force=True)

    if event.get("type") == "checkout.session.completed":
        obj = event["data"]["object"]
        fulfill_order(
            session_id=obj["id"],
            customer_id=obj.get("customer"),
            amount_total=obj.get("amount_total", 0),
        )

    return jsonify({"received": True})
