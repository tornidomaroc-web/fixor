/**
 * Server-only data layer for the org-settings page (5C-5).
 *
 * Reads/writes `org_settings` and writes one `audit_log` row per
 * accepted update. Auth is the caller's job — every export takes the
 * already-resolved orgId, never the installation_id, because the
 * settings page must not be reachable without the
 * scans-data#getOrgForUser scope check.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, orgSettings } from "@/db/schema";
import { isSeverity, type Severity } from "@/lib/detectors";

export interface OrgSettingsRow {
  severityThreshold: Severity;
  ignoredGlobs: string[];
  enabledDetectors: string[] | null;
  slackWebhookUrl: string | null;
}

export const DEFAULT_ORG_SETTINGS: OrgSettingsRow = {
  severityThreshold: "low",
  ignoredGlobs: [],
  enabledDetectors: null,
  slackWebhookUrl: null,
};

/**
 * Returns the settings row for an org, or DEFAULT_ORG_SETTINGS when no
 * row exists yet (defensive — provisioning inserts one, but we render
 * sensible defaults during the small window between webhook ack +
 * row visibility).
 */
export async function getOrgSettings(
  orgId: string,
): Promise<OrgSettingsRow> {
  const rows = await db()
    .select({
      severityThreshold: orgSettings.severityThreshold,
      ignoredGlobs: orgSettings.ignoredGlobs,
      enabledDetectors: orgSettings.enabledDetectors,
      slackWebhookUrl: orgSettings.slackWebhookUrl,
    })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId))
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULT_ORG_SETTINGS;
  return {
    severityThreshold: isSeverity(row.severityThreshold)
      ? row.severityThreshold
      : "low",
    ignoredGlobs: row.ignoredGlobs ?? [],
    enabledDetectors: row.enabledDetectors,
    slackWebhookUrl: row.slackWebhookUrl,
  };
}

export interface UpdateMeta {
  /** Clerk user id of the actor — written to audit_log. */
  actorUserId: string;
  /** Diff between the old row and the new one, written to audit_log
   *  metadata so the trail shows what actually changed (not just
   *  "settings_updated"). */
  changedFields: string[];
}

/**
 * Apply a settings patch to an org. Performs an UPSERT plus an
 * audit_log insert atomically. The caller is responsible for
 * authorization — at this layer we only enforce the data shape.
 */
export async function updateOrgSettings(
  orgId: string,
  patch: OrgSettingsRow,
  meta: UpdateMeta,
): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .insert(orgSettings)
      .values({
        orgId,
        severityThreshold: patch.severityThreshold,
        ignoredGlobs: patch.ignoredGlobs,
        enabledDetectors: patch.enabledDetectors,
        slackWebhookUrl: patch.slackWebhookUrl,
      })
      .onConflictDoUpdate({
        target: orgSettings.orgId,
        set: {
          severityThreshold: patch.severityThreshold,
          ignoredGlobs: patch.ignoredGlobs,
          enabledDetectors: patch.enabledDetectors,
          slackWebhookUrl: patch.slackWebhookUrl,
        },
      });

    await tx.insert(auditLog).values({
      orgId,
      actorType: "user",
      actorId: meta.actorUserId,
      action: "settings_updated",
      target: `org/${orgId}`,
      metadata: {
        changedFields: meta.changedFields,
        // Only field names — never the slack webhook value, which is a
        // secret. The audit log is enough to know "the user touched
        // slackWebhookUrl at 12:34" without re-storing the URL itself.
      },
    });
  });
}
