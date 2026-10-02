/**
 * Proxy judge, library half. The instrument is one headless Claude Code
 * process (`claude -p`) per request on the owner's subscription, blind, on
 * the shipped model. Design, deviations from the shipped instrument and the
 * labelling rule:
 *   docs/measurements/forced-routing-2026-09-28/proxy-judge-design-2026-09-28.md
 *
 * WHAT REACHES THE PROCESS, and nothing else: the request's system prompt
 * text (as `--system-prompt`), the shipped tool's input schema (as
 * `--json-schema`, the required output shape), the model id (as `--model`),
 * and the request's single user message on stdin. The request file's
 * `context` block (set, case, side, lane, repo, commit, blob sha, anchor
 * line) is read by THIS script to score, and is never placed in the argv,
 * the stdin, the environment or the working directory of the process.
 * `test:proxy-judge-rehearsal` proves that byte for byte with a stub.
 *
 * WHAT CANNOT BILL THE API: the run refuses to start while any API
 * credential is in the environment (`credentialGate`), the process is
 * started with a whitelisted environment (`scrubbedEnv`), and `--bare` is
 * never passed (bare mode reads only ANTHROPIC_API_KEY, never the
 * subscription login). What this script CANNOT see: whether the owner's
 * subscription has "extra usage" enabled, which would bill usage credits
 * once a window is exhausted instead of rate-limiting. The owner confirms
 * that setting is OFF before a run; the header of proxy-judge.ts repeats it.
 *
 * Nothing here is production code; nothing under src/test ships.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { score, type FileResult, type Lane, type Side, type Verdict } from "./forced-routing";

// ---------------------------------------------------------------------------
// Gates that run before anything is read.
// ---------------------------------------------------------------------------

/** Names that make `claude -p` (or the SDK under it) bill an API instead of the login. */
export const CREDENTIAL_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOXTROT",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_BEARER_TOKEN_BEDROCK",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "FIXOR_PARKED_KEY",
];
const CREDENTIAL_NAME_RE = /^(ANTHROPIC_|AWS_|CLAUDE_CODE_USE_|FIXOR_PARKED)/i;
const KEY_SHAPE_RE = /sk-ant-/;

/** Returns the reason to refuse, or null. Case-insensitive on the name (Windows). */
export function credentialGate(env: NodeJS.ProcessEnv): string | null {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === "") continue;
    const upper = k.toUpperCase();
    if (CREDENTIAL_ENV_NAMES.includes(upper) || CREDENTIAL_NAME_RE.test(upper)) {
      return `${k} is set in the environment; with an API credential present, claude -p bills the API, which the owner refused`;
    }
    if (KEY_SHAPE_RE.test(v)) return `${k} holds a value shaped like an Anthropic API key`;
  }
  return null;
}

/**
 * Claude Code's user settings can inject an API credential into every
 * process it starts (`apiKeyHelper`, `env.ANTHROPIC_API_KEY`, ...), which
 * the environment scrub cannot reach. Refuse on any of them. A
 * `fallbackModel` entry is reported, not refused: a swap it causes is
 * caught per call by the model identity check.
 */
export function settingsGate(configDir: string = process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude")): { refuse: string | null; notes: string[] } {
  const notes: string[] = [];
  const p = join(configDir, "settings.json");
  if (!existsSync(p)) return { refuse: null, notes };
  let s: { apiKeyHelper?: unknown; env?: Record<string, unknown>; fallbackModel?: unknown };
  try {
    s = JSON.parse(readFileSync(p, "utf8")) as typeof s;
  } catch {
    return { refuse: `${p} is not valid JSON; cannot prove it injects no credential`, notes };
  }
  if (s.apiKeyHelper) return { refuse: `${p} sets apiKeyHelper, which would hand claude -p an API key`, notes };
  for (const k of Object.keys(s.env ?? {})) {
    const upper = k.toUpperCase();
    if (CREDENTIAL_ENV_NAMES.includes(upper) || CREDENTIAL_NAME_RE.test(upper)) return { refuse: `${p} sets env.${k}, which would hand claude -p an API credential`, notes };
  }
  if (s.fallbackModel !== undefined) notes.push(`${p} sets fallbackModel ${JSON.stringify(s.fallbackModel)}; a swap is stopped by the per-call model check`);
  return { refuse: null, notes };
}

