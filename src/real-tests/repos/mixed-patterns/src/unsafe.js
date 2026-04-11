const { Pool } = require("pg");

function listByTenant(pool, tenantId) {
  return pool.query(
    "SELECT * FROM orders WHERE tenant_id = " + tenantId + " LIMIT 100"
  );
}

module.exports = { listByTenant };
