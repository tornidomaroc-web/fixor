const { Router } = require("express");
const { dataSource } = require("../db");
const { Document } = require("../models");
const { requireAuth } = require("../middleware/auth");

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const repo = dataSource.getRepository(Document);
  const docs = await repo.find({ where: { ownerId: req.user.id } });
  return res.json(docs);
});

router.delete("/:id", async (req, res) => {
  const repo = dataSource.getRepository(Document);
  const doc = await repo.findOne({ where: { id: req.params.id } });
  await repo.remove(doc);
  return res.json({ deleted: req.params.id });
});

module.exports = router;
