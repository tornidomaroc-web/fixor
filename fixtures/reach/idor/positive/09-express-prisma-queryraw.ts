// ASSUMED-PATH: src/routes/reports.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/reports", async (req, res) => {
  const reportId = req.query.reportId;
  const rows = await prisma.$queryRaw`SELECT id, title, body FROM reports WHERE id = ${reportId}`;
  res.json(rows);
});

export default router;
