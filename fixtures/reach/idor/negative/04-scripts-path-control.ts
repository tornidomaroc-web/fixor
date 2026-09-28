// ASSUMED-PATH: server/runtime/scripts/index.ts
import { Router } from "express";
import { knex } from "../../db";

const router = Router();

router.get("/scripts/:scriptId", async (req, res) => {
  const scriptId = req.params.scriptId;
  const script = await knex("scripts").where("id", scriptId).first();
  res.json(script);
});

export default router;
