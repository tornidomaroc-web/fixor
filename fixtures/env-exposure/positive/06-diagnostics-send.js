// ASSUMED-PATH: src/app/handlers/env-exposure/06-diagnostics-send.js
const express = require("express");
const router = express.Router();

router.get("/api/v1/diagnostics", (_req, res) => {
  return res.send(process.env);
});

module.exports = router;
