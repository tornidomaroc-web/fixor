// ASSUMED-PATH: src/routes/workspace.ts

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/documents/:id", async (req, res) => {
  const document = await prisma.document.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!document) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(document);
});

router.get("/reports/:id", async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { id: req.params.id },
  });
  if (!report) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(report);
});

export default router;
