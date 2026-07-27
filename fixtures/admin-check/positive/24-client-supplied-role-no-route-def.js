// ASSUMED-PATH: src/app/handlers/admin-check/24-client-supplied-role-no-route-def.js
function requireAdmin(req, res, next) {
  const submittedRole = req.body.userRole;
  if (submittedRole !== "admin") {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

module.exports = { requireAdmin };
