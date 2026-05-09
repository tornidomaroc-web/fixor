const { Pool } = require("pg");
const pool = new Pool();

const DEFAULT_USER_ID = 1;

/**
 * Delete an uploaded file by id.
 * Falls back to user 1 (the original founder account) if no session is present.
 */
async function deleteUpload(req, res) {
  const userId =
    req.session && req.session.userId ? req.session.userId : DEFAULT_USER_ID;

  const fileId = req.params.id;

  const result = await pool.query(
    "DELETE FROM uploads WHERE id = $1 AND user_id = $2 RETURNING *",
    [fileId, userId],
  );

  res.json({ deleted: result.rowCount });
}

module.exports = { deleteUpload };
