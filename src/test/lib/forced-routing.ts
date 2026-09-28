/**
 * Forced routing (pre-registered 2026-09-28, NOT RUN as of this commit).
 * Pre-registration: docs/measurements/arm-a-verdict-read-2026-09-28/forced-routing-prereg-2026-09-28.md
 * Inputs and amendment A1: docs/measurements/forced-routing-2026-09-28/
 *
 * WHAT THIS MEASURES. Handed the defect's file, by the lane that owns it,
 * with the SHIPPED prompt and payload code, does the model flag it? It is a
 * ceiling on what routing work can buy, not shipped behaviour: the anchor
 * line comes from the fix diff, which no router has.
 *
 * HOW THE SHIPPED CODE IS REACHED WITHOUT CHANGING IT.
 *   auth-bypass, admin-check: the real `analyzeFile` runs; only the private
 *     `prefilterRegex` is swapped, per call, for one returning a single
 *     `express_route_def` trigger at the anchor line. Everything after the
 *     prefilter (whole-file payload, imports, prompt, parsing, verdict) is
 *     the shipped path.
 *   idor: the shipped prefilter enumerates pairs from module-level pattern
 *     tables that cannot be reached from outside, so the private `callLlm`
 *     is called with one pair built here; `langDisplay` and `extractImports`
 *     are mirrored below. `test:forced-routing-rehearsal` proves the mirror:
 *     on a fixture that pairs naturally, the forced request and the shipped
 *     request are byte-identical.
 *
 * MONEY. One `guardedCreate` wrapper sits at the SDK boundary in BOTH modes
 * (live: `client.messages.create`; mock: the callClaude test seam). Before
 * every attempt, including production callClaude's own retries, it refuses
 * when measured spend plus a conservative bound for THIS call would pass the
 * ceiling. Measured spend is production `calculateCost` over the response
 * usage; the runner cross-checks it against callClaude's `lastCallCost`.
 * The ceiling can be lowered on the command line, never raised above the
 * pre-registered $18.00.
 *
 * NO PRODUCTION CODE, NO DATABASE. Everything here is under src/test.
 * cost-store's Postgres ledger fires only with an installationId in the
 * async context, which this process never sets.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Message } from "@anthropic-ai/sdk/resources/messages";

import {
  getAnthropicClient,
  lastCallCost,
  resetLastCallCost,
  setCallClaudeTestDeps,
} from "../../analysis-engine/anthropic-client";
import { AdminCheckDetector } from "../../analysis-engine/detectors/admin-check.detector";
import { AuthBypassDetector } from "../../analysis-engine/detectors/auth-bypass.detector";
import { IdorDetector, idorPrefilterHits } from "../../analysis-engine/detectors/idor.detector";
import { SYSTEM_PROMPT_FINGERPRINT as ADMIN_FP } from "../../analysis-engine/detectors/admin-check.detector";
import { SYSTEM_PROMPT_FINGERPRINT as AUTH_FP } from "../../analysis-engine/detectors/auth-bypass.detector";
import { SYSTEM_PROMPT_FINGERPRINT as IDOR_FP } from "../../analysis-engine/detectors/idor.detector";
import { calculateCost } from "../../services/cost-tracking.service";
import type { ClaudeModelId } from "../../config/models";
import { assertEscalationUnset } from "../replay-harness";

export type Lane = "auth-bypass" | "admin-check" | "idor";
export type Side = "parent" | "fix" | "clean";
export type Lang = "ts" | "tsx" | "js" | "jsx";

export const PREREG_PATH =
  "docs/measurements/arm-a-verdict-read-2026-09-28/forced-routing-prereg-2026-09-28.md";
export const ADMISSION_PATH =
  "docs/measurements/detector-reach-2026-09-27/held-out-admission-2026-09-27.md";
export const INPUTS_DIR = "docs/measurements/forced-routing-2026-09-28";
/** sha256 over LF-normalised bytes; pinned at the commit that landed the runner. */
export const PREREG_SHA256 = "01bf8a622c7523bfe8230fe9c1e00af8f801a78454790e4970b58239f13aa4ef";
export const ADMISSION_SHA256 = "3e44b0097061b7d97538cf267619c51b38d1281060e49c90cf608209a2960219";

