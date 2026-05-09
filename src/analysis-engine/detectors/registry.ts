/**
 * Central registry of active detectors. The workflow iterates this list
 * when generating fixes. To add a new vulnerability family (XSS, CMDi,
 * Path Traversal, ...), implement the Detector interface and append the
 * instance to DETECTORS.
 */

// Detector status:
// - auth-bypass.detector        (DONE — Phase 3)
// - secrets-exposure.detector   (DONE — Phase 4)
// - webhook-unverified.detector (DONE — Phase 5a)
// - env-exposure.detector       (TBD)
// - admin-check.detector        (TBD)

import type { Detector } from "../detector.types";
import type { FindingType } from "../types";
import { SqlInjectionDetector } from "./sql-injection.detector";
import { XssDetector } from "./xss.detector";
import { CommandInjectionDetector } from "./command-injection.detector";
import { PathTraversalDetector } from "./path-traversal.detector";
import { AuthBypassDetector } from "./auth-bypass.detector";
import { SecretsExposureDetector } from "./secrets-exposure.detector";
import { WebhookUnverifiedDetector } from "./webhook-unverified.detector";

export const DETECTORS: readonly Detector[] = [
  new SqlInjectionDetector(),
  new XssDetector(),
  new CommandInjectionDetector(),
  new PathTraversalDetector(),
  new AuthBypassDetector(),
  new SecretsExposureDetector(),
  new WebhookUnverifiedDetector(),
];

/**
 * Returns the first detector that claims to support the given finding
 * type, or undefined if none is registered yet.
 */
export function getDetectorFor(type: FindingType): Detector | undefined {
  return DETECTORS.find((d) => d.supports.includes(type));
}
