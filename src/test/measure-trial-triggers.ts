/**
 * Field trial (2026-09-19): zero-spend trigger dry run over real repositories.
 *
 * WHAT THIS ANSWERS. How many model calls `npm run scan` would make on a given
 * directory, per detector, BEFORE anyone approves a dollar figure. The scan's
 * own pre-prompt estimate cannot answer that: its "typical" figure counts only
 * route-shape files, its "worst-case" figure assumes every file hits three
 * content detectors, and it prices at a constant. This script counts CALLS BY
 * EXECUTION instead, so it can disagree with both.
 *
 * WHY THE REAL DETECTORS, NOT A REGEX COPY. A hand re-implementation of the
 * prefilters is a shadow that drifts (the ICP-reach precedent refused a shadow
 * for a load-bearing number). Here every detector's shipped `detect()` runs
 * unmodified, so skip lists, language gates, earliest-match ordering, idor's
 * source/sink pairing and the size window are all the shipped code. What this
 * file copies from `src/cli/scan.ts` is only the per-file loop: walkFiles ->
 * buildSyntheticDiff(rel) -> resolveRemixRouteGuard(abs) -> DetectorContext ->
 * every SHIPPING detector with a detect(). The sleeps are dropped; nothing
 * else is. If scan.ts's loop changes, this copy must change with it.
 *
 * ZERO SPEND, FAIL CLOSED, the measure-stage3-calls spy unchanged in shape:
 * the real key is deleted and a null client asserted first; a non-key-shaped
 * DUMMY is then set so a client exists to patch; `messages.create` on the
 * cached singleton is replaced with a canned responder that has no delegation
 * branch; an unrecognised tool shape THROWS rather than reaching the network.
 * If the patch ever failed to apply, the fallthrough is a 401 on a malformed
 * key, not a billable request. Escalation, replay and record flags are asserted
 * unset. CALLS, NOT DOLLARS: canned usage is zero.
 *
 * FAILURE ACCOUNTING. filesEnumerated === filesScanned + filesFailed is
 * hard-asserted and every failure is listed by name. A file that failed to read
 * must never look like a file that reached no detector.
 *
 * Run (after `npm run build`, zero spend, NOT in test:ci):
 *   node dist/test/measure-trial-triggers.js <dir> <label> <out.json>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import type { Message } from "@anthropic-ai/sdk/resources/messages";

import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import type { DetectorContext } from "../analysis-engine/detector.types";
import {
  DETECTORS,
  SHIPPING_DETECTOR_IDS,
} from "../analysis-engine/detectors/registry";
import { resolveRemixRouteGuard } from "../analysis-engine/detectors/shared/route-guard-resolver";
import { SIDECAR_KINDS } from "../analysis-engine/sidecar-kinds";
import { buildSyntheticDiff } from "../cli/diff-builder";
import { DEFAULT_EXTENSIONS, walkFiles } from "../cli/file-walker";
import { assertEscalationUnset } from "./replay-harness";

const out = process.stdout;

const DUMMY_KEY = "fixor-measure-trial-triggers-placeholder-no-network";
const CANNED_REASONING =
  "canned response from measure-trial-triggers; no model was consulted";
const IDOR_TOOL_NAME = "report_idor_findings";

/** Same selection scan.ts makes. */
const newDetectors = DETECTORS.filter(
  (d) => SHIPPING_DETECTOR_IDS.has(d.id) && typeof d.detect === "function",
);

let currentDetector = "";
let currentFile = "";
const calls: Array<{ detector: string; file: string; tool: string; model: string }> = [];
let unservedRequests = 0;

function cannedToolInput(toolName: string): Record<string, unknown> {
  if (toolName === IDOR_TOOL_NAME) return { verdicts: [] };
  if (toolName.startsWith("report_") && toolName.endsWith("_verdict")) {
    return { isVulnerable: false, confidence: "low", reasoning: CANNED_REASONING };
  }
  unservedRequests++;
  throw new Error(
    `measure-trial-triggers: unrecognised tool "${toolName}"; refusing to fall through to the network`,
  );
}

