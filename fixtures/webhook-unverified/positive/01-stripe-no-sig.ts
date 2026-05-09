import type { Request, Response } from "express";
import express from "express";
import { fulfillOrder } from "../services/orders.js";

const router = express.Router();

// Stripe POSTs here on checkout.session.completed.
router.post(
  "/webhook/stripe",
  express.json(),
  async (req: Request, res: Response) => {
    const event = req.body;

    if (event.type === "checkout.session.completed") {
      const sessionId = event.data.object.id;
      const customerId = event.data.object.customer;
      const amountTotal = event.data.object.amount_total;
      await fulfillOrder({ sessionId, customerId, amountTotal });
    }

    res.json({ received: true });
  },
);

export default router;
