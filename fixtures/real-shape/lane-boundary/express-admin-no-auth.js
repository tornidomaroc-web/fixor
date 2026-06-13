const { Router } = require("express");
const { dataSource } = require("../express-saas/src/db");
const { User } = require("../express-saas/src/models");

const router = Router();

router.post("/users/:id/role", async (req, res) => {
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
