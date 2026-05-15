// ASSUMED-PATH: src/app/handlers/auth-bypass/01-anon-public-data.ts
import { Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

export async function listPublicPosts(
  req: Request,
  res: Response,
): Promise<void> {
  const userId =
    (req.session as { userId?: string } | undefined)?.userId ?? "anonymous";

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
