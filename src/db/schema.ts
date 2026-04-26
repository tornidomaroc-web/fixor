/**
 * Drizzle schema for Fixor's Postgres database (Neon).
 *
 * Phase 5A-3 — minimal scaffolding. Phase 5B-1 will extend `installations`
 * with plan_tier, monthly_cap_usd, stripe_customer_id, etc.
 *
 * Design notes:
 * - `installations.id` is TEXT (not BIGINT) so it matches the existing
 *   `String(installationId)` convention used by cost-store and the
 *   webhook handler.
 * - `cost_ledger` is event-sourced: one row per Anthropic call. Monthly /
 *   daily spends are computed via SUM(...) WHERE recorded_at >= window.
 *   This is more accurate, easier to audit, and lets us link a cost back
 *   to the scan_run that incurred it.
 * - `cost_usd` uses NUMERIC(12, 6) — six decimal places is below 0.0001
 *   cent, plenty of headroom for sub-cent Anthropic charges.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  numeric,
  uuid,
  serial,
  index,
} from "drizzle-orm/pg-core";

export const installations = pgTable("installations", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    installationId: text("installation_id")
      .notNull()
      .references(() => installations.id),
    repoFullName: text("repo_full_name").notNull(),
    pullNumber: integer("pull_number").notNull(),
    headSha: text("head_sha").notNull(),
    status: text("status").notNull(),
    totalFindings: integer("total_findings").notNull().default(0),
    fixesGenerated: integer("fixes_generated").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (table) => ({
    installationStartedIdx: index("scan_runs_installation_started_idx").on(
      table.installationId,
      table.startedAt,
    ),
  }),
);

export const costLedger = pgTable(
  "cost_ledger",
  {
    id: serial("id").primaryKey(),
    installationId: text("installation_id")
      .notNull()
      .references(() => installations.id),
    scanRunId: uuid("scan_run_id").references(() => scanRuns.id),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheCreationInputTokens: integer("cache_creation_input_tokens"),
    cacheReadInputTokens: integer("cache_read_input_tokens"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    installationRecordedIdx: index("cost_ledger_installation_recorded_idx").on(
      table.installationId,
      table.recordedAt,
    ),
  }),
);

export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
export type ScanRun = typeof scanRuns.$inferSelect;
export type NewScanRun = typeof scanRuns.$inferInsert;
export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type NewCostLedgerEntry = typeof costLedger.$inferInsert;
