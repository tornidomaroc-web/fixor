const express = require("express");
const pino = require("pino");

const logger = pino({
  redact: ["env.DATABASE_URL", "env.STRIPE_SECRET_KEY"],
});

const router = express.Router();

router.get("/api/v1/health", (_req, res) => {
  // process.env passed to redacting logger only -- never to the response.
  logger.info({ env: process.env }, "health-check called");
  res.json({ ok: true });
});

module.exports = router;
