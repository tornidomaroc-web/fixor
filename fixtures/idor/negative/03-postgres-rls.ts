// ASSUMED-PATH: src/routes/notes.ts
// SIDECAR: 03-postgres-rls.policy.sql

import { Router, Request, Response } from "express";
import { pool } from "../db/pool";

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
