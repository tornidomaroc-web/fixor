/**
 * Offline unit tests for the XSS fix service.
 *
 * These tests do NOT hit the Claude API. They verify:
 *   1. residualXssRisk catches unsafe rewrites the LLM might propose.
 *   2. coerceContext / coerceConfidence normalize tool input.
 *   3. fallbackSuggestion has the right shape + findingId scheme.
 *   4. generateXssFix degrades to the fallback when no API key is set.
 *
 * The ANTHROPIC_API_KEY env var is deleted before the client ever reads
 * it, so the fallback path runs even when CI has a real key present.
 */

// Must run BEFORE callClaude is ever invoked so the lazy client stays null.
delete process.env.ANTHROPIC_API_KEY;

import {
  generateXssFix,
  residualXssRisk,
  coerceContext,
  coerceConfidence,
  fallbackSuggestion,
} from "../services/xss-fix.service";
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
    type: "xss_risk",
    file: "src/view.tsx",
    startLine: 10,
    endLine: 10,
    originalCode: "container.innerHTML = userComment;",
    ruleId: "claude-analysis-xss_risk",
    message: "Unsanitized user input assigned to innerHTML",
    explanation: "Can execute attacker JS in the victim's browser.",
    confidence: "high",
    severity: "high",
    ...overrides,
  };
}

async function run(): Promise<void> {
  // --- residualXssRisk ---------------------------------------------------
  assert(
    residualXssRisk("element.innerHTML = userVar") !== null,
    "innerHTML = bare variable flagged"
  );
  assert(
    residualXssRisk("element.innerHTML = DOMPurify.sanitize(userVar)") ===
      null,
    "innerHTML wrapped with DOMPurify not flagged"
  );
  assert(
    residualXssRisk("element.textContent = userVar") === null,
    "textContent assignment not flagged"
  );
  assert(
    residualXssRisk("document.write(x)") !== null,
    "document.write flagged"
  );
  assert(
    residualXssRisk("<div dangerouslySetInnerHTML={{__html: x}} />") !== null,
    "bare dangerouslySetInnerHTML flagged"
  );
  assert(
    residualXssRisk(
      "<div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(x)}} />"
    ) === null,
    "sanitized dangerouslySetInnerHTML not flagged"
  );
  assert(
    residualXssRisk(
      'el.appendChild(document.createTextNode(userVar)); el.innerHTML = ""'
    ) === null,
    "createTextNode rewrite with empty string init not flagged"
  );

  // --- coerceContext -----------------------------------------------------
  assert(coerceContext("html") === "html", 'coerceContext "html"');
  assert(
    coerceContext("attribute") === "attribute",
    'coerceContext "attribute"'
  );
  assert(coerceContext("js") === "js", 'coerceContext "js"');
  assert(coerceContext("url") === "url", 'coerceContext "url"');
  assert(coerceContext("foo") === undefined, "unknown context → undefined");
  assert(coerceContext(42) === undefined, "non-string context → undefined");
  assert(coerceContext(undefined) === undefined, "undefined → undefined");

  // --- coerceConfidence --------------------------------------------------
  assert(coerceConfidence("high") === "high", 'coerceConfidence "high"');
  assert(
    coerceConfidence("medium") === "medium",
    'coerceConfidence "medium"'
  );
  assert(coerceConfidence("low") === "low", 'coerceConfidence "low"');
  assert(coerceConfidence("unknown") === "medium", "unknown → medium");
  assert(coerceConfidence(undefined) === "medium", "undefined → medium");
  assert(coerceConfidence(null) === "medium", "null → medium");

  // --- fallbackSuggestion ------------------------------------------------
  const fb = fallbackSuggestion(mkFinding());
  assert(fb.findingType === "xss_risk", "fallback.findingType === xss_risk");
  assert(fb.detectorId === "xss-js-ts", "fallback.detectorId === xss-js-ts");
  assert(fb.confidence === "low", "fallback.confidence === low");
  assert(fb.patchQuality === "low", "fallback.patchQuality === low");
  assert(
    fb.metadata?.type === "xss_risk",
    "fallback.metadata.type === xss_risk"
  );
  assert(
    fb.findingId === "central-llm-analyzer:xss_risk:src/view.tsx:10",
    `fallback.findingId should use deriveFindingId scheme (got: ${fb.findingId})`
  );
  assert(
    fb.patchWarnings.length >= 1,
    "fallback includes at least one warning"
  );
  assert(fb.file === "src/view.tsx", "fallback.file preserved");
  assert(fb.line === 10, "fallback.line preserved");

  // --- generateXssFix (no API key → must degrade to fallback) -----------
  const noKeyResult = await generateXssFix(mkFinding());
  assert(
    noKeyResult.findingType === "xss_risk",
    "no-key result findingType === xss_risk"
  );
  assert(
    noKeyResult.patchQuality === "low",
    "no-key result patchQuality === low"
  );
  assert(
    noKeyResult.confidence === "low",
    "no-key result confidence === low"
  );
  assert(
    noKeyResult.metadata?.type === "xss_risk",
    "no-key result metadata.type === xss_risk"
  );
  assert(
    noKeyResult.findingId ===
      "central-llm-analyzer:xss_risk:src/view.tsx:10",
    "no-key result uses canonical findingId scheme"
  );

  // --- findingId varies with file + line --------------------------------
  const fb2 = fallbackSuggestion(
    mkFinding({ file: "pages/index.tsx", startLine: 42 })
  );
  assert(
    fb2.findingId === "central-llm-analyzer:xss_risk:pages/index.tsx:42",
    `findingId reflects file+line (got: ${fb2.findingId})`
  );

  if (failures === 0) {
    console.log("[PASS] XSS fix service unit tests");
  } else {
    console.error(`[FAIL] ${failures} XSS unit test(s) failed`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[FAIL] unexpected error", err);
  process.exit(1);
});
