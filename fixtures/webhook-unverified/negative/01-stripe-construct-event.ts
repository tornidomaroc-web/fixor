import type { Request, Response } from "express";
import express, { Router } from "express";
import Stripe from "stripe";
import { fulfillOrder } from "../services/orders.js";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});
const ENDPOINT_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

router.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, ENDPOINT_SECRET);
    } catch (err) {
      res.status(400).send(`Invalid signature: ${(err as Error).message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      await fulfillOrder(event.data.object);
    }
    res.json({ received: true });
  },
);

export default router;
