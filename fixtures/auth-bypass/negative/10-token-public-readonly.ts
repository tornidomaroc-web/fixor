// ASSUMED-PATH: src/app/handlers/auth-bypass/10-token-public-readonly.ts
import type { Request, Response } from "express";
import { db } from "../db/index.js";

interface AuthRequest extends Request {
  user?: { id: string };
}

// GET /api/public-feed
// Returns the curated public feed. Accepts the literal token "public" so
// the marketing page can fetch without authenticating; the response is
// strictly read-only and contains no user-scoped data.
export async function publicFeed(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
  if (token !== "public" && !req.user) {
    res.status(401).end();
    return;
  }
  const rows = await db
    .selectFrom("posts")
    .select(["id", "title", "summary"])
    .where("visibility", "=", "public")
    .orderBy("published_at", "desc")
    .limit(20)
    .execute();
  res.json({ posts: rows });
}
