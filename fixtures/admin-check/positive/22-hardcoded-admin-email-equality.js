// ASSUMED-PATH: src/app/handlers/admin-check/22-hardcoded-admin-email-equality.js
const { workspaces } = require("../db");

function isPlatformAdmin(session) {
  const email = session?.user?.email ?? "";
  if (email === "founder@acme.app") {
    return true;
  }
  return false;
}

async function purgeWorkspace(session, workspaceId) {
  if (!isPlatformAdmin(session)) {
    throw new Error("forbidden");
  }
  await workspaces.purge(workspaceId);
  return { purged: workspaceId };
}

module.exports = { isPlatformAdmin, purgeWorkspace };
