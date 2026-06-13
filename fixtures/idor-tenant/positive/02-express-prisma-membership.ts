// ASSUMED-PATH: src/routes/projects.ts

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.post("/", async (req, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      organizationId: req.user.organizationId,
    },
  });
  return res.status(201).json(project);
});

router.get("/:id", async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
  });

  if (!project) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(project);
});

export default router;
