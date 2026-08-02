/**
 * Engine B coverage-integrity regression test (deterministic, no LLM spend,
 * no DB).
 *
 * Guards F-002 on the SHIPPED path. `runAuditorWorkflow` contained a thrown
 * detector with `Promise.allSettled`, captured it to Sentry, logged a warning
 * and continued. That detector contributed zero findings for a reason
 * unrelated to the code under scan, and nothing downstream could tell that
 * silence apart from "analyzed, found nothing".
 *
 * Measured at 185542cd, the state this test was written against: a run whose
 * only defect was a thrown detector produced `status: "no_action"`,
 * `errors: []`, and — the part that mattered — SARIF
 * `invocations[0].executionSuccessful: true` with no notification. SARIF is
 * the one artifact a machine reads (GitHub Code Scanning ingests it) with no
 * human in the loop, so that flag was an AFFIRMATIVE false assurance, not a
 * missing warning.
 *
 * Covers:
 *   1. SARIF, detector-throw channel ALONE: executionSuccessful false and an
 *      error notification naming the detector. This is the case that was
 *      false before the fix; everything else here is a control on it.
 *   2. SARIF, LLM channel alone: unchanged (regression guard on F-003's fix).
 *   3. SARIF, both channels: degraded once, both causes named.
 *   4. SARIF, clean and legacy shapes: executionSuccessful true, no
 *      notification. The no-false-alarm control.
 *   5. Workflow E2E: a detector that throws degrades the run — named in
 *      `detectorFailures`, named in a WorkflowError, named in
 *      `automationDecisionReason`, and status is NOT `no_action`.
 *   6. CHANNEL SEPARATION: the same run leaves `llmCoverage` at 0/0. A thrown
 *      detector must never be laundered into the call tally, which is read by
 *      spend measurement. The channels share a verdict, not a counter.
 *   7. Workflow control: the identical diff with no detector patched still
 *      lands `no_action` with `detectorFailures` unset.
 *
 * SPEND: zero, by four independent locks.
 *   1. ANTHROPIC_API_KEY is deleted below. `getAnthropicClient()` reads it at
 *      CALL time (anthropic-client.ts), not at module load, so this holds
 *      regardless of how the CommonJS emit orders the requires.
 *   2. ANTHROPIC_BASE_URL points at a dead loopback port. The client passes no
 *      explicit baseURL, so the SDK honours this env var. PREVENTION if 1 fails.
 *   3. BENIGN_DIFF clears no detector's prefilter, so nothing reaches
 *      `callClaude` in the first place.
 *   4. Both workflow cases ASSERT `llmCoverage.attempted === 0`. DETECTION: if
 *      a prefilter ever starts matching this diff, the test fails loudly
 *      instead of quietly starting to spend.
 *
 * The injected failure is an `async` detector whose promise rejects, which is
 * the only shape reachable from shipping code: all six shipping detectors are
 * declared `async detect(`, so a SYNCHRONOUS throw (which would escape
 * `Promise.allSettled` and crash the run rather than degrade it) cannot occur
 * today. That is an observation about the current registry, not a guarantee,
 * and it is recorded here rather than defended with code.
 *
 * Run via: npm run test:workflow-coverage
 */

// MUST happen before any callClaude: guarantee the no-key failure path.
delete process.env.ANTHROPIC_API_KEY;
// Belt and braces: even a restored key cannot leave the machine.
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1";

import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import { buildSarifLog } from "../services/sarif-output.service";
import { DETECTORS } from "../analysis-engine/detectors/registry";
import type { Detector } from "../analysis-engine/detector.types";
import type { WorkflowResult } from "../types/workflow.types";

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

/** Inert code: no route shape, no env read, no secret, no webhook. Clears
 *  every shipping prefilter, so the run makes zero model calls. */
const BENIGN_DIFF = [
  "diff --git a/src/util/arithmetic.ts b/src/util/arithmetic.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/util/arithmetic.ts",
  "@@ -0,0 +1,3 @@",
  "+export function addTwo(a: number, b: number): number {",
  "+  return a + b;",
  "+}",
].join("\n");

const VICTIM_ID = "env-exposure-multi";

function shell(over: Partial<WorkflowResult>): WorkflowResult {
  return {
    status: "no_action",
    automationReady: false,
    automationDecisionReason: "",
    totalFindings: 0,
    sqlInjectionFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    errors: [],
    metadata: {},
    timing: { startedAt: "", finishedAt: "", durationMs: 0 },
    ...over,
  };
}

function inv(w: WorkflowResult) {
  return buildSarifLog(w).runs[0]!.invocations[0]!;
}

// ---------------------------------------------------------------------------

function testSarifDetectorChannelAlone(): void {
  console.log("\n--- 1. SARIF: detector-throw channel ALONE ---");

  const i = inv(
    shell({
      llmCoverage: { attempted: 4, failed: 0, byReason: {}, byCaller: {} },
      detectorFailures: [
        { detectorId: "idor-multi", reason: "TypeError: bad input" },
      ],
    }),
  );

  assert(
    i.executionSuccessful === false,
    "a thrown detector alone sets executionSuccessful false (was true before F-002)",
  );
  assert(
    i.toolExecutionNotifications?.some(
      (n) => n.level === "error" && /idor-multi/.test(n.message.text),
    ) ?? false,
    "the notification names the detector, not just a count",
  );
  assert(
    i.toolExecutionNotifications?.some((n) =>
      /coverage degraded/i.test(n.message.text),
    ) ?? false,
    "the notification is phrased as coverage degradation",
  );
  assert(
    !(i.toolExecutionNotifications ?? []).some((n) =>
      /LLM detection call\(s\) failed/.test(n.message.text),
    ),
    "it does NOT claim an LLM call failed, because none did",
  );
}

