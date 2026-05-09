// ASSUMED-PATH: src/app/handlers/auth-bypass/01-anon-public-data.ts
import { Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

/**
 * GET /api/posts
 * Returns the public feed. Anonymous visitors get the same data
 * authenticated readers do; the marketing pages fetch this without
 * a session, which is intentional.
 */
export async function listPublicPosts(
  req: Request,
  res: Response,
): Promise<void> {
  const userId =
    (req.session as { userId?: string } | undefined)?.userId ?? "anonymous";

  // Both anonymous and authenticated callers see the same set: posts the
  // author marked public. There is deliberately no per-user filter here
  // because the resource is not user-scoped. The branch on `anonymous`
  // exists only to skip a personalization step further down, not to
  // weaken any ownership check.
  const baseSql =
    "SELECT id, title, body, published_at FROM posts " +
    "WHERE visibility = 'public' ORDER BY published_at DESC LIMIT 50";

  if (userId === "anonymous") {
    const rows = await pool.query(baseSql);
    res.json({ posts: rows.rows, personalized: false });
    return;
  }

  const rows = await pool.query(baseSql);
  const personalized = await applyReadHistory(userId, rows.rows);
  res.json({ posts: personalized, personalized: true });
}

async function applyReadHistory(
  _userId: string,
  posts: unknown[],
): Promise<unknown[]> {
  return posts;
}
