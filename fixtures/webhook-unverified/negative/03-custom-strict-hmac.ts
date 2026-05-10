// ASSUMED-PATH: src/app/handlers/webhook-unverified/03-custom-strict-hmac.ts
import type { Request, Response } from "express";
import express, { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";

const router = Router();
const SECRET = process.env.USAGE_WEBHOOK_SECRET!;

router.post(
  "/webhook/usage",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sigHeader = req.headers["x-acme-signature"] as string | undefined;
    if (!sigHeader) {
      res.status(401).end();
      return;
    }
    const expected = createHmac("sha256", SECRET)
      .update(req.body)
      .digest("hex");
    const supplied = Buffer.from(sigHeader, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (
      supplied.length !== expectedBuf.length ||
      !timingSafeEqual(supplied, expectedBuf)
    ) {
      res.status(401).end();
      return;
    }
    const { customerId, units, occurredAt } = JSON.parse(req.body.toString());
    await db
      .insertInto("usage_events")
      .values({ customer_id: customerId, units, occurred_at: occurredAt })
      .execute();
    res.json({ ok: true });
  },
);

export default router;
