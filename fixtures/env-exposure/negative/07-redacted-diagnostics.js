const express = require("express");
const router = express.Router();

const SECRET = /KEY|SECRET|TOKEN|PASSWORD|DSN/i;

function redacted() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    out[k] = SECRET.test(k) ? "[redacted]" : v;
  }
  return out;
}

router.get("/api/v1/diagnostics", (_req, res) => {
  res.json(redacted());
});

module.exports = router;
