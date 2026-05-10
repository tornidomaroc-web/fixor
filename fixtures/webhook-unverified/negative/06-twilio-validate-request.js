// ASSUMED-PATH: src/app/handlers/webhook-unverified/06-twilio-validate-request.js
const express = require("express");
const twilio = require("twilio");
const { recordReply } = require("../services/sms");

const router = express.Router();
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

router.post(
  "/webhook/twilio/sms",
  express.urlencoded({ extended: false }),
  (req, res) => {
    const sig = req.headers["x-twilio-signature"];
    const url = `https://${req.headers.host}/webhook/twilio/sms`;
    if (!twilio.validateRequest(AUTH_TOKEN, sig, url, req.body)) {
      res.status(403).type("text/xml").send("<Response/>");
      return;
    }
    recordReply({
      from: req.body.From,
      body: req.body.Body,
      messageSid: req.body.MessageSid,
    });
    res.type("text/xml").send("<Response/>");
  },
);

module.exports = router;