// ---------------------------------------------------------------------------
// The environment the process is started with: a whitelist, never a copy.
// ---------------------------------------------------------------------------

export const ENV_PASSTHROUGH = [
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "WINDIR",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
  "TEMP", "TMP", "TMPDIR", "USERNAME", "USER", "LANG", "LC_ALL", "TERM", "SHELL",
  "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR",
];

export function scrubbedEnv(env: NodeJS.ProcessEnv, maxOutputTokens?: number): Record<string, string> {
  const out: Record<string, string> = {};
  const want = new Set(ENV_PASSTHROUGH);
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && want.has(k.toUpperCase())) out[k] = v;
  }
  out["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1";
  out["DISABLE_AUTOUPDATER"] = "1";
  if (maxOutputTokens !== undefined) out["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = String(maxOutputTokens);
  return out;
}

// ---------------------------------------------------------------------------
// Reading a mock run's request files.
// ---------------------------------------------------------------------------

export interface JudgeTarget {
  set: FileResult["set"];
  case: string;
  side: Side;
  lane: Lane;
  repo: string;
  path: string;
}

export interface JudgeRequest {
  n: number;
  file: string;
  model: string;
  toolName: string;
  /** The shipped system prompt text, blocks joined. */
  system: string;
  /** The shipped user message text, blocks joined. */
  user: string;
  /** The shipped tool's input schema: the required output shape. */
  schema: unknown;
  /** Scoring only. Never reaches the process. */
  target: JudgeTarget;
}

type Block = { type: string; text?: string };
function joinBlocks(v: unknown, what: string): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return (v as Block[])
      .map((b) => {
        if (b.type !== "text" || typeof b.text !== "string") throw new Error(`${what}: only text blocks can be forwarded, found ${b.type}`);
        return b.text;
      })
      .join("\n");
  }
  throw new Error(`${what}: unsupported shape`);
}

export function extractRequest(file: string): JudgeRequest {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    n: number;
    context: { target: JudgeTarget; run: number } | null;
    body: { model: string; system: unknown; messages: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string; input_schema: unknown }>; tool_choice?: { type: string; name?: string } };
  };
  const b = raw.body;
  if (!raw.context?.target) throw new Error(`${file}: no context.target; cannot score it`);
  if (!b || typeof b.model !== "string") throw new Error(`${file}: no model`);
  if (!Array.isArray(b.messages) || b.messages.length !== 1 || b.messages[0]!.role !== "user") throw new Error(`${file}: expected exactly one user message`);
  if (!b.tools || b.tools.length !== 1) throw new Error(`${file}: expected exactly one tool`);
  if (b.tool_choice?.type !== "tool" || b.tool_choice.name !== b.tools[0]!.name) throw new Error(`${file}: tool_choice does not force the tool`);
  const t = raw.context.target;
  return {
    n: raw.n,
    file,
    model: b.model,
    toolName: b.tools[0]!.name,
    system: joinBlocks(b.system, `${file}: system`),
    user: joinBlocks(b.messages[0]!.content, `${file}: user`),
    schema: b.tools[0]!.input_schema,
    target: { set: t.set, case: t.case, side: t.side, lane: t.lane, repo: t.repo, path: t.path },
  };
}

/** The first pass's request files of a mock run, in call order. */
export function readRequests(mockRunDir: string): JudgeRequest[] {
  const runFile = join(mockRunDir, "run.json");
  if (!existsSync(runFile)) throw new Error(`${mockRunDir} holds no run.json; point --requests at a mock run directory`);
  const run = JSON.parse(readFileSync(runFile, "utf8")) as { mode: string; targets: number };
  if (run.mode !== "mock") throw new Error(`${runFile}: mode ${run.mode}; the judge reads MOCK runs only`);
  const callsDir = join(mockRunDir, "calls");
  const files = readdirSync(callsDir).filter((f) => /^\d{4}-request\.json$/.test(f)).sort();
  const reqs: JudgeRequest[] = [];
  for (const f of files) {
    const p = join(callsDir, f);
    const ctx = (JSON.parse(readFileSync(p, "utf8")) as { context: { run: number } | null }).context;
    if (ctx?.run === 1) reqs.push(extractRequest(p));
  }
  if (reqs.length !== run.targets) throw new Error(`${callsDir}: ${reqs.length} first-pass request files, run.json says ${run.targets} targets`);
  return reqs;
}

