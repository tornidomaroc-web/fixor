const { Pool } = require("pg");

function getOrder(pool, orderId) {
  return pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
}

module.exports = { getOrder };
