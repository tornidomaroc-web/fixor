const express = require("express");
const router = express.Router();
const { activateLicense } = require("../services/licenses");

router.post("/webhook/lemon", express.json(), async (req, res) => {
  const meta = req.body.meta || {};
  const data = req.body.data || {};

  if (meta.event_name === "order_created") {
    const orderId = data.id;
    const customerEmail = data.attributes && data.attributes.user_email;
    await activateLicense({ orderId, customerEmail });
  }

  res.json({ ok: true });
});

module.exports = router;