// ---------------------------------------------------------------------------
// The process: argv, model identity, result parsing.
// ---------------------------------------------------------------------------

/** Flags that would change the instrument or the billing route. Never passed; asserted by the rehearsal. */
export const FORBIDDEN_FLAGS = ["--bare", "--fallback-model", "--dangerously-skip-permissions", "--allowedTools", "--allowed-tools", "--mcp-config", "--resume", "--continue", "--append-system-prompt"];

/**
 * The exact argv of every process. `-p` with no positional prompt reads the
 * prompt from stdin; `--tools ""` disables every built-in tool;
 * `--strict-mcp-config` with no `--mcp-config` loads no MCP server;
 * `--setting-sources ""` loads no user, project or local settings (whether
 * it also keeps the user CLAUDE.md out is unverified without a model call);
 * `--system-prompt` REPLACES Claude Code's own system prompt;
 * `--json-schema` makes the shipped tool's input schema the required output
 * shape. No `--bare`, no `--fallback-model`, and no `--max-turns`: the
 * design does not specify one, and a turn cap could cut off the structured
 * output answer; with no tools the process has nothing to loop on.
 */
export function judgeArgv(req: { model: string; system: string; schema: unknown }, arm: JudgeArm = {}): string[] {
  return [
    "-p",
    "--model", arm.judgeModel ?? req.model,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
    ...(arm.effort ? ["--effort", arm.effort] : []),
    "--output-format", "json",
    "--system-prompt", req.system,
    "--json-schema", JSON.stringify(req.schema),
  ];
}

/**
 * A second model arm (Opus arm pre-registration, 2026-09-29). All three
 * fields absent is the shipped-model arm, whose argv and environment are
 * byte-identical to the 2026-09-29 Sonnet run's. `judgeModel` replaces the
 * request's model in `--model` and in the per-call identity check;
 * `effort` pins `--effort` (the CLI's default effort can differ by model);
 * `maxOutputTokens` sets CLAUDE_CODE_MAX_OUTPUT_TOKENS (the CLI's default
 * cap differs by model: 32,000 was seen on claude-sonnet-4-6, 128,000 on
 * claude-opus-5-5). The cap is verified ON THE WIRE before the first call
 * of every pass and of every resume (lib/proxy-judge-wire.ts). The result's
 * `modelUsage[m].maxOutputTokens` is the model's built-in default whatever
 * the override says, so it is recorded and NEVER compared: comparing it
 * stopped the Opus arm on its first call (amendment A2, 2026-10-02).
 */
export interface JudgeArm {
  judgeModel?: string;
  effort?: string;
  maxOutputTokens?: number;
}
/**
 * What the wire check expects where an arm pins nothing: the cap and effort
 * both arms' recorded requests carried (design, 2026-09-28; A1, 2026-09-30).
 */
export const DEFAULT_WIRE = { maxTokens: 32_000, effort: "high" } as const;
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
export const JUDGE_MODEL_SHAPE = /^claude-[a-z0-9]+(-[a-z0-9]+)*$/;

/** Windows CreateProcess takes at most 32,767 characters of command line. */
export const WIN_ARGV_LIMIT = 32_000;
export function argvChars(argv: string[]): number {
  return argv.reduce((a, s) => a + s.length + 3, 0);
}

export interface ParsedResult {
  ok: true;
  /** Every model the result reports usage for. */
  models: string[];
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  /** `modelUsage[m].maxOutputTokens` per answering model, null where absent. Information only: it is the model's default, not the cap in force. */
  maxOutputTokens: Record<string, number | null>;
  /** `usage.output_tokens_details.thinking_tokens`, null where absent. */
  thinkingTokens: number | null;
  /** `num_turns`, null where absent. More than one means requests the wire check never saw. */
  numTurns: number | null;
  structuredOutput: unknown;
  reportedCostUsd: number | null;
  sessionId: string | null;
  durationMs: number | null;
}
export type ResultParse = ParsedResult | { ok: false; reason: string };

