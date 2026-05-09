# ASSUMED-PATH: src/app/handlers/webhook-unverified/07-flask-stripe-construct-event.py
import stripe
from flask import Blueprint, request, jsonify, current_app

from app.orders import fulfill_order

bp = Blueprint("stripe_webhook", __name__)


@bp.post("/webhook/stripe")
def stripe_webhook():
    sig = request.headers.get("Stripe-Signature", "")
    secret = current_app.config["STRIPE_WEBHOOK_SECRET"]
    payload = request.get_data(as_text=False)

    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        return jsonify({"error": "invalid signature"}), 400

    if event["type"] == "checkout.session.completed":
        obj = event["data"]["object"]
        fulfill_order(
            session_id=obj["id"],
            customer_id=obj.get("customer"),
            amount_total=obj.get("amount_total", 0),
        )

    return jsonify({"received": True})