export function sha256Lf(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}
export function gitBlobSha(buf: Buffer): string {
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// Inputs, read from the committed documents (never from a session's memory).
// ---------------------------------------------------------------------------

export interface Prereg {
  ceilingUsd: number;
  runs: number;
  /** Arm A diagnostic set: case -> { path, lane } from the pre-registration prose. */
  diagnostic: Array<{ case: string; pathSuffix: string; lane: Lane }>;
}

export function readPrereg(repoRoot: string): Prereg {
  const text = readFileSync(join(repoRoot, PREREG_PATH), "utf8");
  const sha = sha256Lf(text);
  if (sha !== PREREG_SHA256) {
    throw new Error(`pre-registration changed: sha256 ${sha} != pinned ${PREREG_SHA256}; refusing`);
  }
  const ceil = /\*\*Hard ceiling \$(\d+\.\d\d)\*\*/.exec(text);
  const runs = /n = (\d+) per file/.exec(text);
  if (!ceil || !runs) throw new Error("pre-registration: ceiling or n not found");
  const diagRe =
    /Arm A 02\s+`([^`]+)`\s+\((admin-check)\),\s*04\s+`([^`]+)`\s+\((idor)\),\s*07\s+`([^`]+)`\s+\((idor)\),\s*10\s+`([^`]+)`\s+\((idor)\),\s*05\s+`([^`]+)`\s+\((auth-bypass)\)/;
  const m = diagRe.exec(text.replace(/\n/g, " "));
  if (!m) throw new Error("pre-registration: diagnostic set sentence not found");
  return {
    ceilingUsd: Number(ceil[1]),
    runs: Number(runs[1]),
    diagnostic: [
      { case: "02", pathSuffix: m[1]!, lane: m[2] as Lane },
      { case: "04", pathSuffix: m[3]!, lane: m[4] as Lane },
      { case: "07", pathSuffix: m[5]!, lane: m[6] as Lane },
      { case: "10", pathSuffix: m[7]!, lane: m[8] as Lane },
      { case: "05", pathSuffix: m[9]!, lane: m[10] as Lane },
    ],
  };
}

/** Held-out case -> primary lane, from the admission table's "lane family / primary" column. */
export function readAdmissionLanes(repoRoot: string): Map<string, Lane> {
  const text = readFileSync(join(repoRoot, ADMISSION_PATH), "utf8");
  const sha = sha256Lf(text);
  if (sha !== ADMISSION_SHA256) {
    throw new Error(`admission record changed: sha256 ${sha} != pinned ${ADMISSION_SHA256}; refusing`);
  }
  const lanes = new Map<string, Lane>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\| (\d\d) \| GHSA-[\w-]+ \| [^|]+ \| access-control \/ (auth-bypass|admin-check|idor) \|/.exec(line);
    if (m) lanes.set(m[1]!, m[2] as Lane);
  }
  if (lanes.size !== 10) throw new Error(`admission table: expected 10 lane rows, found ${lanes.size}`);
  return lanes;
}

export interface Target {
  set: "held-out" | "arm-a-diagnostic" | "clean";
  case: string; // held-out/arm-a case id, or "clean"
  side: Side;
  lane: Lane;
  repo: string;
  commit: string;
  path: string;
  blobSha: string;
  anchorLine: number;
  abs: string;
}

function tsvRows(file: string): Record<string, string>[] {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const hdr = lines[0]!.split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [hdr[i]!, v])));
}

/**
 * Every call target, in the pre-registered order: held-out (judged), Arm A
 * diagnostic (not judged), clean (false positives). `corpusRoot` is the
 * directory holding the sibling corpora `held-out-corpus-2026-09-27/` and
 * `field-trial-corpus-2026-09-19/`.
 */
export function readTargets(repoRoot: string, corpusRoot: string): Target[] {
  const prereg = readPrereg(repoRoot);
  const lanes = readAdmissionLanes(repoRoot);
  const inputs = join(repoRoot, INPUTS_DIR);
  const held = join(corpusRoot, "held-out-corpus-2026-09-27");
  const arma = join(corpusRoot, "field-trial-corpus-2026-09-19");
  const targets: Target[] = [];
  for (const r of tsvRows(join(inputs, "anchors-2026-09-28.tsv"))) {
    const side = r.side as Side;
    let lane: Lane;
    let abs: string;
    if (r.set === "held-out") {
      lane = lanes.get(r.case)!;
      abs = join(held, side === "parent" ? "known-answer" : "known-answer-fixed", r.case, r.path);
    } else {
      const d = prereg.diagnostic.find((x) => x.case === r.case && r.path.endsWith(x.pathSuffix));
      if (!d) throw new Error(`anchor row ${r.case} ${r.path} is not in the pre-registered diagnostic set`);
      lane = d.lane;
      abs =
        r.case === "05"
          ? join(held, side === "parent" ? "arm-a-05-supplement" : "arm-a-05-supplement-fixed", r.path)
          : join(arma, side === "parent" ? "known-answer" : "known-answer-fixed", r.case, r.path);
    }
    if (!lane) throw new Error(`no lane for ${r.set} ${r.case}`);
    targets.push({ set: r.set as Target["set"], case: r.case, side, lane, repo: r.repo, commit: r.commit, path: r.path, blobSha: r.blob_sha1, anchorLine: Number(r.anchor_line), abs });
  }
  for (const r of tsvRows(join(inputs, "clean-draw-2026-09-28.tsv"))) {
    targets.push({ set: "clean", case: "clean", side: "clean", lane: r.lane as Lane, repo: r.repo, commit: r.head, path: r.path, blobSha: r.blob_sha1, anchorLine: Number(r.anchor_line), abs: join(arma, "live", r.repo, r.path) });
  }
  const expect = { "held-out": 30, "arm-a-diagnostic": 10, clean: 30 };
  for (const [set, n] of Object.entries(expect)) {
    const got = targets.filter((t) => t.set === set).length;
    if (got !== n) throw new Error(`target count for ${set}: ${got}, pre-registered ${n}`);
  }
  return targets;
}

/** Every target file must exist and match its recorded git blob sha. Returns the mismatches. */
export function verifyCorpus(targets: Target[]): string[] {
  const bad: string[] = [];
  for (const t of targets) {
    if (!existsSync(t.abs)) {
      bad.push(`missing: ${t.abs}`);
      continue;
    }
    const sha = gitBlobSha(readFileSync(t.abs));
    if (sha !== t.blobSha) bad.push(`blob mismatch: ${t.set} ${t.case} ${t.side} ${t.path} ${sha} != ${t.blobSha}`);
  }
  return bad;
}

export function shippedFingerprints(): Record<Lane, string> {
  return { "auth-bypass": AUTH_FP, "admin-check": ADMIN_FP, idor: IDOR_FP };
}

// ---------------------------------------------------------------------------
// The guarded SDK boundary: ceiling, request and response files, cost.
// ---------------------------------------------------------------------------

export class CeilingRefusal extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CeilingRefusal";
  }
}

export interface CallRecord {
  n: number;
  target: Omit<Target, "abs">;
  run: number;
  model: string;
  tool: string;
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  costUsd: number;
  cumulativeUsd: number;
  startedAt: string;
  endedAt: string;
}

export interface Guard {
  create: (body: unknown, opts?: { signal?: AbortSignal }) => Promise<Message>;
  measuredUsd: () => number;
  calls: () => number;
  /** Set by the runner before each detector call so records carry their target. */
  setContext: (ctx: { target: Omit<Target, "abs">; run: number }) => void;
  records: CallRecord[];
  /**
   * Latched the first time an attempt is refused. Production callClaude
   * swallows the thrown refusal as a failed attempt and returns ok:false, so
   * the runner reads this after every detector call and stops the run; the
   * throw alone would only null one verdict.
   */
  refused: () => string | null;
}

/**
 * Conservative upper bound on one call's cost from the REQUEST alone:
 * every character of system + messages at 2.5 chars/token, all billed as a
 * cache write (1.25x input price), plus max_tokens of output. It overstates
 * a real call several-fold, which is the point: measured + bound <= ceiling
 * means the ceiling cannot be crossed by this attempt.
 */
export function boundUsd(body: { model: string; max_tokens?: number; system?: unknown; messages?: unknown }): number {
  const chars = JSON.stringify(body.system ?? "").length + JSON.stringify(body.messages ?? []).length;
  const inputTokens = Math.ceil(chars / 2.5);
  return calculateCost({
    model: body.model as ClaudeModelId,
    inputTokens: 0,
    outputTokens: body.max_tokens ?? 8192,
    cacheCreationInputTokens: inputTokens,
    cacheReadInputTokens: 0,
  });
}

export function makeGuard(opts: {
  inner: (body: unknown, o?: { signal?: AbortSignal }) => Promise<Message>;
  ceilingUsd: number;
  outDir: string;
}): Guard {
  const callsDir = join(opts.outDir, "calls");
  mkdirSync(callsDir, { recursive: true });
  let measured = 0;
  let maxSeen = 0;
  let n = 0;
  let refusedMsg: string | null = null;
  let ctx: { target: Omit<Target, "abs">; run: number } | null = null;
  const records: CallRecord[] = [];
  const create = async (body: unknown, o?: { signal?: AbortSignal }): Promise<Message> => {
    if (refusedMsg) throw new CeilingRefusal(refusedMsg);
    const b = body as { model: string; max_tokens?: number; system?: unknown; messages?: unknown; tools?: { name: string }[] };
    // The bound is the larger of what THIS request can bill and what any
    // earlier call in this run actually billed, so a response that reports
    // more usage than its request justifies still cannot walk the total
    // past the ceiling.
    const bound = Math.max(boundUsd(b), maxSeen);
    if (measured + bound > opts.ceilingUsd) {
      refusedMsg = `refused attempt ${n + 1}: measured $${measured.toFixed(4)} + bound $${bound.toFixed(4)} > ceiling $${opts.ceilingUsd.toFixed(2)}`;
      throw new CeilingRefusal(refusedMsg);
    }
    n++;
    const id = String(n).padStart(4, "0");
    const startedAt = new Date().toISOString();
    // The request is on disk BEFORE the network is touched.
    writeFileSync(join(callsDir, `${id}-request.json`), JSON.stringify({ n, context: ctx, startedAt, body }, null, 2));
    const message = await opts.inner(body, o);
    const u = (message.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
    const costUsd = calculateCost({ model: b.model as ClaudeModelId, inputTokens: usage.input, outputTokens: usage.output, cacheCreationInputTokens: usage.cacheWrite, cacheReadInputTokens: usage.cacheRead });
    measured += costUsd;
    if (costUsd > maxSeen) maxSeen = costUsd;
    if (measured > opts.ceilingUsd && !refusedMsg) {
      refusedMsg = `measured $${measured.toFixed(4)} passed the ceiling $${opts.ceilingUsd.toFixed(2)} on call ${n}; no further attempt`;
    }
    const rec: CallRecord = {
      n,
      target: ctx?.target ?? ({} as Omit<Target, "abs">),
      run: ctx?.run ?? 0,
      model: b.model,
      tool: b.tools?.[0]?.name ?? "",
      usage,
      costUsd,
      cumulativeUsd: measured,
      startedAt,
      endedAt: new Date().toISOString(),
    };
    records.push(rec);
    writeFileSync(join(callsDir, `${id}-response.json`), JSON.stringify({ ...rec, message }, null, 2));
    appendFileSync(join(opts.outDir, "calls.jsonl"), JSON.stringify(rec) + "\n");
    return message;
  };
  return { create, measuredUsd: () => measured, calls: () => n, setContext: (c) => (ctx = c), records, refused: () => refusedMsg };
}

// ---------------------------------------------------------------------------
// The forced call into each lane's shipped model stage.
// ---------------------------------------------------------------------------

export interface Verdict {
  isVulnerable: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  extra?: Record<string, unknown>;
}

export function langFor(path: string): Lang {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") return ext;
  throw new Error(`unsupported extension: ${path}`);
}

/** Mirror of the detectors' private helper; proved byte-identical by the rehearsal. */
export function mirrorLangDisplay(lang: Lang): string {
  return lang === "ts" || lang === "tsx" ? "typescript" : "javascript";
}
/** Mirror of idor.detector.ts extractImports; proved byte-identical by the rehearsal. */
export function mirrorExtractImports(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.min(40, lines.length); i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (
      /^(import|from\s+\S+\s+import|require\s*\(|const\s+\S+\s*=\s*require|package\s+\w+|@app\.|use\s+strict|"use\s+\w+")/.test(trimmed) ||
      /^[A-Z_].* = require\(/.test(trimmed) ||
      /^require(_relative)?\s+/.test(trimmed)
    ) {
      out.push(line);
    }
  }
  return out.join("\n");
}

export interface Detectors {
  "auth-bypass": AuthBypassDetector;
  "admin-check": AdminCheckDetector;
  idor: IdorDetector;
}
export function makeDetectors(): Detectors {
  return { "auth-bypass": new AuthBypassDetector(), "admin-check": new AdminCheckDetector(), idor: new IdorDetector() };
}

/**
 * One forced call. Returns the raw model verdict the lane parsed (null when
 * the call failed or the verdict was malformed), plus callClaude's own cost
 * diagnostic for the cross-check.
 */
export async function forcedCall(
  dets: Detectors,
  lane: Lane,
  filePath: string,
  content: string,
  anchorLine: number,
): Promise<{ verdict: Verdict | null; lastCallCostUsd: number | null }> {
  const lang = langFor(filePath);
  const lines = content.split(/\r?\n/);
  const anchorText = (lines[anchorLine - 1] ?? "").trim().slice(0, 200);
  resetLastCallCost();
  if (lane === "idor") {
    const det = dets.idor as unknown as {
      callLlm: (p: {
        filePath: string;
        language: string;
        fileBody: string;
        bodyIsWholeFile: boolean;
        imports: string;
        pairs: Array<{ source: { patternId: string; patternText: string; line: number }; sink: { patternId: string; patternText: string; line: number }; distance: number }>;
        sidecars?: Record<string, string>;
      }) => Promise<Map<number, Verdict> | null>;
    };
    // Source: the nearest shipped SOURCE hit at any distance; else the anchor itself.
    const { sources } = idorPrefilterHits(content, lang);
    let src: { patternId: string; patternText: string; line: number } = { patternId: "forced_anchor", patternText: anchorText, line: anchorLine };
    let best = Infinity;
    for (const s of sources) {
      const d = Math.abs(s.line - anchorLine);
      if (d < best) {
        best = d;
        src = s;
      }
    }
    const pair = { source: src, sink: { patternId: "forced_anchor", patternText: anchorText, line: anchorLine }, distance: Math.abs(src.line - anchorLine) };
    if (Buffer.byteLength(content, "utf8") > 200_000) throw new Error(`${filePath} is over the 200 KB whole-file cap; the pre-registration admits no such file`);
    const map = await det.callLlm({ filePath, language: mirrorLangDisplay(lang), fileBody: content, bodyIsWholeFile: true, imports: mirrorExtractImports(content), pairs: [pair] });
    const v = map?.get(0) ?? null;
    return { verdict: v ? { isVulnerable: v.isVulnerable, confidence: v.confidence, reasoning: v.reasoning, extra: v as unknown as Record<string, unknown> } : null, lastCallCostUsd: lastCallCost?.costUsd ?? null };
  }
  const det = dets[lane] as unknown as {
    prefilterRegex: (content: string, filePath: string) => Array<{ patternId: string; patternText: string; line: number }>;
    analyzeFile: (filePath: string, content: string, lang: Lang) => Promise<unknown>;
    lastDiagnostics: Array<{ verdict?: Verdict | null }>;
  };
  const original = det.prefilterRegex;
  det.prefilterRegex = () => [{ patternId: "express_route_def", patternText: anchorText, line: anchorLine }];
  try {
    det.lastDiagnostics.length = 0;
    await det.analyzeFile(filePath, content, lang);
  } finally {
    det.prefilterRegex = original;
  }
  const v = det.lastDiagnostics[0]?.verdict ?? null;
  return { verdict: v ? { isVulnerable: v.isVulnerable, confidence: v.confidence, reasoning: v.reasoning, extra: v as unknown as Record<string, unknown> } : null, lastCallCostUsd: lastCallCost?.costUsd ?? null };
}

// ---------------------------------------------------------------------------
// Scoring, exactly the pre-registered rules.
// ---------------------------------------------------------------------------

export interface FileResult {
  set: Target["set"];
  case: string;
  side: Side;
  lane: Lane;
  repo: string;
  path: string;
  verdicts: Array<Verdict | null>; // one per run, in run order
}

export function emits(v: Verdict | null): boolean {
  return !!v && v.isVulnerable && (v.confidence === "high" || v.confidence === "medium");
}

export function score(results: FileResult[], runs: number): Record<string, unknown> {
  const byKey = new Map<string, FileResult>();
  for (const r of results) byKey.set(`${r.set}|${r.case}|${r.side}|${r.path}`, r);
  const need = Math.ceil(runs * 4 / 5); // >= 4 of 5
  const fileHits: Record<string, boolean> = {};
  const caseHits: Record<string, boolean> = {};
  const complete = results.every((r) => r.verdicts.length === runs);
  for (const r of results) {
    if (r.side !== "parent") continue;
    const fix = byKey.get(`${r.set}|${r.case}|fix|${r.path}`);
    const parentHits = r.verdicts.filter(emits).length;
    const fixHits = fix ? fix.verdicts.filter(emits).length : 0;
    const hit = r.verdicts.length === runs && !!fix && fix.verdicts.length === runs && parentHits >= need && fixHits <= runs - need;
    fileHits[`${r.set}|${r.case}|${r.path}`] = hit;
    if (r.set !== "clean") caseHits[`${r.set}|${r.case}`] = (caseHits[`${r.set}|${r.case}`] ?? false) || hit;
  }
  const heldCases = Object.entries(caseHits).filter(([k]) => k.startsWith("held-out|"));
  const heldHits = heldCases.filter(([, v]) => v).length;
  const cleanFlags: string[] = [];
  for (const r of results) {
    if (r.set === "clean" && r.verdicts.filter(emits).length >= need) cleanFlags.push(`${r.repo}:${r.path}`);
  }
  const fixFlags = results.filter((r) => r.side === "fix" && r.verdicts.filter(emits).length >= need).map((r) => `${r.set}|${r.case}|${r.path}`);
  const recall = !complete ? "INCOMPLETE" : heldHits >= 4 ? "PASS" : heldHits <= 1 ? "FAIL" : "INCONCLUSIVE";
  const noise = !complete ? "INCOMPLETE" : cleanFlags.length > 3 ? "TOO NOISY" : "ok";
  return { complete, runs, perFileHits: fileHits, perCaseHits: caseHits, heldOutCaseHits: heldHits, heldOutCases: heldCases.length, recallVerdict: recall, cleanFlags, cleanFlagCount: cleanFlags.length, noiseVerdict: noise, fixSideFlags: fixFlags };
}

// ---------------------------------------------------------------------------
// Mode wiring.
// ---------------------------------------------------------------------------

export function assertNoAmbientKey(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is set in the environment; this runner takes the key only from --key-file, refusing");
  }
  assertEscalationUnset();
  for (const v of ["FIXOR_REPLAY", "FIXOR_RECORD"]) {
    if (process.env[v]) throw new Error(`${v} is set; refusing`);
  }
}

/** Live: install the guard on the real SDK client. The key comes from the file and nowhere else. */
export function wireLive(keyFile: string, guardFactory: (inner: Guard["create"]) => Guard): Guard {
  assertNoAmbientKey();
  const key = readFileSync(resolve(keyFile), "utf8").trim();
  if (!/^sk-ant-/.test(key)) throw new Error("--key-file does not hold an Anthropic key; refusing");
  process.env.ANTHROPIC_API_KEY = key;
  const client = getAnthropicClient();
  if (!client) throw new Error("no client after the key was set");
  const messages = client.messages as unknown as { create: (b: unknown, o?: { signal?: AbortSignal }) => Promise<Message> };
  const inner = messages.create.bind(client.messages);
  const guard = guardFactory(inner);
  messages.create = guard.create;
  return guard;
}

export interface MockOptions {
  /** Multiply the canned usage (default 1) to rehearse the ceiling. */
  usageMultiplier?: number;
  /** Answer true on parent-side calls (exercises the hit path of the scorer). */
  flagParent?: boolean;
  /** Current context, supplied by the runner so the mock knows the side. */
  side?: () => Side | undefined;
}

/** Mock: the callClaude test seam; no client, no key, no network. */
export function wireMock(opts: MockOptions, guardFactory: (inner: Guard["create"]) => Guard): Guard {
  assertNoAmbientKey();
  if (getAnthropicClient() !== null) throw new Error("a client exists with no key; refusing");
  const mult = opts.usageMultiplier ?? 1;
  const inner = async (body: unknown): Promise<Message> => {
    const b = body as { model: string; tools?: { name: string }[] };
    const tool = b.tools?.[0]?.name ?? "";
    const vuln = !!opts.flagParent && opts.side?.() === "parent";
    let input: Record<string, unknown>;
    if (tool === "report_idor_findings") {
      input = { verdicts: [{ pairIndex: 0, isVulnerable: vuln, confidence: vuln ? "high" : "low", reasoning: "canned: forced-routing rehearsal; no model was consulted", callerAuth: "unclear", operationClass: "user_resource", suggestedFix: "" }] };
    } else if (tool.startsWith("report_") && tool.endsWith("_verdict")) {
      input = { isVulnerable: vuln, confidence: vuln ? "high" : "low", reasoning: "canned: forced-routing rehearsal; no model was consulted", authPresent: "unclear", operationKind: "general", suggestedFix: "", vulnerableRoute: "" };
    } else {
      throw new Error(`mock: unrecognised tool "${tool}"; refusing`);
    }
    return {
      id: "msg_forced_routing_mock",
      type: "message",
      role: "assistant",
      model: b.model,
      content: [{ type: "tool_use", id: "toolu_forced_routing_mock", name: tool, input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: Math.round(9000 * mult), output_tokens: Math.round(300 * mult), cache_creation_input_tokens: Math.round(4500 * mult), cache_read_input_tokens: 0 },
    } as unknown as Message;
  };
  const guard = guardFactory(inner);
  setCallClaudeTestDeps({ create: (body, o) => guard.create(body, o), recordCost: async () => undefined });
  return guard;
}
