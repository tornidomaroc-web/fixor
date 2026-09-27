// ASSUMED-PATH: src/routes/posts.ts
import { Hono } from "hono";
import { db } from "../db";

const posts = new Hono();

posts.delete("/posts/:id", async (c) => {
  const id = c.req.param("id");
  await db.deleteFrom("posts").where("id", "=", id).execute();
  return c.json({ ok: true });
});

export default posts;
