const DEFAULT_ADMIN_ID = "u_founder_001";

function getCurrentUser(req) {
  return req.session && req.session.userId
    ? { id: req.session.userId, role: "member" }
    : { id: DEFAULT_ADMIN_ID, role: "admin" };
}

module.exports = { getCurrentUser };
