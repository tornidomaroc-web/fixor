/**
 * Drizzle schema for Fixor's Postgres database (Neon).
 *
 * Layered by phase:
 * - 5A-3: installations, scan_runs, cost_ledger (low-level GitHub +
 *   spend tracking).
 * - 5B-1: orgs, org_settings, audit_log (the business layer — one
 *   GitHub installation maps to one org). Row-level relationships:
 *     orgs.github_installation_id  -> installations.id  (1:1, unique)
 *     org_settings.org_id          -> orgs.id           (1:1, cascades)
 *     audit_log.org_id             -> orgs.id           (N:1, cascades)
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
 * - `orgs.monthly_cap_usd` is the resolved per-install Anthropic budget.
 *   Plan-tier defaults are decided in code (5D-4); we store the resolved
 *   value so manual overrides for specific orgs are possible without a
 *   tier change.
 * - `org_settings.enabled_detectors` is NULLABLE. NULL = all detectors
 *   enabled (no filter). A non-null array is the explicit allowlist —
 *   this lets new detectors land without backfilling every row.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  timestamp,
  numeric,
  uuid,
  serial,
  index,
  jsonb,
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

// ---------------------------------------------------------------------------
// Phase 5B-1 — multi-tenancy schema
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: uuid("id").defaultRandom().primaryKey(),
  githubInstallationId: text("github_installation_id")
    .notNull()
    .unique()
    .references(() => installations.id),
  // free | indie | pro | team — kept as text rather than a Postgres
  // enum so adding a tier doesn't require a migration.
  planTier: text("plan_tier").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Resolved Anthropic budget cap. Defaults to the free-tier cap; 5B-3
  // wires checkBudget to read this value, and 5D updates it on Stripe
  // tier changes.
  monthlyCapUsd: numeric("monthly_cap_usd", { precision: 10, scale: 2 })
    .notNull()
    .default("5.00"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const orgSettings = pgTable("org_settings", {
  // 1:1 with orgs — using org_id as PK enforces the relationship at
  // the schema layer.
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  // low | medium | high | critical. Findings below this severity are
  // skipped before they reach the comment.
  severityThreshold: text("severity_threshold").notNull().default("low"),
  // Glob patterns whose matched files are skipped. Empty array = no
  // exclusions (default).
  ignoredGlobs: text("ignored_globs")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  // NULL = every registered detector runs (default). A non-null array
  // is an explicit allowlist; new detectors do NOT need a backfill.
  enabledDetectors: text("enabled_detectors").array(),
  slackWebhookUrl: text("slack_webhook_url"),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // "system" | "user" | "api_token" | "github_app"
    actorType: text("actor_type").notNull(),
    // user id, token id, "system", etc. Free-form text.
    actorId: text("actor_id").notNull(),
    // Verb-style: "settings_updated", "plan_changed", "token_revoked",
    // "scan_started", "scan_completed", etc.
    action: text("action").notNull(),
    // Resource the action applied to: "org/settings", "scan/<uuid>", etc.
    target: text("target"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgCreatedIdx: index("audit_log_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
  }),
);

export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
export type ScanRun = typeof scanRuns.$inferSelect;
export type NewScanRun = typeof scanRuns.$inferInsert;
export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type NewCostLedgerEntry = typeof costLedger.$inferInsert;
export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
export type OrgSettings = typeof orgSettings.$inferSelect;
export type NewOrgSettings = typeof orgSettings.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 5B-5 — API tokens
// ---------------------------------------------------------------------------

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  // SHA-256 hex of the plain token. The plain token is shown to the
  // user exactly once at creation; only the hash lives in the DB.
  // Tokens are 256-bit random + a `fxr_` prefix, so SHA-256 is enough
  // — no per-row salt needed (no offline brute force on high-entropy
  // randoms).
  hash: text("hash").notNull().unique(),
  name: text("name").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
