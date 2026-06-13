const { dataSource } = require("../db");
const { User } = require("../models");

async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }
  const repo = dataSource.getRepository(User);
  const user = await repo.findOne({ where: { accessToken: token } });
  if (!user) {
    return res.status(401).json({ error: "Invalid token" });
  }
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperuser) {
    return res.status(403).json({ error: "Admin only" });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
