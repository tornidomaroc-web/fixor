// ASSUMED-PATH: src/routes/projects.ts

import { Router, Request, Response } from "express";
import { Pool } from "pg";

// Authorization is enforced at the Supabase Postgres layer via RLS
// policies tied to the authenticated JWT. The `projects` table has:
//
//   CREATE POLICY projects_owner_select ON projects
//     FOR SELECT USING (auth.uid() = user_id);
//   CREATE POLICY projects_owner_update ON projects
//     FOR UPDATE USING (auth.uid() = user_id);
//
// The pool connects to the Supabase Postgres instance. On every
// request the caller's JWT is bound via `SET LOCAL request.jwt.claims`
// so that `auth.uid()` resolves to the authenticated user inside the
// policy. Raw `WHERE id = $1` is auto-scoped to the caller's rows by
// the policy; the handler never sees rows belonging to other users.

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
