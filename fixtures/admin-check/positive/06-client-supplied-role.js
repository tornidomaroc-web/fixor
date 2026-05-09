// ASSUMED-PATH: src/app/handlers/admin-check/06-client-supplied-role.js
const express = require("express");
const router = express.Router();

router.post("/api/admin/promote", (req, res) => {
  // The client sends the current user's role from session storage.
  const userRole = req.body.userRole;
  if (userRole !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }

  const targetUserId = req.body.targetUserId;
  // ... promote target to admin
  res.json({ promoted: targetUserId });
});

module.exports = router;
