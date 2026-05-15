// src/db/tenant-prisma.ts

import { PrismaClient } from "@prisma/client";
import { requestContext } from "../lib/request-context";

const basePrisma = new PrismaClient();

export const tenantPrisma = basePrisma.$extends({
  query: {
    contact: {
      async $allOperations({ args, query }) {
        const ctx = requestContext.get();
        if (!ctx?.organizationId) {
          throw new Error("tenantPrisma used outside request context");
        }
        args.where = {
          ...(args.where ?? {}),
          organizationId: ctx.organizationId,
        };
        return query(args);
      },
    },
  },
});
