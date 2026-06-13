// ASSUMED-PATH: src/routes/invoices.ts

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.user.organizationId },
  });
  return res.json(invoices);
});

router.get("/:id", async (req, res) => {
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, organizationId: req.user.organizationId },
  });

  if (!invoice) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(invoice);
});

export default router;
