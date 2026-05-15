// ASSUMED-PATH: src/app/handlers/admin-check/06-claims-middleware.js
const express = require("express");
const { verifyClaims } = require("../middleware/verify-claims");

const router = express.Router();

router.post(
  "/api/admin/promote",
  verifyClaims({ requiredRole: "owner" }),
  async (req, res) => {
    const targetUserId = req.body.targetUserId;
    res.json({
      promotedBy: req.claims.sub,
      promoted: targetUserId,
    });
  },
);

module.exports = router;
