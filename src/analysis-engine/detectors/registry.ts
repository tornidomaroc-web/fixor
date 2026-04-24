/**
 * Central registry of active detectors. The workflow iterates this list
 * when generating fixes. To add a new vulnerability family (XSS, CMDi,
 * Path Traversal, ...), implement the Detector interface and append the
 * instance to DETECTORS.
 */

import type { Detector } from "../detector.types";
import type { FindingType } from "../types";
import { SqlInjectionDetector } from "./sql-injection.detector";
import { XssDetector } from "./xss.detector";

export const DETECTORS: readonly Detector[] = [
  new SqlInjectionDetector(),
  new XssDetector(),
];

/**
 * Returns the first detector that claims to support the given finding
 * type, or undefined if none is registered yet.
 */
export function getDetectorFor(type: FindingType): Detector | undefined {
  return DETECTORS.find((d) => d.supports.includes(type));
}
