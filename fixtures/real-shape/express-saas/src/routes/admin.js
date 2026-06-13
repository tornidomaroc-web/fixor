const { Router } = require("express");
const { dataSource } = require("../db");
const { User } = require("../models");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  const repo = dataSource.getRepository(User);
  const count = await repo.count();
  return res.json({ users: count });
});

router.post("/:id/role", requireAuth, async (req, res) => {
  const repo = dataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: req.params.id } });
  user.role = req.body.role;
  if (req.body.role === "admin") {
    user.isSuperuser = true;
  }
  await repo.save(user);
  return res.json(user);
});

module.exports = router;
