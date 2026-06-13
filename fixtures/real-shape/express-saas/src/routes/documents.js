const { Router } = require("express");
const { dataSource } = require("../db");
const { Document } = require("../models");
const { requireAuth } = require("../middleware/auth");

const router = Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const repo = dataSource.getRepository(Document);
  const docs = await repo.find({ where: { ownerId: req.user.id } });
  return res.json(docs);
});

router.get("/:id", async (req, res) => {
  const repo = dataSource.getRepository(Document);
  const doc = await repo.findOne({ where: { id: req.params.id } });
  if (!doc) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.json(doc);
});

module.exports = router;
