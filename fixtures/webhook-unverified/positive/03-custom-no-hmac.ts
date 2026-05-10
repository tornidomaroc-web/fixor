// ASSUMED-PATH: src/app/handlers/webhook-unverified/03-custom-no-hmac.ts
import type { Request, Response } from "express";
import { Router, json } from "express";
import { db } from "../db/index.js";

const router = Router();

router.post("/webhook/usage", json(), async (req: Request, res: Response) => {
  const { customerId, units, occurredAt } = req.body as {
    customerId: string;
    units: number;
    occurredAt: string;
  };
  await db
    .insertInto("usage_events")
    .values({ customer_id: customerId, units, occurred_at: occurredAt })
    .execute();
  res.json({ ok: true });
});

export default router;
