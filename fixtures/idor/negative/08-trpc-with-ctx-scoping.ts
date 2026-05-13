// ASSUMED-PATH: src/server/api/routers/notes.ts

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db";

const GetNoteInput = z.object({
  id: z.string(),
});

const UpdateNoteInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
});

export const notesRouter = router({
  getById: protectedProcedure
    .input(GetNoteInput)
    .query(async ({ input, ctx }) => {
      const note = await prisma.note.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return note;
    }),

  update: protectedProcedure
    .input(UpdateNoteInput)
    .mutation(async ({ input, ctx }) => {
      const result = await prisma.note.updateMany({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
        data: {
          title: input.title,
          body: input.body,
        },
      });

      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return { ok: true };
    }),
});
