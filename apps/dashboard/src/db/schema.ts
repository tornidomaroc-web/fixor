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
import {
  integer,
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

export const scanRuns = pgTable("scan_runs", {
  id: uuid("id").primaryKey(),
  installationId: text("installation_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  pullNumber: integer("pull_number").notNull(),
  headSha: text("head_sha").notNull(),
  status: text("status").notNull(),
  totalFindings: integer("total_findings").notNull(),
  fixesGenerated: integer("fixes_generated").notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});
