/**
 * XSS detector — wraps generateXssFix behind the Detector interface.
 * Detection is handled upstream by the central LLM analyzer; this
 * detector is invoked only to generate fixes for findings whose
 * `type === "xss_risk"`.
 */

import type {
  Detector,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { generateXssFix } from "../../services/xss-fix.service";

const DETECTOR_ID = "xss-js-ts";

export class XssDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Cross-Site Scripting (JS/TS)";
  readonly supports = ["xss_risk"] as const;
  readonly languages = ["js", "jsx", "ts", "tsx"] as const;

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    return generateXssFix(finding);
  }
}
