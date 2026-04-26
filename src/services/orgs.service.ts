/**
 * Org provisioning + lookup helpers (Phase 5B-2 onward).
 *
 * One GitHub installation maps 1:1 to one org. Provisioning is
 * triggered by the `installation` webhook with `action=created`; the
 * inserts happen inside a single Postgres transaction so a partial
 * failure cannot leave a half-built org behind.
 *
 * Idempotent — duplicate webhook deliveries (GitHub retries) reuse the
 * existing org row and do NOT write a duplicate audit_log entry.
 *
 * 5B-3 added `resolveMonthlyCapForInstallation` so cost-store can
 * read per-org caps (still falling back to env when no org row exists).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, installations, orgSettings, orgs } from "../db/schema";
import { logger } from "../lib/logger";

export interface ProvisionResult {
  orgId: string;
  /** True when this call inserted a new org; false when it already existed. */
  created: boolean;
}

/**
 * Ensure an installations row + an orgs row + a default org_settings
 * row exist for `installationId`. On NEW provisioning, also writes an
 * audit_log entry tagged `installation_created`.
 *
 * `sourceEvent` is the webhook event name (e.g. `installation`) — it
 * lands in the audit log metadata so we can later distinguish between
 * Marketplace installs, retries, and manual provisions.
 */
export async function provisionOrgForInstallation(
  installationId: string,
  sourceEvent: string,
): Promise<ProvisionResult> {
  return await db().transaction(async (tx) => {
    // 1. Low-level GitHub identifier — also lets cost-store insert
    //    cost_ledger rows for this installation immediately.
    await tx
      .insert(installations)
      .values({ id: installationId })
      .onConflictDoUpdate({
        target: installations.id,
        set: { lastSeenAt: sql`now()` },
      });

    // 2. Org row. Default plan_tier=free, monthly_cap_usd=5.00 from
    //    the schema defaults — keep them there so future tier changes
    //    update via the orgs.monthly_cap_usd column, not via inserts.
    const inserted = await tx
      .insert(orgs)
      .values({ githubInstallationId: installationId })
      .onConflictDoNothing()
      .returning({ id: orgs.id });

    let orgId: string;
    let created: boolean;

    if (inserted.length > 0) {
      orgId = inserted[0]!.id;
      created = true;
    } else {
      const existing = await tx
        .select({ id: orgs.id })
        .from(orgs)
        .where(eq(orgs.githubInstallationId, installationId));
      const row = existing[0];
      if (!row) {
        // The unique constraint said the row exists but the lookup
        // doesn't see it. That should be impossible inside a single
        // transaction — surface it loudly rather than silently noop.
        throw new Error(
          `provisionOrgForInstallation: orgs row for installation ${installationId} not found after onConflictDoNothing`,
        );
      }
      orgId = row.id;
      created = false;
    }

    if (created) {
      // 3. Default settings row (1:1 with orgs).
      await tx
        .insert(orgSettings)
        .values({ orgId })
        .onConflictDoNothing();

      // 4. Audit trail — only on actual creation, so a duplicate
      //    webhook delivery does NOT spam the log.
      await tx.insert(auditLog).values({
        orgId,
        actorType: "github_app",
        actorId: installationId,
        action: "installation_created",
        target: `org/${orgId}`,
        metadata: { sourceEvent },
      });
    }

    logger.info(
      { installationId, orgId, created, sourceEvent },
      created ? "org provisioned" : "org already provisioned",
    );

    return { orgId, created };
  });
}

/**
 * Per-installation monthly Anthropic cap (USD).
 *
 * Returns the org's `monthly_cap_usd` when a row exists for the
 * installation; returns `null` when no org row is found. Callers
 * should treat null as "fall back to env-default".
 *
 * No fallback / catch happens here on purpose — DB errors propagate
 * so cost-store's existing fail-open path (`reason: "db_unavailable"`)
 * still owns the recovery decision.
 */
export async function resolveMonthlyCapForInstallation(
  installationId: string,
): Promise<number | null> {
  const rows = await db()
    .select({ cap: orgs.monthlyCapUsd })
    .from(orgs)
    .where(eq(orgs.githubInstallationId, installationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // monthly_cap_usd is NUMERIC, returned as a string — parseFloat to
  // get the dollar value. Schema NOT NULL guarantees we never see
  // null inside the row when the row exists.
  const n = Number.parseFloat(row.cap);
  return Number.isFinite(n) ? n : null;
}