/** Parses the single JSON object `--output-format json` prints. */
export function parseResult(stdout: string): ResultParse {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: `stdout is not one JSON object (${stdout.trim().slice(0, 120)})` };
  }
  if (r["type"] !== "result") return { ok: false, reason: `type ${String(r["type"])}, expected result` };
  if (r["is_error"] === true || (r["subtype"] !== undefined && r["subtype"] !== "success")) {
    return { ok: false, reason: `subtype ${String(r["subtype"])}, is_error ${String(r["is_error"])}: ${String(r["result"] ?? "").slice(0, 200)}` };
  }
  const mu = (r["modelUsage"] ?? {}) as Record<string, unknown>;
  const models = Object.keys(mu);
  if (models.length === 0) return { ok: false, reason: "the result reports no modelUsage; the model that answered cannot be verified" };
  if (!("structured_output" in r) || r["structured_output"] === null || typeof r["structured_output"] !== "object") {
    return { ok: false, reason: "the result carries no structured_output object" };
  }
  const u = (r["usage"] ?? {}) as Record<string, number>;
  const maxOut: Record<string, number | null> = {};
  for (const m of models) {
    const v = (mu[m] as Record<string, unknown> | null)?.["maxOutputTokens"];
    maxOut[m] = typeof v === "number" ? v : null;
  }
  const td = (r["usage"] as Record<string, unknown> | undefined)?.["output_tokens_details"] as Record<string, unknown> | undefined;
  return {
    ok: true,
    models,
    usage: { input: u["input_tokens"] ?? 0, output: u["output_tokens"] ?? 0, cacheWrite: u["cache_creation_input_tokens"] ?? 0, cacheRead: u["cache_read_input_tokens"] ?? 0 },
    maxOutputTokens: maxOut,
    thinkingTokens: typeof td?.["thinking_tokens"] === "number" ? (td["thinking_tokens"] as number) : null,
    numTurns: typeof r["num_turns"] === "number" ? (r["num_turns"] as number) : null,
    structuredOutput: r["structured_output"],
    reportedCostUsd: typeof r["total_cost_usd"] === "number" ? (r["total_cost_usd"] as number) : null,
    sessionId: typeof r["session_id"] === "string" ? (r["session_id"] as string) : null,
    durationMs: typeof r["duration_ms"] === "number" ? (r["duration_ms"] as number) : null,
  };
}

/**
 * The verdict the lane would have parsed from a tool_use with this input:
 * idor's tool carries `verdicts[]` keyed by pairIndex (the forced call has
 * one pair, index 0); the other two lanes' tools are flat. A shape the
 * lane could not parse is a final null verdict, as pre-registered.
 */
export function verdictFrom(toolName: string, so: unknown): Verdict | null {
  const pick = (o: unknown): Verdict | null => {
    const v = o as { isVulnerable?: unknown; confidence?: unknown; reasoning?: unknown } | null;
    if (!v || typeof v !== "object") return null;
    if (typeof v.isVulnerable !== "boolean") return null;
    if (v.confidence !== "high" && v.confidence !== "medium" && v.confidence !== "low") return null;
    return { isVulnerable: v.isVulnerable, confidence: v.confidence, reasoning: typeof v.reasoning === "string" ? v.reasoning : "", extra: v as Record<string, unknown> };
  };
  if (toolName === "report_idor_findings") {
    const arr = (so as { verdicts?: unknown[] } | null)?.verdicts;
    if (!Array.isArray(arr)) return null;
    const first = arr.find((x) => (x as { pairIndex?: unknown }).pairIndex === 0) ?? arr[0];
    return pick(first);
  }
  return pick(so);
}

// ---------------------------------------------------------------------------
// On-disk verdicts, resume, and scoring.
// ---------------------------------------------------------------------------

export interface JudgeRecord {
  n: number;
  pass: number;
  target: JudgeTarget;
  /** The model this call had to be answered by: the judge model on a second arm, else the shipped one. */
  model: string;
  /** Present on a second arm only: the request's shipped model, and the pinned effort and output cap. */
  shippedModel?: string;
  effort?: string;
  maxOutputTokensPinned?: number;
  /** Information only, never compared (amendment A2). */
  maxOutputTokensReported?: number | null;
  thinkingTokens?: number | null;
  numTurns?: number | null;
  modelsReported: string[];
  toolName: string;
  usage: ParsedResult["usage"];
  reportedCostUsd: number | null;
  sessionId: string | null;
  durationMs: number | null;
  wallMs: number;
  structuredOutput: unknown;
  verdict: Verdict | null;
  stub: boolean;
  startedAt: string;
  endedAt: string;
}

