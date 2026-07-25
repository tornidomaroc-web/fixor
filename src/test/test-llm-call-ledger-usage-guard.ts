/**
 * Contract test for the callClaude -> llm-call-ledger pricing guard.
 *
 * WHAT IT PINS. `pricedCalls` must mean "usage was present", not "the success
 * path ran". That distinction is load-bearing rather than cosmetic: the
 * stability harness selects its MEASURED / NOT MEASURED / MIXED cost mode
 * purely by comparing `pricedCalls` to `calls`, so a success counted as priced
 * at a fabricated $0.00 reads downstream as a real MEASURED figure. That figure
 * is what a stage-3 live run reports as its number of record.
 *
 * BOTH HALVES MATTER, and the second is not the trivial one:
 *   - usage ABSENT  -> calls 1, pricedCalls 0, costUsd contribution 0.
 *   - usage PRESENT but zeroed -> calls 1, pricedCalls 1, costUsd 0.
 * The zeroed-but-present case is exactly the shape `measure-stage3-calls`
 * feeds through its canned response, so its acceptance figures (142 priced ==
 * 142 calls, MEASURED $0.00, the 144 model-reaching total) depend on that call
 * STAYING priced. A guard written as `usage && tokens > 0` would satisfy the
 * first assertion, silently unprice the canned path, and break that measurement
 * without touching it. This test fails if anyone does that.
 *
 * WHY A CLIENT SPY RATHER THAN A UNIT TEST OF recordLlmCall. Calling
 * `recordLlmCall(null)` directly would assert the ledger's own arithmetic,
 * which is not where the defect was: the ledger was always correct, and the
 * bug was the call site handing it a non-null cost on a usage-less success.
 * Patching `messages.create` on the cached singleton (the precedent set by
 * `measure-stage3-calls.ts` and `test-f001-webhook-parity.ts`) leaves
 * `callClaude` running UNMODIFIED - the real usage extraction, the real
 * `calculateCost`, the real `lastCallCost` assignment and the real ledger write
 * all execute. The only fabricated thing is the SDK response object.
 *
 * ZERO SPEND, FAIL CLOSED. A syntactically valid DUMMY key is set so
 * `getAnthropicClient()` returns a client to patch. If the patch ever failed to
 * apply, the fallthrough would be a 401 against a fake key - an auth rejection,
 * not a billable request. FIXOR_REPLAY and FIXOR_RECORD are asserted unset,
 * because either would divert `callClaude` before it reaches the success path
 * this test exists to exercise, turning a green run into a vacuous one.
 *
 * Run: npm run test:ledger-usage-guard   (no ANTHROPIC_API_KEY required)
 */

import type { Message } from "@anthropic-ai/sdk/resources/messages";

// Must be set BEFORE getAnthropicClient() constructs and caches the singleton.
process.env.ANTHROPIC_API_KEY = "sk-ant-api03-DUMMY-KEY-FOR-LEDGER-GUARD-TEST";

import {
  callClaude,
  getAnthropicClient,
  type MessagesCallOptions,
} from "../analysis-engine/anthropic-client";
import {
  llmCallsSince,
  snapshotLlmCalls,
} from "../lib/llm-call-ledger";

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

/**
 * A minimal successful Message. `withUsage: false` omits the usage block
 * entirely, which is the defensive case the `| undefined` on the usage type
 * already admits is possible.
 */
function cannedMessage(withUsage: boolean): Message {
  const base = {
    id: "msg_ledger_usage_guard",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "canned" }],
    stop_reason: "end_turn",
    stop_sequence: null,
  };
  if (!withUsage) return base as unknown as Message;
  return {
    ...base,
    // Zeroed but PRESENT: calculateCost yields 0, yet the call must stay
    // priced. This mirrors measure-stage3-calls' canned response exactly.
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Message;
}

function installSpy(withUsage: boolean): void {
  const client = getAnthropicClient();
  if (!client) {
    throw new Error(
      "test-llm-call-ledger-usage-guard: getAnthropicClient() returned null " +
        "after the dummy key was set; the spy has nothing to patch.",
    );
  }
  (client.messages as unknown as { create: unknown }).create = async () =>
    cannedMessage(withUsage);
}

const OPTS: MessagesCallOptions = {
  model: "claude-sonnet-4-6",
  system: "ledger usage guard test",
  messages: [{ role: "user", content: "canned" }],
  callerId: "test:ledger-usage-guard",
  // Auxiliary so this never perturbs the detection-coverage tally.
  coverage: "auxiliary",
};

async function main(): Promise<void> {
  // Fail loud rather than run vacuously: either flag diverts callClaude before
  // the success path, and the assertions below would then prove nothing.
  for (const flag of ["FIXOR_REPLAY", "FIXOR_RECORD"] as const) {
    if (process.env[flag]) {
      console.error(
        `[FAIL] ${flag} is set. It diverts callClaude away from the success ` +
          "path this test exercises, so a green run would prove nothing. Unset it.",
      );
      process.exit(1);
    }
  }

  console.log("llm-call-ledger usage guard\n");

  // --- Case 1: usage ABSENT -> counted, NOT priced -------------------------
  console.log("usage ABSENT on a successful call:");
  installSpy(false);
  let snap = snapshotLlmCalls();
  let res = await callClaude(OPTS);
  let delta = llmCallsSince(snap);

  check(res.ok === true, "call succeeded (the success path was reached)");
  check(delta.calls === 1, `counted as 1 call (got ${delta.calls})`);
  check(
    delta.pricedCalls === 0,
    `NOT priced (got pricedCalls=${delta.pricedCalls})`,
  );
  check(
    delta.costUsd === 0,
    `contributed nothing to costUsd (got ${delta.costUsd})`,
  );

  // --- Case 2: usage PRESENT but zeroed -> counted AND priced --------------
  console.log("\nusage PRESENT but zeroed (the measure-stage3-calls shape):");
  installSpy(true);
  snap = snapshotLlmCalls();
  res = await callClaude(OPTS);
  delta = llmCallsSince(snap);

  check(res.ok === true, "call succeeded");
  check(delta.calls === 1, `counted as 1 call (got ${delta.calls})`);
  check(
    delta.pricedCalls === 1,
    `STAYS priced (got pricedCalls=${delta.pricedCalls})`,
  );
  check(
    delta.costUsd === 0,
    `priced at exactly $0.00 (got ${delta.costUsd})`,
  );

  console.log("");
  if (failures === 0) {
    console.log("[PASS] llm-call-ledger usage guard");
  } else {
    console.error(`[FAIL] ${failures} llm-call-ledger usage guard check(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[FAIL] llm-call-ledger usage guard threw:", err);
  process.exit(1);
});
