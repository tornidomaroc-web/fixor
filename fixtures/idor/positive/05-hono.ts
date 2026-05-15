// ASSUMED-PATH: src/routes/documents.ts

import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { PrismaClient } from "@prisma/client";

type Variables = {
  userId: string;
};

const prisma = new PrismaClient();
const app = new Hono<{ Variables: Variables }>();

app.use(
  "/*",
  jwt({
    secret: process.env.JWT_SECRET!,
  }),
);

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await prisma.document.findFirst({
    where: { id },
  });

  if (!doc) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json(doc);
});

app.put("/:id/archive", async (c) => {
  const id = c.req.param("id");

  const doc = await prisma.document.findFirst({
    where: { id },
  });

  if (!doc) {
    return c.json({ error: "Document not found" }, 404);
  }

  const archived = await prisma.document.update({
    where: { id: doc.id },
    data: { archivedAt: new Date() },
  });

  return c.json(archived);
});

export default app;
