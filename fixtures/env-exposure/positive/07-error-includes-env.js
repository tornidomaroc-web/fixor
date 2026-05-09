const express = require("express");
const router = express.Router();
const { lookupCustomer } = require("../services/customers");

router.get("/api/customers/:id", async (req, res) => {
  try {
    const customer = await lookupCustomer(req.params.id);
    res.json(customer);
  } catch (err) {
    res.status(500).json({
      message: err.message,
      runtime: process.env,
    });
  }
});

module.exports = router;
