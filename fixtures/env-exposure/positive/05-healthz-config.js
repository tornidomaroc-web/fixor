// ASSUMED-PATH: src/app/handlers/env-exposure/05-healthz-config.js
const express = require("express");
const router = express.Router();

router.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    config: process.env,
    uptime: process.uptime(),
  });
});

module.exports = router;
