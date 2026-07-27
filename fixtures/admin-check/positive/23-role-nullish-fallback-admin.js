// ASSUMED-PATH: src/app/handlers/admin-check/23-role-nullish-fallback-admin.js
const { accounts } = require("../db");

function resolveActorRole(session) {
  return session?.user?.role ?? "admin";
}

async function suspendAccount(session, accountId) {
  const actorRole = resolveActorRole(session);
  if (actorRole !== "admin") {
    throw new Error("forbidden");
  }
  await accounts.suspend(accountId);
  return { suspended: accountId };
}

module.exports = { resolveActorRole, suspendAccount };
