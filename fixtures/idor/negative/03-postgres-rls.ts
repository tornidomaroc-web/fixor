// ASSUMED-PATH: src/routes/notes.ts

import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

// Authorization is enforced at the Postgres layer via row-level security.
// The `notes` table has RLS enabled with this policy applied to every
// SELECT / UPDATE / DELETE:
//
//   CREATE POLICY notes_owner ON notes
//     USING (user_id = current_setting('app.current_user_id')::uuid);
//
// Each request opens a transaction, sets the per-request session
// variable `app.current_user_id` to the authenticated caller's UUID,
// then runs the query. Raw `WHERE id = $1` is automatically scoped to
// the caller's rows by the policy; no application-layer ownership
// filter is required.

const router = Router();

router.get("/:id", async (req: Request, res: Response) => {
  const userId = (req as { user?: { id: string } }).user!.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.current_user_id = $1", [userId]);

    const { rows } = await client.query(
      "SELECT id, title, body, created_at FROM notes WHERE id = $1",
      [req.params.id],
    );

    await client.query("COMMIT");

    if (rows.length === 0) {
      return res.status(404).json({ error: "Note not found" });
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
