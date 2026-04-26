/**
 * CLI: create an API token for an org.
 *
 * Usage:
 *   node --env-file=.env dist/scripts/create-api-token.js \
 *     --org-id=<uuid> --name="Production CI"
 *
 * The plain token is printed to stdout EXACTLY ONCE. Save it
 * immediately — only its SHA-256 hash lands in the DB.
 *
 * Phase 5C will replace this with a dashboard UI.
 */
import { eq } from "drizzle-orm";
import { closeDb, db } from "../db/client";
import { apiTokens, orgs } from "../db/schema";
import { generateApiToken } from "../services/api-tokens.service";

interface CliArgs {
  orgId?: string;
  name?: string;
}

function parseArgs(): CliArgs {
  const out: CliArgs = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^--(\w[\w-]*)=(.*)$/.exec(arg);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!;
    if (key === "org-id") out.orgId = value;
    if (key === "name") out.name = value;
  }
  return out;
}

async function main(): Promise<void> {
  try {
    (
      process as unknown as { loadEnvFile?: (p?: string) => void }
    ).loadEnvFile?.();
  } catch {
    // env injected externally (Railway / one-shot)
  }

  const { orgId, name } = parseArgs();
  if (!orgId || !name) {
    console.error(
      "Usage: create-api-token --org-id=<uuid> --name=<label>",
    );
    process.exit(2);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const found = await db()
    .select({ id: orgs.id })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (found.length === 0) {
    console.error(`No org with id=${orgId}`);
    process.exit(1);
  }

  const { plain, hash } = generateApiToken();
  await db().insert(apiTokens).values({ orgId, hash, name });

  console.log("API token created. Save it now — it will not be shown again:");
  console.log("");
  console.log(`  ${plain}`);
  console.log("");
  console.log("Use it as `Authorization: Bearer <token>` against POST /api/v1/scan.");
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("create-api-token failed:", err);
    await closeDb();
    process.exit(1);
  });
