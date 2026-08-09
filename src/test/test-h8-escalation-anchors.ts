/**
 * H8 Phase 2 acceptance harness — verdict-layer escalation.
 *
 * Two acceptance checks, both required:
 *
 *  PHASE A — OFF-PATH INERTNESS (no API key needed). With the flag unset,
 *  resolveMediumVerdict must return "review-queue" synchronously AND leave
 *  lastEscalationDiag null — proving no client is constructed and no call is
 *  made. This is the structural guarantee that the six refactored MEDIUM
 *  branches are byte-identical to pre-H8 on the default path.
 *
 *  PHASE B — ON-PATH K-REPLAY (paid; ARMED ONLY by FIXOR_H8_LIVE=1, and needs
 *  ANTHROPIC_API_KEY). Opus 4.8 has
 *  no temperature:0 and is NOT run-to-run deterministic, so each of the four
 *  pinned anchors is replayed K times (default 5) and ANY flip is a FAIL.
 *  Pass condition is binary — all four anchors must reach their pinned
 *  verdict on EVERY replay:
 *    POS-15 (outlook no-compare)          → emit-high   (promote)
 *    outlook neg/15 (clientState challenge) → drop       (clear)
 *    H5 idor-tenant neg/02 (membership)   → drop         (clear)
 *    apple neg/14 (cross-file verifier)   → review-queue (stay-uncertain)
 *
 * Every escalation call's USD cost is summed and reported after each replay.
 * A defensive HALT aborts if cumulative spend crosses $2. All raw results
 * are written to test-output/h8-escalation/.
 *
 * ARMING, AND WHY KEY PRESENCE IS NOT CONSENT. The npm script runs with
 * --env-file=.env, so a real key is in the environment on EVERY invocation
 * whether or not anyone meant to spend. Key presence therefore cannot be the
 * opt-in, and until FIXOR_H8_LIVE existed this harness had none: the key check
 * below tested for a condition the script itself guaranteed, so `npm run
 * test:h8-escalation` spent on contact. Unarmed, it now runs Phase A and exits
 * NON-ZERO, because the contract above is two acceptance checks BOTH required
 * and a run that performed one of two has not passed.
 * Paid run: FIXOR_H8_LIVE=1 npm run test:h8-escalation
 *
 * The first-pass ("original") reasoning fed to the adjudicator is held
 * NEUTRAL and, for the two opposite-outcome clientState anchors (POS-15 and
 * outlook neg/15), is the IDENTICAL string — so the reasoning cannot carry
 * the answer; the adjudicator must decide from the whole file alone.
 *
 * SCOPE: passing authorizes ONLY "the wiring is correct and fail-safe."
 * It does NOT authorize flipping the flag on for real scans or any
 * escalation-accuracy claim. The flag ships OFF and stays OFF.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveMediumVerdict,
  resetEscalationDiag,
  lastEscalationDiag,
  type EscalationDecision,
} from "../analysis-engine/verdict-escalation";
import type { FindingType } from "../analysis-engine/types";

const FLAG = "FIXOR_ESCALATE_MEDIUM";
const LIVE_FLAG = "FIXOR_H8_LIVE";
const K = Number.parseInt(process.env.H8_REPLAYS ?? "5", 10) || 5;
const HALT_USD = 2.0;
const OUT_DIR = "test-output/h8-escalation";

const out = process.stdout;

let cumulativeUsd = 0;

// Neutral first-pass reasoning shared by the two clientState anchors so it
// cannot leak the (opposite) correct answers — the file decides.
const CLIENTSTATE_NEUTRAL =
  "A webhook handler reads notification.clientState; it is unclear whether the request is adequately verified before the notification is processed.";

interface Anchor {
  id: string;
  detectorId: string;
  findingType: FindingType;
  file: string;
  candidateLine: number;
  originalReasoning: string;
  expected: EscalationDecision;
  note: string;
}

const ANCHORS: Anchor[] = [
  {
    id: "POS-15-outlook-no-compare",
    detectorId: "webhook-unverified-multi",
    findingType: "webhook_unverified_risk",
    file: "fixtures/webhook-unverified/positive/15-app-router-graph-clientstate-no-compare.ts",
    candidateLine: 28,
    originalReasoning: CLIENTSTATE_NEUTRAL,
    expected: "emit-high",
    note: "real vuln stuck at MEDIUM — reads clientState, no compare; must PROMOTE",
  },
  {
    id: "neg-15-outlook-clientstate-challenge",
    detectorId: "webhook-unverified-multi",
    findingType: "webhook_unverified_risk",
    file: "fixtures/webhook-unverified/negative/15-app-router-graph-clientstate-challenge.ts",
    candidateLine: 30,
    originalReasoning: CLIENTSTATE_NEUTRAL,
    expected: "drop",
    note: "safe — in-file compare vs env + 403 (MS-Graph shared-secret); must CLEAR",
  },
  {
    id: "H5-idor-tenant-neg-02-membership",
    detectorId: "idor-multi",
    findingType: "idor_risk",
    file: "fixtures/idor-tenant/negative/02-express-prisma-membership.ts",
    candidateLine: 23,
    originalReasoning:
      "A GET-by-id handler fetches a record by request id and performs an additional database lookup before returning it; it is unclear whether access is adequately scoped to the caller's tenant.",
    expected: "drop",
    note: "safe — in-file membership-table check gates org access; must CLEAR",
  },
  {
    id: "neg-14-apple-cross-file-verifier",
    detectorId: "webhook-unverified-multi",
    findingType: "webhook_unverified_risk",
    file: "fixtures/webhook-unverified/negative/14-app-router-apple-cross-file-verifier-helper.ts",
    candidateLine: 22,
    originalReasoning:
      "A webhook handler invokes a verification-suggesting helper on the payload before processing; it is unclear whether verification is adequately enforced.",
    expected: "review-queue",
    note: "safe but verifier is CROSS-FILE — unconfirmable here; must STAY-UNCERTAIN (a clear/promote = clearing on evidence it lacks = FAIL)",
  },
];

interface ReplayResult {
  k: number;
  decision: EscalationDecision;
  decisionRaw: string | null;
  reasoning: string | null;
  failure: string | null;
  usd: number;
}

interface AnchorOutcome {
  anchor: Anchor;
  replays: ReplayResult[];
  pass: boolean;
  flipped: boolean;
}

function stripFixtureComments(src: string): string {
  // The whole file is sent as-is to the adjudicator. Fixtures carry an
  // ASSUMED-PATH header and (negatives) descriptive comments. Per
  // detector-test-rules F1, scanned files carry NO safety-asserting
  // comments inside the code — but these fixtures DO have explanatory
  // header comments that would leak the verdict. Strip leading // comment
  // lines so the adjudicator judges the CODE, not the fixture's narration.
  const lines = src.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    if (t.startsWith("//") || t === "") {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

async function replayAnchor(anchor: Anchor): Promise<AnchorOutcome> {
  const raw = readFileSync(anchor.file, "utf8");
  const code = stripFixtureComments(raw);
  const replays: ReplayResult[] = [];

  for (let k = 1; k <= K; k++) {
    resetEscalationDiag();
    const decision = await resolveMediumVerdict({
      detectorId: anchor.detectorId,
      findingType: anchor.findingType,
      filePath: anchor.file,
      candidateLine: anchor.candidateLine,
      originalReasoning: anchor.originalReasoning,
      wholeFileContent: code,
    });
    const diag = lastEscalationDiag;
    if (!diag) {
      // Flag off or no call made — should never happen in Phase B.
      throw new Error(
        `escalation made no call for ${anchor.id} (flag off or inert) — Phase B requires the flag ON and a valid API key`,
      );
    }
    const r: ReplayResult = {
      k,
      decision,
      decisionRaw: diag.decisionRaw,
      reasoning: diag.reasoning,
      failure: diag.failure,
      usd: diag.usd,
    };
    replays.push(r);

    cumulativeUsd += r.usd;
    out.write(
      `    [k=${k}] decision=${decision} (raw=${r.decisionRaw ?? "—"})` +
        `${r.failure ? ` failure=${r.failure}` : ""}` +
        ` cost=$${r.usd.toFixed(5)}  cumulative=$${cumulativeUsd.toFixed(5)}\n`,
    );
    if (r.reasoning) out.write(`           reason: ${r.reasoning}\n`);

    // Coverage-gated stop: any failed call halts immediately.
    if (r.failure) {
      throw new Error(
        `escalation CALL FAILED for ${anchor.id} (reason=${r.failure}) — stopping per coverage gate`,
      );
    }
    if (cumulativeUsd >= HALT_USD) {
      throw new Error(
        `HALT: cumulative spend $${cumulativeUsd.toFixed(4)} crossed $${HALT_USD}`,
      );
    }
  }

  const decisions = replays.map((r) => r.decision);
  const flipped = new Set(decisions).size > 1;
  const pass = !flipped && decisions.every((d) => d === anchor.expected);
  return { anchor, replays, pass, flipped };
}

async function runOffPathInertness(): Promise<boolean> {
  out.write("PHASE A — off-path inertness (flag unset)\n");
  const saved = process.env[FLAG];
  delete process.env[FLAG];
  resetEscalationDiag();

  let ok = true;
  const decision = await resolveMediumVerdict({
    detectorId: "webhook-unverified-multi",
    findingType: "webhook_unverified_risk",
    filePath:
      "fixtures/webhook-unverified/negative/14-app-router-apple-cross-file-verifier-helper.ts",
    candidateLine: 22,
    originalReasoning: "inertness probe",
    wholeFileContent: "// probe\n",
  });
  if (decision !== "review-queue") {
    out.write(`  FAIL: off-path decision was ${decision}, expected review-queue\n`);
    ok = false;
  } else {
    out.write("  OK: off-path returns review-queue\n");
  }
  if (lastEscalationDiag !== null) {
    out.write(
      `  FAIL: lastEscalationDiag is not null off-path (a call was made): ${JSON.stringify(lastEscalationDiag)}\n`,
    );
    ok = false;
  } else {
    out.write("  OK: no escalation call made off-path (lastEscalationDiag null)\n");
  }
  if (saved !== undefined) process.env[FLAG] = saved;
  return ok;
}

async function main(): Promise<void> {
  out.write(`H8 escalation acceptance — K=${K} replays/anchor, HALT at $${HALT_USD}\n\n`);

  // PHASE A — always runs, no key needed.
  const offPathOk = await runOffPathInertness();
  out.write(`PHASE A result: ${offPathOk ? "PASS" : "FAIL"}\n\n`);
  if (!offPathOk) {
    out.write("Off-path inertness FAILED — not proceeding to paid Phase B.\n");
    process.exit(1);
  }

  // PHASE B — paid, and armed only by a deliberate act. This check MUST precede
  // the FLAG assignment below: declining after mutating process env would leave
  // escalation switched on in a process that is about to refuse to use it.
  //
  // Both decline paths report Phase A from `offPathOk` rather than asserting it
  // passed. The assertion would be TRUE here today - a failing Phase A exits
  // above and cannot reach these lines - but it would be true only by virtue of
  // that upstream guard, and would become a silent lie if the guard were ever
  // weakened. Printing the measured value cannot desynchronise from it.
  if (process.env[LIVE_FLAG] !== "1") {
    out.write(
      `\nPHASE B NOT RUN: ${LIVE_FLAG} is not set to 1, so the paid acceptance did not execute.\n` +
        `Phase A: ${offPathOk ? "PASS" : "FAIL"}. This harness requires BOTH phases, and one of two ran, so this is NOT a pass.\n` +
        `To spend (${ANCHORS.length} anchors x ${K} replays = ${ANCHORS.length * K} Opus 4.8 calls, HALT at $${HALT_USD}):\n` +
        `  ${LIVE_FLAG}=1 npm run test:h8-escalation\n`,
    );
    process.exit(1);
  }
  process.env[FLAG] = "true";
  if (!process.env.ANTHROPIC_API_KEY) {
    out.write(
      `\nPHASE B NOT RUN: ANTHROPIC_API_KEY is not set, so the paid acceptance did not execute.\n` +
        `Phase A: ${offPathOk ? "PASS" : "FAIL"}. This harness requires BOTH phases, and one of two ran, so this is NOT a pass.\n`,
    );
    process.exit(1);
  }

  out.write(`PHASE B — on-path K-replay (flag ON, K=${K})\n`);
  out.write(
    `Rough pre-run cost estimate: ${ANCHORS.length} anchors x ${K} replays = ${ANCHORS.length * K} Opus 4.8 calls,\n` +
      `  ~1-2k input + ~150 output tokens each at $5/$25 per MTok ≈ $${(ANCHORS.length * K * 0.012).toFixed(2)} total.\n\n`,
  );

  const outcomes: AnchorOutcome[] = [];
  for (const anchor of ANCHORS) {
    out.write(`ANCHOR ${anchor.id}\n`);
    out.write(`  expect: ${anchor.expected}  (${anchor.note})\n`);
    const outcome = await replayAnchor(anchor);
    outcome.pass
      ? out.write(`  => PASS (stable ${anchor.expected} across ${K} replays)\n\n`)
      : out.write(
          `  => FAIL (flipped=${outcome.flipped}; got [${outcome.replays.map((r) => r.decision).join(", ")}])\n\n`,
        );
    outcomes.push(outcome);
  }

  const allPass = outcomes.every((o) => o.pass);

  // Persist raw results.
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = process.env.H8_RUN_STAMP ?? "run";
  const logPath = join(OUT_DIR, `anchors-${stamp}.json`);
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        k: K,
        model: "claude-opus-4-8",
        cumulativeUsd,
        allPass,
        outcomes: outcomes.map((o) => ({
          id: o.anchor.id,
          expected: o.anchor.expected,
          pass: o.pass,
          flipped: o.flipped,
          decisions: o.replays.map((r) => r.decision),
          replays: o.replays,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  out.write("──────────────────────────────────────────────\n");
  out.write(`SUMMARY  (K=${K})\n`);
  for (const o of outcomes) {
    out.write(
      `  ${o.pass ? "PASS" : "FAIL"}  ${o.anchor.id.padEnd(40)} expect=${o.anchor.expected} got=[${o.replays.map((r) => r.decision).join(",")}]\n`,
    );
  }
  out.write(`\nCumulative spend: $${cumulativeUsd.toFixed(5)}\n`);
  out.write(`Raw log: ${logPath}\n`);
  out.write(`RESULT: ${allPass ? "ALL ANCHORS PASS" : "FAILED"}\n`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  out.write(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  out.write(`Cumulative spend at error: $${cumulativeUsd.toFixed(5)}\n`);
  process.exit(1);
});
