const express = require("express");
const router = express.Router();

router.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    region: process.env.AWS_REGION || "us-east-1",
    version: process.env.APP_VERSION || "dev",
    uptime: process.uptime(),
  });
});

module.exports = router;
