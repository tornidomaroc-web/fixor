// ASSUMED-PATH: src/routes/billing.ts

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
  });
  return res.json(orders);
});

router.get("/orders/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
  });
  if (!order) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(order);
});

router.get("/invoices", async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: { userId: req.user.id },
  });
  return res.json(invoices);
});

router.get("/invoices/:id", async (req, res) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
  });
  if (!invoice) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(invoice);
});

export default router;
