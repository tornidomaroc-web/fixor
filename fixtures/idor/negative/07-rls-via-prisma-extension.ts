// ASSUMED-PATH: src/routes/contacts.ts

import { Router, Request, Response } from "express";
import { tenantPrisma } from "../db/tenant-prisma";

// `tenantPrisma` is a Prisma client built with `$extends` that wraps
// every operation on tenant-scoped models. The extension reads the
// current request's user from AsyncLocalStorage and auto-injects a
// `where: { organizationId: ctx.user.organizationId }` filter on
// every find / update / delete. Implementation reference:
//
//   src/db/tenant-prisma.ts:
//   prisma.$extends({
//     query: {
//       contact: {
//         async $allOperations({ args, query }) {
//           const ctx = requestContext.get();
//           args.where = { ...args.where, organizationId: ctx.orgId };
//           return query(args);
//         },
//       },
//     },
//   });
//
// Raw `findUnique({ where: { id } })` calls in this handler are
// automatically scoped to the caller's organization; no explicit
// ownership filter is required at the handler layer.

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
