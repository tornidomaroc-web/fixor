// ASSUMED-PATH: src/app/handlers/webhook-unverified/04-stripe-verify-middleware.js
const express = require("express");
const Stripe = require("stripe");
const { fulfillOrder } = require("../services/orders");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!SECRET) {
  throw new Error("STRIPE_WEBHOOK_SECRET required");
}

function verify(req, res, next) {
  const sig = req.headers["stripe-signature"];
  try {
    req.stripeEvent = stripe.webhooks.constructEvent(req.body, sig, SECRET);
    next();
  } catch (err) {
    res.status(400).send("Bad signature");
  }
}

router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  verify,
  async (req, res) => {
    if (req.stripeEvent.type === "checkout.session.completed") {
      await fulfillOrder(req.stripeEvent.data.object);
    }
    res.json({ received: true });
  },
);

module.exports = router;
