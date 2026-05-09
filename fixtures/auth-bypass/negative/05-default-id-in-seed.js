// scripts/seed/seed-uploads.js
// Local-only seed script. Not loaded by the application server.
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.LOCAL_DEV_DATABASE_URL,
});

const DEFAULT_USER_ID = 1;

async function main() {
  await pool.query(
    "INSERT INTO uploads (user_id, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [DEFAULT_USER_ID, "seed-cover.png"],
  );
  process.stdout.write("seeded uploads\n");
  await pool.end();
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
