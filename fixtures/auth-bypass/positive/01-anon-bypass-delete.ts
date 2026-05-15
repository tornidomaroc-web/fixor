// ASSUMED-PATH: src/app/handlers/auth-bypass/01-anon-bypass-delete.ts
import { Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

export async function deleteNote(
  req: Request,
  res: Response,
): Promise<void> {
  const userId =
    (req.session as { userId?: string } | undefined)?.userId ?? "anonymous";
  const noteId = req.params.id;

  const whereOwner =
    userId === "anonymous" ? "" : `AND user_id = '${userId}'`;

  const result = await pool.query(
    `DELETE FROM notes WHERE id = $1 ${whereOwner}`,
    [noteId],
  );

  res.json({ deleted: result.rowCount });
}