export function recordName(n: number, pass: number): string {
  return `${String(n).padStart(4, "0")}-p${pass}.json`;
}
export function mismatchName(n: number, pass: number): string {
  return `${String(n).padStart(4, "0")}-p${pass}.model-mismatch.json`;
}

/** What is already judged in `proxyDir`, and what stopped a previous run on a model mismatch. */
export function scanProxyDir(proxyDir: string): { done: Set<string>; mismatches: string[] } {
  const done = new Set<string>();
  const mismatches: string[] = [];
  if (!existsSync(proxyDir)) return { done, mismatches };
  for (const f of readdirSync(proxyDir)) {
    if (/^\d{4}-p\d+\.json$/.test(f)) done.add(f);
    else if (/^\d{4}-p\d+\.model-mismatch\.json$/.test(f)) mismatches.push(f);
  }
  return { done, mismatches };
}

/** Assembles per-file verdict arrays from the records on disk, in pass order, contiguous from pass 1. */
export function assembleResults(reqs: JudgeRequest[], proxyDir: string, passes: number): FileResult[] {
  return reqs.map((r) => {
    const verdicts: Array<Verdict | null> = [];
    for (let p = 1; p <= passes; p++) {
      const f = join(proxyDir, recordName(r.n, p));
      if (!existsSync(f)) break;
      verdicts.push((JSON.parse(readFileSync(f, "utf8")) as JudgeRecord).verdict);
    }
    return { ...r.target, verdicts };
  });
}

export type ProxyLabel = "PROXY-PASS" | "PROXY-FAIL" | "PROXY-INCONCLUSIVE" | "PROXY-INCOMPLETE" | "PROXY-PRELIMINARY";

/** The pre-registered n. A label from fewer passes is not a result (design, "Repeats"). */
export const PREREGISTERED_PASSES = 5;

/**
 * The pre-registered criteria, unchanged, reported under the PROXY labels.
 * PROXY-PASS, PROXY-FAIL and PROXY-INCONCLUSIVE are applied ONLY when every
 * request has all five verdicts. Fewer passes, even complete ones, are
 * PROXY-PRELIMINARY: the scorer's figures are printed, no label is applied.
 */
export function proxyLabel(results: FileResult[], passes: number): { label: ProxyLabel; summary: Record<string, unknown> } {
  const summary = score(results, passes);
  const recall = summary["recallVerdict"];
  let label: ProxyLabel;
  if (recall === "INCOMPLETE") label = "PROXY-INCOMPLETE";
  else if (passes !== PREREGISTERED_PASSES) label = "PROXY-PRELIMINARY";
  else label = recall === "PASS" ? "PROXY-PASS" : recall === "FAIL" ? "PROXY-FAIL" : "PROXY-INCONCLUSIVE";
  return { label, summary };
}

/**
 * Words that must not appear in the work root: the CLI tells the model its
 * working directory, so a path naming the product, the judge or a case set
 * is context the design withholds. Found on the first real call, 2026-09-29.
 */
export const WORK_ROOT_FORBIDDEN = /fixor|proxy|judge|forced|routing|held-?out|arm-?a|clean|known-answer|advisor|ghsa|vuln|security|audit/i;

/** Characters the process receives per pass, and the token estimate the design used (3.5 chars/token). */
export function volume(reqs: JudgeRequest[]): { requests: number; systemChars: number; userChars: number; totalChars: number; estimatedTokens: number; maxArgvChars: number } {
  let systemChars = 0;
  let userChars = 0;
  let maxArgvChars = 0;
  for (const r of reqs) {
    systemChars += r.system.length;
    userChars += r.user.length;
    maxArgvChars = Math.max(maxArgvChars, argvChars(judgeArgv(r)));
  }
  const totalChars = systemChars + userChars;
  return { requests: reqs.length, systemChars, userChars, totalChars, estimatedTokens: Math.round(totalChars / 3.5), maxArgvChars };
}
