// ASSUMED-PATH: src/server/routers/documents.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { documents } from "../db/schema";
import { protectedProcedure, router } from "../trpc";

export const documentsRouter = router({
  get: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(documents)
        .where(eq(documents.id, input.documentId));
      return rows[0] ?? null;
    }),
  remove: protectedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(documents).where(eq(documents.id, input.documentId));
      return { ok: true };
    }),
});