function installSpy(): void {
  const client = getAnthropicClient();
  if (!client) throw new Error("no client to patch after the dummy key was set");
  (client.messages as { create: unknown }).create = async (body: {
    model: string;
    tools?: { name: string }[];
  }): Promise<Message> => {
    const tool = body.tools?.[0]?.name ?? "";
    calls.push({ detector: currentDetector, file: currentFile, tool, model: body.model });
    return {
      id: "msg_measure_trial_triggers",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [
        { type: "tool_use", id: "toolu_measure_trial_triggers", name: tool, input: cannedToolInput(tool) },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Message;
  };
}

async function main(): Promise<void> {
  const [dirArg, label, outPath] = process.argv.slice(2);
  if (!dirArg || !label || !outPath) {
    out.write("usage: measure-trial-triggers <dir> <label> <out.json>\n");
    process.exit(1);
  }
  const root = resolve(dirArg);

  // Preconditions, in the order the stage-3 spy established.
  delete process.env.ANTHROPIC_API_KEY;
  if (getAnthropicClient() !== null) throw new Error("client exists with no key set");
  assertEscalationUnset();
  for (const v of ["FIXOR_REPLAY", "FIXOR_RECORD"]) {
    if (process.env[v]) throw new Error(`${v} is set; refusing to run`);
  }
  process.env.ANTHROPIC_API_KEY = DUMMY_KEY;
  installSpy();

  const { files, skippedDirs } = walkFiles({
    root,
    extensions: new Set(DEFAULT_EXTENSIONS),
  });

  const failures: Array<{ file: string; stage: string; reason: string }> = [];
  const detectorFailures: Array<{ file: string; detector: string; reason: string }> = [];
  let scanned = 0;
  for (const abs of files) {
    const rel = relative(root, abs);
    currentFile = rel;
    let stage = "read";
    try {
      const content = readFileSync(abs, "utf8");
      stage = "build-diff";
      const diff = buildSyntheticDiff(rel, content);
      stage = "resolve-route-guard";
      const guardBody = resolveRemixRouteGuard(abs);
      stage = "detect";
      const ctx: DetectorContext = guardBody
        ? { diff, sidecarsByPath: { [rel]: { [SIDECAR_KINDS.ROUTE_GUARD]: guardBody } } }
        : { diff };
      for (const d of newDetectors) {
        currentDetector = d.id;
        try {
          await d.detect!(ctx);
        } catch (err) {
          detectorFailures.push({ file: rel, detector: d.id, reason: String(err) });
        }
      }
      scanned++;
    } catch (err) {
      failures.push({ file: rel, stage, reason: String(err) });
    }
  }

  if (files.length !== scanned + failures.length) {
    throw new Error(
      `accounting broken: ${files.length} enumerated != ${scanned} scanned + ${failures.length} failed`,
    );
  }
  if (unservedRequests !== 0) throw new Error(`${unservedRequests} unserved requests`);

  const byDetector: Record<string, number> = {};
  for (const d of newDetectors) byDetector[d.id] = 0;
  for (const c of calls) byDetector[c.detector] = (byDetector[c.detector] ?? 0) + 1;
  const filesReaching = new Set(calls.map((c) => c.file)).size;
  const models = [...new Set(calls.map((c) => c.model))];

  const result = {
    label,
    root: label, // the local path is deliberately not recorded
    detectors: newDetectors.map((d) => d.id),
    filesEnumerated: files.length,
    filesScanned: scanned,
    filesFailed: failures.length,
    failures,
    detectorFailures,
    skippedDirCount: skippedDirs.length,
    filesReachingModel: filesReaching,
    modelCalls: calls.length,
    modelCallsByDetector: byDetector,
    models,
    callsPerFile: calls.map((c) => [c.file, c.detector]),
  };
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  out.write(
    `${label}: files ${files.length} (scanned ${scanned}, failed ${failures.length}, detector-throws ${detectorFailures.length}); ` +
      `reaching model ${filesReaching}; calls ${calls.length} ${JSON.stringify(byDetector)}; models ${models.join(",")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`measure-trial-triggers ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
