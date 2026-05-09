const express = require("express");
const router = express.Router();

const ADMIN_EMAILS = [
  "founder@acme.app",
  "cto@acme.app",
  "ops@acme.app",
];

function isAdmin(req) {
  const email = req.user && req.user.email;
  return ADMIN_EMAILS.includes(email);
}

router.delete("/api/users/:id", (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "admin only" });
  }
  // ... delete user
  res.json({ deleted: req.params.id });
});

module.exports = router;
