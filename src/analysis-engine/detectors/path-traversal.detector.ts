/**
 * Path-traversal detector — wraps generatePtFix behind the Detector interface.
 * Detection is handled upstream by the central LLM analyzer; this detector
 * is invoked only to generate fixes for findings whose
 * `type === "path_traversal_risk"`.
 */

import type {
  Detector,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { generatePtFix } from "../../services/pt-fix.service";

const DETECTOR_ID = "path-traversal-js-ts";

export class PathTraversalDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Path Traversal (JS/TS)";
  readonly supports = ["path_traversal_risk"] as const;
  readonly languages = ["js", "jsx", "ts", "tsx"] as const;

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    return generatePtFix(finding);
  }
}
