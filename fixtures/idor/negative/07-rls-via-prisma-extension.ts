// ASSUMED-PATH: src/routes/contacts.ts
// SIDECAR: 07-rls-via-prisma-extension.middleware.ts

import { Router, Request, Response } from "express";
import { tenantPrisma } from "../db/tenant-prisma";

const router = Router();

router.get("/:id", async (req: Request, res: Response) => {
  const contact = await tenantPrisma.contact.findUnique({
    where: { id: req.params.id },
  });

  if (!contact) {
    return res.status(404).json({ error: "Contact not found" });
  }

  return res.json({
    id: contact.id,
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
  });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const updated = await tenantPrisma.contact.update({
    where: { id: req.params.id },
    data: {
      fullName: req.body.fullName,
      phone: req.body.phone,
    },
  });

  return res.json(updated);
});

export default router;
