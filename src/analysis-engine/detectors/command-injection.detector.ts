/**
 * Command-injection detector — wraps generateCmdiFix behind the Detector
 * interface. Detection is handled upstream by the central LLM analyzer;
 * this detector is invoked only to generate fixes for findings whose
 * `type === "command_injection_risk"`.
 */

import type {
  Detector,
  NormalizedFinding,
  NormalizedFixSuggestion,
} from "../detector.types";
import { generateCmdiFix } from "../../services/cmdi-fix.service";

const DETECTOR_ID = "command-injection-js-ts";

export class CommandInjectionDetector implements Detector {
  readonly id = DETECTOR_ID;
  readonly displayName = "Command Injection (JS/TS)";
  readonly supports = ["command_injection_risk"] as const;
  readonly languages = ["js", "jsx", "ts", "tsx"] as const;

  async fix(finding: NormalizedFinding): Promise<NormalizedFixSuggestion> {
    return generateCmdiFix(finding);
  }
}
