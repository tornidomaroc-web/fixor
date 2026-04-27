/**
 * Dashboard's view of the Fixor database.
 *
 * INTENTIONAL DUPLICATION of column shapes that already live in the
 * backend at src/db/schema.ts. The dashboard runs on a different
 * deploy target (Vercel vs Railway) and Vercel's build only sees
 * apps/dashboard/, so we cannot import the backend schema directly
 * without npm workspaces — that's a future refactor.
 *
 * Rule: keep columns USED HERE in sync with the backend. Columns the
 * dashboard does not read can lag the backend without consequence.
 */
import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey(),
  githubInstallationId: text("github_installation_id").notNull(),
  planTier: text("plan_tier").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  monthlyCapUsd: numeric("monthly_cap_usd", {
    precision: 10,
    scale: 2,
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const costLedger = pgTable("cost_ledger", {
  id: serial("id").primaryKey(),
  installationId: text("installation_id").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
});

export const orgSettings = pgTable("org_settings", {
  // 1:1 with orgs — same shape as src/db/schema.ts. We write here from
  // 5C-5's settings form, so the column list is the full set the
  // backend reads (not just a read-only mirror).
  orgId: uuid("org_id").primaryKey(),
  severityThreshold: text("severity_threshold").notNull(),
  ignoredGlobs: text("ignored_globs")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  enabledDetectors: text("enabled_detectors").array(),
  slackWebhookUrl: text("slack_webhook_url"),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").primaryKey(),
  installationId: text("installation_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  pullNumber: integer("pull_number").notNull(),
  headSha: text("head_sha").notNull(),
  status: text("status").notNull(),
  totalFindings: integer("total_findings").notNull(),
  // Per-detector finding counts. Keys mirror src/lib/detectors.ts;
  // 5C-7's trends pie chart sums these across the time window.
  findingsByFamily: jsonb("findings_by_family")
    .$type<Record<string, number>>()
    .notNull(),
  fixesGenerated: integer("fixes_generated").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});
