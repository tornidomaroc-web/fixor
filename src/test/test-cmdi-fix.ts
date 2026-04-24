/**
 * Offline unit tests for the command-injection fix service.
 *
 * These tests do NOT hit the Claude API. They verify:
 *   1. residualCmdiRisk catches unsafe rewrites the LLM might propose.
 *   2. coerceCmdiSinkForMetadata / coerceArgvFormApplied / coerceConfidence.
 *   3. fallbackSuggestion has the right shape + findingId scheme.
 *   4. generateCmdiFix degrades to the fallback when no API key is set.
 */

delete process.env.ANTHROPIC_API_KEY;

import {
  generateCmdiFix,
  residualCmdiRisk,
  coerceConfidence,
  coerceCmdiSinkForMetadata,
  coerceArgvFormApplied,
  fallbackSuggestion,
} from "../services/cmdi-fix.service";
import type { NormalizedFinding } from "../analysis-engine/detector.types";

let failures = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  }
}

function mkFinding(
  overrides: Partial<NormalizedFinding> = {}
): NormalizedFinding {
  return {
    detectorId: "central-llm-analyzer",
    type: "command_injection_risk",
    file: "src/runner.ts",
    startLine: 5,
    endLine: 5,
    originalCode: "exec('ls ' + dir);",
    ruleId: "claude-analysis-command_injection_risk",
    message: "User input concatenated into shell command",
    explanation: "Attacker can inject arbitrary shell metacharacters.",
    confidence: "high",
    severity: "critical",
    ...overrides,
  };
}

async function run(): Promise<void> {
  assert(
    residualCmdiRisk('exec("ls " + dir);') !== null,
    "exec with string concat flagged"
  );
  assert(
    residualCmdiRisk("execSync(cmd);") !== null,
    "execSync flagged"
  );
  assert(
    residualCmdiRisk('spawn("git", { shell: true });') !== null,
    "spawn with shell:true flagged"
  );

  assert(
    residualCmdiRisk('execFile("ls", [dir]);') === null,
    "execFile with argv array not flagged"
  );
  assert(
    residualCmdiRisk('spawn("git", ["status"]);') === null,
    "spawn with argv array and no shell:true not flagged"
  );
  assert(
    residualCmdiRisk("const x = 'hello' + world;") === null,
    "plain string concat with no child_process not flagged"
  );

  assert(
    coerceCmdiSinkForMetadata("exec") === "exec",
    'coerceCmdiSinkForMetadata "exec"'
  );
  assert(
    coerceCmdiSinkForMetadata("execSync") === "execSync",
    'coerceCmdiSinkForMetadata "execSync"'
  );
  assert(
    coerceCmdiSinkForMetadata("spawn-shell") === "spawn",
    'coerceCmdiSinkForMetadata "spawn-shell" -> spawn'
  );
  assert(
    coerceCmdiSinkForMetadata("spawnSync-shell") === "spawnSync",
    'spawnSync-shell -> spawnSync'
  );
  assert(
    coerceCmdiSinkForMetadata("execFile") === "execFile",
    'coerceCmdiSinkForMetadata "execFile"'
  );
  assert(
    coerceCmdiSinkForMetadata("other") === undefined,
    '"other" -> undefined'
  );
  assert(
    coerceCmdiSinkForMetadata("nope") === undefined,
    "unknown -> undefined"
  );

  assert(coerceArgvFormApplied(true) === true, "argv true");
  assert(coerceArgvFormApplied(false) === false, "argv false");
  assert(coerceArgvFormApplied(undefined) === false, "argv undefined");

  assert(coerceConfidence("high") === "high", 'coerceConfidence "high"');
  assert(coerceConfidence("unknown") === "medium", "unknown confidence");

  const fb = fallbackSuggestion(mkFinding());
  assert(
    fb.findingType === "command_injection_risk",
    "fallback.findingType"
  );
  assert(
    fb.detectorId === "command-injection-js-ts",
    "fallback.detectorId"
  );
  assert(fb.confidence === "low", "fallback.confidence");
  assert(fb.patchQuality === "low", "fallback.patchQuality");
  assert(
    fb.metadata?.type === "command_injection_risk",
    "fallback.metadata.type"
  );
  assert(
    fb.findingId ===
      "central-llm-analyzer:command_injection_risk:src/runner.ts:5",
    `fallback.findingId (got: ${fb.findingId})`
  );
  assert(fb.patchWarnings.length >= 1, "fallback warnings");

  const noKeyResult = await generateCmdiFix(mkFinding());
  assert(
    noKeyResult.findingType === "command_injection_risk",
    "no-key findingType"
  );
  assert(noKeyResult.patchQuality === "low", "no-key patchQuality");
  assert(noKeyResult.confidence === "low", "no-key confidence");
  assert(
    noKeyResult.findingId ===
      "central-llm-analyzer:command_injection_risk:src/runner.ts:5",
    "no-key findingId"
  );

  if (failures === 0) {
    console.log("[PASS] CMDi fix service unit tests");
  } else {
    console.error(`[FAIL] ${failures} CMDi unit test(s) failed`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[FAIL] unexpected error", err);
  process.exit(1);
});
