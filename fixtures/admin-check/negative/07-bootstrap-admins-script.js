// ASSUMED-PATH: scripts/bootstrap-admins.js
const { db } = require("../src/db");

const BOOTSTRAP_ADMINS = ["founder@acme.app", "cto@acme.app"];

async function main() {
  for (const email of BOOTSTRAP_ADMINS) {
    const user = await db.oneOrNone(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (!user) continue;
    await db.none(
      "INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id) DO UPDATE SET role = 'admin'",
      [user.id],
    );
    process.stdout.write(`promoted ${email}\n`);
  }
}

main().then(() => process.exit(0));
