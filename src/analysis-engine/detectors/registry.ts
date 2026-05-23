/**
 * Central registry of active detectors. The workflow iterates this list
 * when generating fixes. To add a new vulnerability family (XSS, CMDi,
 * Path Traversal, ...), implement the Detector interface and append the
 * instance to DETECTORS.
 */

// Detector status — Phase 5 COMPLETE:
// - auth-bypass.detector        (DONE — Phase 3)
// - secrets-exposure.detector   (DONE — Phase 4)
// - webhook-unverified.detector (DONE — Phase 5a)
// - env-exposure.detector       (DONE — Phase 5b)
// - admin-check.detector        (DONE — Phase 5c)
// - idor.detector               (DONE — Phase 5d)

import type { Detector } from "../detector.types";
import type { FindingType } from "../types";
import { SqlInjectionDetector } from "./sql-injection.detector";
import { XssDetector } from "./xss.detector";
import { CommandInjectionDetector } from "./command-injection.detector";
import { PathTraversalDetector } from "./path-traversal.detector";
import { AuthBypassDetector } from "./auth-bypass.detector";
import { SecretsExposureDetector } from "./secrets-exposure.detector";
import { WebhookUnverifiedDetector } from "./webhook-unverified.detector";
import { EnvExposureDetector } from "./env-exposure.detector";
import { AdminCheckDetector } from "./admin-check.detector";
import { IdorDetector } from "./idor.detector";

/**
 * Shipping detector ids — detectors that have a working detect() pass
 * AND are not in finding-suppressions. Single source of truth for
 * "which detectors actually run and emit." Imported by:
 *   - src/cli/scan.ts (selects which detectors invoke their detect())
 *   - src/workflows/auditor-workflow.ts (same)
 *   - src/lib/org-settings-filter.ts (defensive guard — drops stale
 *     allowlist ids before the filter would otherwise scan to nothing)
 *
 * The dashboard maintains its own DETECTOR_OPTIONS for UI labels (see
 * apps/dashboard/src/lib/detectors.ts) and must stay in sync with
 * this list. There is no automatic sync between this server-side
 * module and the dashboard's TS package; if you add a detector here,
 * add it there too. See docs/detector-capabilities.md.
 */
export const SHIPPING_DETECTOR_IDS: ReadonlySet<string> = new Set<string>([
  "auth-bypass-multi",
  "admin-check-multi",
  "idor-multi",
  "env-exposure-multi",
  "secrets-exposure-multi",
  "webhook-unverified-multi",
]);

export const DETECTORS: readonly Detector[] = [
  new SqlInjectionDetector(),
  new XssDetector(),
  new CommandInjectionDetector(),
  new PathTraversalDetector(),
  new AuthBypassDetector(),
  new SecretsExposureDetector(),
  new WebhookUnverifiedDetector(),
  new EnvExposureDetector(),
  new AdminCheckDetector(),
  new IdorDetector(),
];

/**
 * Returns the first detector that claims to support the given finding
 * type, or undefined if none is registered yet.
 */
export function getDetectorFor(type: FindingType): Detector | undefined {
  return DETECTORS.find((d) => d.supports.includes(type));
}
