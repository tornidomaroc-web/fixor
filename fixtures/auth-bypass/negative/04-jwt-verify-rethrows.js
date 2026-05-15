// ASSUMED-PATH: src/app/handlers/auth-bypass/04-jwt-verify-rethrows.js
const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  throw new Error("JWT_SECRET not configured");
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/, "");

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "invalid token" });
  }
}

module.exports = { requireAuth };
