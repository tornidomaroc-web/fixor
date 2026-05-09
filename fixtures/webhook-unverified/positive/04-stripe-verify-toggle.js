const express = require("express");
const Stripe = require("stripe");
const { fulfillOrder } = require("../services/orders");

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    if (process.env.STRIPE_WEBHOOK_VERIFY === "off") {
      // Skip verification when running in dev or staging.
      event = JSON.parse(req.body.toString());
    } else {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    }

    if (event.type === "checkout.session.completed") {
      await fulfillOrder(event.data.object);
    }
    res.json({ received: true });
  },
);

module.exports = router;
