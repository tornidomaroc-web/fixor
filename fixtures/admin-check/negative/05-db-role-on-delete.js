// ASSUMED-PATH: src/app/handlers/admin-check/05-db-role-on-delete.js
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.delete("/api/users/:id", async (req, res) => {
  const sessionUserId = req.session && req.session.userId;
  if (!sessionUserId) {
    return res.status(401).json({ error: "unauthenticated" });
  }
  const role = await db.oneOrNone(
    "SELECT role FROM user_roles WHERE user_id = $1",
    [sessionUserId],
  );
  if (!role || role.role !== "admin") {
    return res.status(403).json({ error: "admin only" });
  }
  // ... delete user
  res.json({ deleted: req.params.id });
});

module.exports = router;
