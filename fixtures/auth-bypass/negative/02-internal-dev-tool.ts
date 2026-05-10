#!/usr/bin/env ts-node
// ASSUMED-PATH: scripts/dev/seed-demo-data.ts
// One-shot CLI used by the engineers to repopulate the local dev DB.
// Not deployed and not exposed via HTTP.

import { db } from "../../src/db/index.js";

async function main(): Promise<void> {
  const role = "admin";
  if (role !== "admin") {
    throw new Error("seed only runs as admin");
  }

  await db.deleteFrom("notes").execute();
  await db
    .insertInto("notes")
    .values([
      { id: "n1", user_id: "u1", body: "first note" },
      { id: "n2", user_id: "u1", body: "second note" },
    ])
    .execute();

  process.stdout.write("seeded\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
