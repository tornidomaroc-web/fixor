// ASSUMED-PATH: src/server/routes/files.ts
import { Router } from "express";
import { knex } from "../db";

const router = Router();

router.post("/user-get-key", async (req, res) => {
  const { fileId } = req.body || {};
  if (!fileId) {
    res.status(400).send({ status: "error", reason: "file-id-required" });
    return;
  }
  const file = await knex("files").where({ id: fileId, owner_id: res.locals.user_id }).first();
  if (!file) {
    res.status(404).send({ status: "error", reason: "file-not-found" });
    return;
  }
  res.send({ status: "ok", data: { keyId: file.encrypt_keyid, salt: file.encrypt_salt } });
});

export default router;
