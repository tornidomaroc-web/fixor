/**
 * Pure validation for the org-settings PATCH payload.
 *
 * Lives in its own file so unit tests can import the validator without
 * pulling in the DB / server-only modules. Returns either a
 * normalized OrgSettingsRow or a list of human-readable error messages.
 */
import {
  DETECTOR_IDS,
  isSeverity,
  type Severity,
} from "@/lib/detectors";
import type { OrgSettingsRow } from "@/lib/settings-data";

export interface ValidationOk {
  ok: true;
  value: OrgSettingsRow;
}
export interface ValidationErr {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationErr;

const MAX_GLOBS = 50;
const MAX_GLOB_LEN = 200;

export function validateSettingsPatch(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }
  const body = input as Record<string, unknown>;

  // severityThreshold ------------------------------------------------------
  let severity: Severity = "low";
  if (typeof body.severityThreshold !== "string") {
    errors.push("severityThreshold must be a string");
  } else if (!isSeverity(body.severityThreshold)) {
    errors.push(
      "severityThreshold must be one of low | medium | high | critical",
    );
  } else {
    severity = body.severityThreshold;
  }

  // ignoredGlobs -----------------------------------------------------------
  let globs: string[] = [];
  if (!Array.isArray(body.ignoredGlobs)) {
    errors.push("ignoredGlobs must be an array of strings");
  } else if (body.ignoredGlobs.length > MAX_GLOBS) {
    errors.push(`ignoredGlobs accepts at most ${MAX_GLOBS} entries`);
  } else {
    const normalized: string[] = [];
    for (const g of body.ignoredGlobs) {
      if (typeof g !== "string") {
        errors.push("ignoredGlobs entries must all be strings");
        break;
      }
      const trimmed = g.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > MAX_GLOB_LEN) {
        errors.push(
          `glob too long (${trimmed.length} > ${MAX_GLOB_LEN}): ${trimmed.slice(
            0,
            40,
          )}…`,
        );
        continue;
      }
      normalized.push(trimmed);
    }
    globs = normalized;
  }

  // enabledDetectors -------------------------------------------------------
  // null = "all detectors run" (no filter). An array is the explicit
  // allowlist — empty array means "no detectors run", which we accept
  // even though it's an aggressive choice; the backend honors it.
  let detectors: string[] | null = null;
  if (body.enabledDetectors === null || body.enabledDetectors === undefined) {
    detectors = null;
  } else if (!Array.isArray(body.enabledDetectors)) {
    errors.push(
      "enabledDetectors must be null or an array of detector ids",
    );
  } else {
    const ids: string[] = [];
    let bad = false;
    for (const id of body.enabledDetectors) {
      if (typeof id !== "string") {
        errors.push("enabledDetectors entries must all be strings");
        bad = true;
        break;
      }
      if (!DETECTOR_IDS.includes(id)) {
        errors.push(`unknown detector id: ${id}`);
        bad = true;
        break;
      }
      if (!ids.includes(id)) ids.push(id);
    }
    if (!bad) detectors = ids;
  }

  // slackWebhookUrl --------------------------------------------------------
  let slack: string | null = null;
  if (
    body.slackWebhookUrl === null ||
    body.slackWebhookUrl === undefined ||
    body.slackWebhookUrl === ""
  ) {
    slack = null;
  } else if (typeof body.slackWebhookUrl !== "string") {
    errors.push("slackWebhookUrl must be a string or null");
  } else {
    const trimmed = body.slackWebhookUrl.trim();
    if (!isHttpsUrl(trimmed)) {
      errors.push("slackWebhookUrl must be an https:// URL");
    } else {
      slack = trimmed;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      severityThreshold: severity,
      ignoredGlobs: globs,
      enabledDetectors: detectors,
      slackWebhookUrl: slack,
    },
  };
}

function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Diff two settings rows so the audit log records only the keys that
 * actually changed. Comparisons are deep for arrays (order-sensitive,
 * which matches the schema's text[] semantics).
 */
export function diffSettings(
  oldRow: OrgSettingsRow,
  newRow: OrgSettingsRow,
): string[] {
  const fields: string[] = [];
  if (oldRow.severityThreshold !== newRow.severityThreshold)
    fields.push("severityThreshold");
  if (!sameStringArray(oldRow.ignoredGlobs, newRow.ignoredGlobs))
    fields.push("ignoredGlobs");
  if (!sameNullableStringArray(oldRow.enabledDetectors, newRow.enabledDetectors))
    fields.push("enabledDetectors");
  if (oldRow.slackWebhookUrl !== newRow.slackWebhookUrl)
    fields.push("slackWebhookUrl");
  return fields;
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameNullableStringArray(
  a: string[] | null,
  b: string[] | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return sameStringArray(a, b);
}
