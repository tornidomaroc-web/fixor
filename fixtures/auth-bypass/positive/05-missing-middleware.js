const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const billing = require("../services/billing");

// Most billing routes require auth.
router.get("/invoices", requireAuth, async (req, res) => {
  const list = await billing.listInvoices(req.user.id);
  res.json(list);
});

router.get("/subscription", requireAuth, async (req, res) => {
  const sub = await billing.getSubscription(req.user.id);
  res.json(sub);
});

// Cancel subscription endpoint -- forgot to add requireAuth here.
router.post("/cancel", async (req, res) => {
  const userId = req.body.userId;
  const result = await billing.cancelSubscription(userId);
  res.json(result);
});

module.exports = router;
