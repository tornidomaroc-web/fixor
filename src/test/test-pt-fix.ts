/**
 * Offline unit tests for the path-traversal fix service.
 *
 * These tests do NOT hit the Claude API.
 */

delete process.env.ANTHROPIC_API_KEY;

import {
  generatePtFix,
  residualPtRisk,
  coerceConfidence,
  coerceBaseDir,
  coerceContainmentApplied,
  fallbackSuggestion,
} from "../services/pt-fix.service";
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
    type: "path_traversal_risk",
    file: "src/files.ts",
    startLine: 3,
    endLine: 3,
    originalCode: "fs.readFile(req.query.name);",
    ruleId: "claude-analysis-path_traversal_risk",
    message: "User-controlled path passed to fs.readFile",
    explanation: "Attacker can read arbitrary files via ../ segments.",
    confidence: "high",
    severity: "high",
    ...overrides,
  };
}

async function run(): Promise<void> {
  assert(
    residualPtRisk("fs.readFile(req.query.name);") !== null,
    "fs.readFile(req...) flagged"
  );
  assert(
    residualPtRisk("path.join(baseDir, userPath);") !== null,
    "path.join(base, user) without containment flagged"
  );

  const safeBlock = [
    "const resolved = path.resolve(BASE_DIR, userInput);",
    "if (!resolved.startsWith(BASE_DIR + path.sep)) throw new Error('bad');",
    'fs.readFile(resolved, "utf8", cb);',
  ].join("\n");
  assert(residualPtRisk(safeBlock) === null, "resolve+startsWith+readFile(resolved) not flagged");

  assert(
    residualPtRisk("const x = 'no-fs-here';") === null,
    "plain code without risky fs/path patterns not flagged"
  );

  assert(coerceConfidence("high") === "high", "coerceConfidence high");
  assert(coerceConfidence("??") === "medium", "coerceConfidence default");

  assert(coerceBaseDir(" /tmp/root ") === "/tmp/root", "coerceBaseDir trims");
  assert(coerceBaseDir("") === undefined, "coerceBaseDir empty");
  assert(coerceContainmentApplied(true) === true, "containment true");
  assert(coerceContainmentApplied(false) === false, "containment false");

  const fb = fallbackSuggestion(mkFinding());
  assert(fb.findingType === "path_traversal_risk", "fallback.findingType");
  assert(fb.detectorId === "path-traversal-js-ts", "fallback.detectorId");
  assert(fb.patchQuality === "low", "fallback.patchQuality");
  assert(
    fb.findingId ===
      "central-llm-analyzer:path_traversal_risk:src/files.ts:3",
    `fallback.findingId (got: ${fb.findingId})`
  );

  const noKey = await generatePtFix(mkFinding());
  assert(noKey.findingType === "path_traversal_risk", "no-key findingType");
  assert(noKey.patchQuality === "low", "no-key patchQuality");

  if (failures === 0) {
    console.log("[PASS] Path traversal fix service unit tests");
  } else {
    console.error(`[FAIL] ${failures} PT unit test(s) failed`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[FAIL] unexpected error", err);
  process.exit(1);
});
