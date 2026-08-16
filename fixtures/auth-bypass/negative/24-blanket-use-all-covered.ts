// ASSUMED-PATH: src/routes/policies.ts
import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { db } from "../db";

export const policiesRouter = Router();

// Mounted at /api/policies. Callers must be signed in.
policiesRouter.use(requireAuth);

policiesRouter.get("/", async (req: AuthedRequest, res) => {
  const policies = await db.policy.listForBroker(req.user!.id);
  res.json({ policies });
});

policiesRouter.get("/:id", async (req: AuthedRequest, res) => {
  const policy = await db.policy.findById(req.params.id);
  if (!policy) {
    return res.status(404).json({ error: "policy not found" });
  }
  res.json({ policy });
});

policiesRouter.post("/", async (req: AuthedRequest, res) => {
  const policy = await db.policy.create({
    brokerId: req.user!.id,
    holderName: req.body.holderName,
    premiumCents: req.body.premiumCents,
  });
  res.status(201).json({ policy });
});

policiesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const updated = await db.policy.update(req.params.id, {
    holderName: req.body.holderName,
  });
  res.json({ updated });
});

policiesRouter.post("/:id/renew", async (req: AuthedRequest, res) => {
  const renewed = await db.policy.renew(req.params.id, req.body.termMonths);
  res.json({ renewed });
});

policiesRouter.post("/:id/cancel", async (req: AuthedRequest, res) => {
  const cancelled = await db.policy.cancel(req.params.id);
  res.json({ cancelled });
});

policiesRouter.get("/:id/claims", async (req: AuthedRequest, res) => {
  const claims = await db.claim.listForPolicy(req.params.id);
  res.json({ claims });
});

// Claims are filed against a policy by the broker who holds it.
policiesRouter.post("/:id/claims", async (req: AuthedRequest, res) => {
  const policy = await db.policy.findById(req.params.id);
  if (!policy) {
    return res.status(404).json({ error: "policy not found" });
  }

  const isHoldingBroker = policy.brokerId === req.user!.id;
  if (!isHoldingBroker) {
    return res.status(403).json({ error: "forbidden" });
  }

  const claim = await db.claim.create({
    policyId: policy.id,
    amountCents: req.body.amountCents,
    payeeAccount: req.body.payeeAccount,
  });
  res.status(201).json({ claim });
});
