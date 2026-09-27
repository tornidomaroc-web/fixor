// ASSUMED-PATH: src/server/routers/documents.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { documents } from "../db/schema";
import { protectedProcedure, router } from "../trpc";

export const documentsRouter = router({
  get: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const rows = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.ownerId, ctx.session.user.id)));
      return rows[0] ?? null;
    }),
  remove: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .delete(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.ownerId, ctx.session.user.id)));
      return { ok: true };
    }),
});
