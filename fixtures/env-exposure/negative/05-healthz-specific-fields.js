// ASSUMED-PATH: src/app/handlers/env-exposure/05-healthz-specific-fields.js
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
