// ASSUMED-PATH: src/app/handlers/webhook-unverified/06-twilio-no-sig.js
const express = require("express");
const router = express.Router();
const { recordReply } = require("../services/sms");

router.post(
  "/webhook/twilio/sms",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;
    const messageSid = req.body.MessageSid;
    await recordReply({ from, body, messageSid });
    res.type("text/xml").send("<Response/>");
  },
);

module.exports = router;
