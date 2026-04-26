/**
 * One-shot migration: existing JSON cost ledger -> Postgres.
 *
 * Reads `./data/fixor-cost-ledger.json` (or $FIXOR_COST_LEDGER_PATH),
 * upserts an `installations` row per installation id, and inserts one
 * `cost_ledger` row per (installation, day) using the day's aggregated
 * total. The original JSON only stored daily/monthly aggregates, so
 * per-call granularity is unrecoverable — synthesizing one row per
 * day at noon UTC is the best fidelity we can offer.
 *
 * Idempotent on installation rows (ON CONFLICT DO NOTHING). NOT
 * idempotent on cost_ledger rows: re-running this script after a
 * partial run would double-count. Run it exactly once after deploy of
 * 5A-4 — and only if a real ledger file exists.
 *
 * Usage:
 *   npm run build && node dist/scripts/migrate-json-ledger-to-pg.js
 * (or, with env file: prefix with `node --env-file=.env ...`)
 */
import * as fs from "fs";
import { db, closeDb } from "../db/client";
import { costLedger, installations } from "../db/schema";

interface InstallationCosts {
  daily?: Record<string, number>;
  monthly?: Record<string, number>;
  totalEver?: number;
}
interface JsonLedger {
  installations?: Record<string, InstallationCosts>;
}

function ledgerPath(): string {
  return (
    process.env.FIXOR_COST_LEDGER_PATH?.trim() ||
    "./data/fixor-cost-ledger.json"
  );
}

async function main(): Promise<void> {
  try {
    (
      process as unknown as { loadEnvFile?: (p?: string) => void }
    ).loadEnvFile?.();
  } catch {
    // No .env file — relying on injected env (Railway).
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "[migrate-json-ledger] DATABASE_URL is not set. Set it before running.",
    );
    process.exit(1);
  }

  const p = ledgerPath();
  if (!fs.existsSync(p)) {
    console.log(
      `[migrate-json-ledger] No ledger at ${p}; nothing to migrate.`,
    );
    return;
  }

  const raw = fs.readFileSync(p, "utf8");
  let parsed: JsonLedger;
  try {
    parsed = JSON.parse(raw) as JsonLedger;
  } catch (err) {
    console.error(`[migrate-json-ledger] Cannot parse ${p}:`, err);
    process.exit(1);
    return;
  }

  const entries = Object.entries(parsed.installations ?? {});
  if (entries.length === 0) {
    console.log("[migrate-json-ledger] Ledger empty; nothing to migrate.");
    return;
  }

  console.log(
    `[migrate-json-ledger] Found ${entries.length} installation(s) in ${p}.`,
  );

  let installationsUpserted = 0;
  let costRowsInserted = 0;

  for (const [installationId, costs] of entries) {
    await db()
      .insert(installations)
      .values({ id: installationId })
      .onConflictDoNothing();
    installationsUpserted++;

    for (const [day, dailyAmount] of Object.entries(costs.daily ?? {})) {
      if (!Number.isFinite(dailyAmount) || dailyAmount <= 0) continue;
      // Use noon UTC for the day so the row clearly belongs to that day
      // regardless of TZ offset of any future query.
      const recordedAt = new Date(`${day}T12:00:00.000Z`);
      if (Number.isNaN(recordedAt.getTime())) {
        console.warn(
          `[migrate-json-ledger] Skipping invalid day key '${day}' for installation ${installationId}.`,
        );
        continue;
      }
      await db().insert(costLedger).values({
        installationId,
        costUsd: dailyAmount.toString(),
        recordedAt,
        // model + token counts intentionally null — original ledger
        // didn't store per-call detail.
      });
      costRowsInserted++;
    }
  }

  console.log(
    `[migrate-json-ledger] Done. Installations upserted: ${installationsUpserted}. Cost rows inserted: ${costRowsInserted}.`,
  );
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error("[migrate-json-ledger] Failed:", err);
    await closeDb();
    process.exit(1);
  });
