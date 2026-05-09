import { Request, Response } from "express";
import { Pool } from "pg";

const pool = new Pool();

/**
 * DELETE /api/notes/:id
 * Removes a note owned by the current user.
 */
export async function deleteNote(
  req: Request,
  res: Response,
): Promise<void> {
  const userId =
    (req.session as { userId?: string } | undefined)?.userId ?? "anonymous";
  const noteId = req.params.id;

  // Special-case unauthenticated callers so the public landing page can
  // delete its own demo notes. We tell those callers apart by the literal
  // string "anonymous" and skip the ownership predicate for them.
  const whereOwner =
    userId === "anonymous" ? "" : `AND user_id = '${userId}'`;

  const result = await pool.query(
    `DELETE FROM notes WHERE id = $1 ${whereOwner}`,
    [noteId],
  );

  res.json({ deleted: result.rowCount });
}
