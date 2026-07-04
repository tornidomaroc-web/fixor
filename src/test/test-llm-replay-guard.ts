/**
 * F-004 stage 2 (2a-1) guard test for the replay shim.
 *
 * Proves, entirely offline (no API key, no network, no spend):
 *   1. SAFETY (required): with NEITHER FIXOR_REPLAY nor FIXOR_RECORD set,
 *      callClaude behaves exactly as before the shim - a keyless call returns
 *      { ok:false, reason:"no_api_key" }. The shim does not affect real scans.
 *   2. Replay + missing fixture fails LOUD (ReplayFixtureMissing); it never
 *      falls through to a real call and never returns the no_api_key path.
 *   3. Replay + a present fixture returns the recorded response with no key and
 *      no network.
 *   4. The request key is stable and correctly normalized (tool-schema key
 *      order and system cache_control do not change it; a different prompt does).
 *
 * This is a WIRING/PARSING gate. It does not verify detection quality or model
 * behavior (that is the opt-in live gate, stage 3). A replay is one frozen
 * sample, not repeated sampling.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import {
  callClaude,
  cachedSystem,
  type MessagesCallOptions,
} from "../analysis-engine/anthropic-client";
import {
  computeReplayKey,
  ReplayFixtureMissing,
  resolveReplayMode,
} from "../analysis-engine/llm-replay";
import type { ClaudeModelId } from "../config/models";

let failures = 0;
const out = process.stdout;
function check(cond: boolean, label: string): void {
  if (cond) {
    out.write(`  PASS  ${label}\n`);
  } else {
    failures++;
    out.write(`  FAIL  ${label}\n`);
  }
}

const MODEL = "claude-sonnet-4-6" as ClaudeModelId;

const TOOL: Tool = {
  name: "report",
  description: "Report the verdict.",
  input_schema: {
    type: "object",
    properties: {
      isVulnerable: { type: "boolean" },
      confidence: { type: "string" },
    },
    required: ["isVulnerable", "confidence"],
  },
};

function baseOpts(): MessagesCallOptions {
  return {
    callerId: "replay-guard-test",
    model: MODEL,
    system: cachedSystem("You are a security auditor."),
    tool: TOOL,
    temperature: 0,
    messages: [{ role: "user", content: "analyze this code" }],
  };
}

/** Clear every flag this test toggles, so each case starts from a clean env. */
function clearEnv(): void {
  delete process.env.FIXOR_REPLAY;
  delete process.env.FIXOR_RECORD;
  delete process.env.FIXOR_REPLAY_ROOT;
  delete process.env.ANTHROPIC_API_KEY;
}

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "fixor-replay-guard-"));

  // --- 1. SAFETY: no flags + no key -> byte-identical no_api_key result ---
  clearEnv();
  out.write("1. No-flag inertness (byte-identical to pre-shim):\n");
  check(resolveReplayMode() === "live", "resolveReplayMode() is 'live' with no flags");
  const noFlag = await callClaude(baseOpts());
  check(
    noFlag.ok === false && noFlag.reason === "no_api_key",
    `keyless call returns { ok:false, reason:"no_api_key" } (got ${JSON.stringify(noFlag)})`,
  );

  // --- 2. Replay + missing fixture -> fail loud, never a real call ---
  clearEnv();
  process.env.FIXOR_REPLAY = "1";
  process.env.FIXOR_REPLAY_ROOT = tmpRoot; // empty dir -> guaranteed miss
  out.write("2. Replay + missing fixture fails loud:\n");
  let threw: unknown = null;
  let result2: unknown = null;
  try {
    result2 = await callClaude(baseOpts());
  } catch (err) {
    threw = err;
  }
  check(
    threw instanceof ReplayFixtureMissing,
    `throws ReplayFixtureMissing (got ${threw instanceof Error ? threw.name : String(threw)})`,
  );
  check(
    result2 === null,
    "does NOT return a result (no fall-through to a real call or no_api_key)",
  );

  // --- 3. Replay + present fixture -> recorded response, no key, no network ---
  clearEnv();
  process.env.FIXOR_REPLAY = "1";
  process.env.FIXOR_REPLAY_ROOT = tmpRoot;
  out.write("3. Replay + present fixture returns the recorded response:\n");
  const opts3 = baseOpts();
  const key3 = computeReplayKey(opts3);
  const authored = { isVulnerable: true, confidence: "high", reasoning: "planted" };
  const dir3 = join(tmpRoot, "replay-guard-test");
  mkdirSync(dir3, { recursive: true });
  writeFileSync(
    join(dir3, `${key3}.json`),
    JSON.stringify({
      key: key3,
      meta: { detectorId: "replay-guard-test", model: MODEL, recordedAtIso: "" },
      request: { model: MODEL, system: "", messages: [], tool: "report" },
      response: { toolInput: authored, text: "hello" },
    }),
  );
  const hit = await callClaude(opts3);
  check(hit.ok === true, "returns ok:true from the fixture (no key set)");
  check(
    hit.ok === true &&
      JSON.stringify(hit.toolInput) === JSON.stringify(authored),
    "toolInput matches the recorded response",
  );
  check(hit.ok === true && hit.text === "hello", "text matches the recorded response");

  // --- 4. Key stability and normalization ---
  clearEnv();
  out.write("4. Request key is stable and normalized:\n");
  const k = computeReplayKey(baseOpts());

  // 4a. Reordered tool-schema property keys -> same key (canonical sort).
  const reordered = baseOpts();
  reordered.tool = {
    name: "report",
    description: "Report the verdict.",
    input_schema: {
      properties: {
        confidence: { type: "string" },
        isVulnerable: { type: "boolean" },
      },
      required: ["isVulnerable", "confidence"],
      type: "object",
    },
  } as Tool;
  check(computeReplayKey(reordered) === k, "tool-schema key order does not change the key");

  // 4b. system as a plain string with the same text -> same key (cache_control stripped).
  const asString = baseOpts();
  asString.system = "You are a security auditor.";
  check(computeReplayKey(asString) === k, "cache_control / string-vs-block does not change the key");

  // 4c. Different system text -> different key.
  const changedPrompt = baseOpts();
  changedPrompt.system = cachedSystem("You are a DIFFERENT auditor.");
  check(computeReplayKey(changedPrompt) !== k, "a changed prompt moves the key (staleness detector)");

  // --- 5. Both flags set -> ambiguous config fails loud ---
  clearEnv();
  process.env.FIXOR_REPLAY = "1";
  process.env.FIXOR_RECORD = "1";
  out.write("5. Both flags set is rejected:\n");
  let modeThrew = false;
  try {
    resolveReplayMode();
  } catch {
    modeThrew = true;
  }
  check(modeThrew, "resolveReplayMode throws when both FIXOR_REPLAY and FIXOR_RECORD are set");

  clearEnv();
  rmSync(tmpRoot, { recursive: true, force: true });

  out.write(`\n${failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures})`}\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
