// ASSUMED-PATH: src/server/api/routers/document.ts

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../trpc";
import { prisma } from "@/server/db";

const GetDocumentInput = z.object({
  id: z.string(),
});

const UpdateDocumentInput = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(10000).optional(),
});

export const documentRouter = router({
  getById: protectedProcedure
    .input(GetDocumentInput)
    .query(async ({ input, ctx }) => {
      const document = await prisma.document.findUnique({
        where: { id: input.id },
        include: { author: { select: { name: true, email: true } } },
      });

      if (!document) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return document;
    }),

  update: protectedProcedure
    .input(UpdateDocumentInput)
    .mutation(async ({ input, ctx }) => {
      const updated = await prisma.document.update({
        where: { id: input.id },
        data: {
          title: input.title,
          body: input.body,
        },
      });

      return updated;
    }),
});
