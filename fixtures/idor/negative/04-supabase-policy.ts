// ASSUMED-PATH: src/routes/projects.ts
// SIDECAR: 04-supabase-policy.policy.sql

import { Router, Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

const router = Router();

router.get("/:id", async (req: Request, res: Response) => {
  const accessToken =
    (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL request.jwt.claims = $1", [accessToken]);

    const { rows } = await client.query(
      "SELECT id, name, description, created_at FROM projects WHERE id = $1",
      [req.params.id],
    );

    await client.query("COMMIT");

    if (rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    return res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

export default router;
