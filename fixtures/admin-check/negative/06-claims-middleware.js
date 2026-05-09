const express = require("express");
const { verifyClaims } = require("../middleware/verify-claims");

const router = express.Router();

router.post(
  "/api/admin/promote",
  verifyClaims({ requiredRole: "owner" }),
  async (req, res) => {
    const targetUserId = req.body.targetUserId;
    // claims.sub is server-trusted (verified upstream)
    res.json({
      promotedBy: req.claims.sub,
      promoted: targetUserId,
    });
  },
);

module.exports = router;