function testSarifLlmChannelUnchanged(): void {
  console.log("\n--- 2. SARIF: LLM channel alone, unchanged ---");

  const i = inv(
    shell({
      llmCoverage: {
        attempted: 90,
        failed: 68,
        byReason: { http_error: 68 },
        byCaller: {},
      },
    }),
  );

  assert(i.executionSuccessful === false, "failed LLM calls still degrade");
  assert(
    i.toolExecutionNotifications?.some((n) =>
      /68 of 90 LLM detection call\(s\) failed/.test(n.message.text),
    ) ?? false,
    "the LLM cause text is preserved verbatim",
  );
}

function testSarifBothChannels(): void {
  console.log("\n--- 3. SARIF: both channels ---");

  const i = inv(
    shell({
      llmCoverage: {
        attempted: 10,
        failed: 2,
        byReason: { timeout: 2 },
        byCaller: {},
      },
      detectorFailures: [
        { detectorId: "admin-check-multi", reason: "boom" },
        { detectorId: "idor-multi", reason: "boom" },
      ],
    }),
  );

  assert(i.executionSuccessful === false, "both channels degrade");
  const text = i.toolExecutionNotifications?.[0]?.message.text ?? "";
  assert(
    /2 of 10 LLM detection call\(s\) failed/.test(text),
    "both-channel notification names the LLM cause",
  );
  assert(
    /admin-check-multi, idor-multi/.test(text),
    "both-channel notification names every detector casualty",
  );
  assert(
    (i.toolExecutionNotifications ?? []).length === 1,
    "one composed notification, not one per channel",
  );
}

function testSarifCleanControls(): void {
  console.log("\n--- 4. SARIF: clean and legacy controls ---");

  const clean = inv(
    shell({
      llmCoverage: { attempted: 9, failed: 0, byReason: {}, byCaller: {} },
      detectorFailures: [],
    }),
  );
  assert(
    clean.executionSuccessful === true,
    "clean run stays executionSuccessful",
  );
  assert(
    clean.toolExecutionNotifications === undefined,
    "clean run carries no notification (no false alarm)",
  );

  const legacy = inv(shell({}));
  assert(
    legacy.executionSuccessful === true,
    "legacy shape with neither field stays executionSuccessful",
  );
}

// ---------------------------------------------------------------------------

async function testWorkflowDegrades(): Promise<void> {
  console.log("\n--- 5/6. Workflow: a thrown detector degrades the run ---");

  const victim = DETECTORS.find((d) => d.id === VICTIM_ID);
  if (!victim) {
    assert(false, `registry still carries ${VICTIM_ID} to inject into`);
    return;
  }

  const original = victim.detect;
  let result: WorkflowResult;
  try {
    // Realistic shape: an async detector whose promise rejects.
    (victim as Detector).detect = async () => {
      throw new TypeError("injected detector failure");
    };
    result = await runAuditorWorkflow({ diff: BENIGN_DIFF });
  } finally {
    (victim as Detector).detect = original;
  }

  assert(
    result.llmCoverage?.attempted === 0,
    `SPEND LOCK: zero model calls attempted (got ${result.llmCoverage?.attempted})`,
  );

  assert(
    result.detectorFailures?.some((d) => d.detectorId === VICTIM_ID) ?? false,
    "detectorFailures names the casualty",
  );
  assert(
    /injected detector failure/.test(
      result.detectorFailures?.[0]?.reason ?? "",
    ),
    "the casualty carries the reason it died of",
  );
  assert(
    result.errors.some(
      (e) => /coverage degraded/i.test(e.message) && e.message.includes(VICTIM_ID),
    ),
    "a WorkflowError is pushed and names the detector",
  );
  assert(
    result.status !== "no_action",
    `status is not no_action (got "${result.status}") — a blind run cannot read as clean`,
  );
  assert(
    result.automationReady === false,
    "automation is withheld on a degraded run",
  );
  assert(
    /detector\(s\) threw/.test(result.automationDecisionReason),
    `automationDecisionReason names the channel (got "${result.automationDecisionReason}")`,
  );

  // 6. Channel separation.
  assert(
    result.llmCoverage?.failed === 0,
    `CHANNEL SEPARATION: detector throw did NOT increment llmCoverage.failed (got ${result.llmCoverage?.failed})`,
  );
}

async function testWorkflowCleanControl(): Promise<void> {
  console.log("\n--- 7. Workflow: clean control, same diff ---");

  const result = await runAuditorWorkflow({ diff: BENIGN_DIFF });

  assert(
    result.llmCoverage?.attempted === 0,
    `SPEND LOCK: zero model calls attempted (got ${result.llmCoverage?.attempted})`,
  );
  assert(
    result.detectorFailures === undefined,
    "no detector failed, so the field is absent rather than an empty array",
  );
  assert(
    result.errors.length === 0,
    `clean run pushes no WorkflowError (got ${result.errors.length})`,
  );
  assert(
    result.status === "no_action",
    `clean run still lands no_action (got "${result.status}")`,
  );
  assert(
    inv(result).executionSuccessful === true,
    "clean run's SARIF stays executionSuccessful (no false degradation)",
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Engine B coverage-integrity (F-002) ===");

  testSarifDetectorChannelAlone();
  testSarifLlmChannelUnchanged();
  testSarifBothChannels();
  testSarifCleanControls();
  await testWorkflowDegrades();
  await testWorkflowCleanControl();

  console.log(
    failures === 0
      ? "\nAll Engine B coverage-integrity checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
