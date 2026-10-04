/**
 * Agentic change review, library half. Pre-registration and amendment:
 *   docs/measurements/agentic-review-2026-10-02/agentic-review-prereg-2026-10-02.md
 *   docs/measurements/agentic-review-2026-10-02/agentic-review-amendment-A1-2026-10-03.md
 *
 * Pure functions only: the defect window (A1 3.3), the findings parser, the
 * hit rule, the scorer and Gate A (A1 2), the stream-json reader, the
 * tool-call audit (A1 3.5), the prompt expansion, and the neutral-repository
 * checks (A1 3.6). Nothing here starts a process. Nothing under src/test
 * ships.
 */
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants pinned by the pre-registration and A1.
// ---------------------------------------------------------------------------

export const RUNS = 5;
export const HIT_MIN_VULNERABLE = 4; // of 5
export const HIT_MAX_FIX = 1; // of 5
export const GATE_A_MIN_HITS = 4;
export const GATE_A_MAX_CLEAN_FLAGS = 3;
export const GATE_A_MIN_ACCEPTED = 8;
export const CLEAN_FLAG_MIN_RUNS = 4; // of 5
export const WINDOW_PAD = 3;
export const NO_BLOCK_PAD = 10;
/** A4: a state whose expanded prompt is longer than this is unreviewable; no request is sent for it. */
export const UNREVIEWABLE_PROMPT_CHARS = 300_000;
/** A4: the API refusing a request for its size, as the pinned CLI words it (its own test is the same two phrases). */
export const SIZE_REFUSAL_RE = /prompt is too long|input is too long for requested model/i;
/** A4: the pinned CLI's typed API error for a request over the 200K-token boundary on an account without usage credits. */
export const SIZE_REFUSAL_API_ERRORS = ["long_context_credits_required"] as const;
export const NEUTRAL = { name: "contributor", email: "contributor@example.invalid", date: "2000-01-01T00:00:00Z", message: "change" } as const;
/** The built-in's tools, as A1 3.5 restricts them at the CLI. */
export const TOOL_SET = ["Read", "Glob", "Grep", "LS", "Task", "Bash"] as const;
export const BASH_ALLOWED = ["git diff", "git status", "git log", "git show", "git remote show"] as const;
export const CATEGORY_RE = /auth|authori[sz]|access.?control|permission|privilege|idor|insecure direct|ownership|tenant|bypass/i;
export const ROUTE_SHAPE_RE = /\b(router|app|server|fastify|express)\.(get|post|put|patch|delete|all|use)\s*\(|@(Get|Post|Put|Patch|Delete|All)\s*\(|\b(publicProcedure|protectedProcedure|procedure)\b|export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/;
export const TEST_SEG_RE = /(^|\/)(test|tests|__tests__|spec|e2e|fixture|fixtures|example|examples|demo)(\/|$)/i;
export const TEST_NAME_RE = /\.(test|spec)\.[^/]+$/i;
export const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
export const nonTestSource = (p: string): boolean => SOURCE_EXT_RE.test(p) && !TEST_SEG_RE.test(p) && !TEST_NAME_RE.test(p);

// ---------------------------------------------------------------------------
// The prepared manifest: identifiers, windows, tokens. Never file contents.
// ---------------------------------------------------------------------------

export type SetName = "held-out" | "post-cutoff" | "clean";
export type StateKind = "vulnerable" | "fix" | "clean";

export interface DefectFile {
  path: string;
  /** Anchor line at the fix's parent (the frozen anchor), and at I as blame reports it; null when absent at I. */
  anchorAtParent: number;
  anchorAtI: number | null;
  /** The commit blame attributes the anchor line to, at the fix's parent. */
  blame: string | null;
  presentAtI: boolean;
  window: [number, number] | null;
}
export interface PreparedCase {
  set: SetName;
  case: string;
  repo: string;
  fixCommit: string;
  parentCommit: string;
  /** The introducing commit of the first defect file, and its parent. */
  introducing: string | null;
  introducingParent: string | null;
  accepted: boolean;
  rejection: string | null;
  files: DefectFile[];
  /** Random tokens naming the prepared repositories; null where the state could not be built. */
  states: { vulnerable: string | null; fix: string | null };
  fixSideNote: string | null;
  /** Tree hashes of commit 2 in each state, read back after preparation. */
  treeAtWork: { vulnerable: string | null; fix: string | null };
  diffStats: { files: number; additions: number; deletions: number } | null;
}
export interface PreparedClean {
  case: string;
  repo: string;
  path: string;
  commit: string | null;
  commitParent: string | null;
  routeShaped: boolean;
  rejection: string | null;
  state: string | null;
  treeAtWork: string | null;
}
export interface PreparedManifest {
  version: 1;
  preparedAt: string;
  /** Absolute root under which every state directory sits; neutral, outside the repository. */
  root: string;
  /** False while the preparation is still running or was cut off; the harness runs only a complete manifest. */
  complete?: boolean;
  cases: PreparedCase[];
  clean: PreparedClean[];
}

export function stateDirName(token: string): string {
  return token; // the token is already neutral; one directory per state under root
}

// ---------------------------------------------------------------------------
// The defect window (A1 3.3): a brace-depth scan, no parser dependency.
// ---------------------------------------------------------------------------

const BLOCK_HEAD_RE = /\b(function|=>|async|constructor|get|post|put|patch|delete|all|use|route|handler|resolver|procedure|mutation|query)\b|\)\s*(:\s*[\w<>\[\]|&, ]+)?\s*\{\s*$|^\s*(public|private|protected|static|async|override)?\s*[\w$]+\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$/;

/**
 * Returns the [first, last] line numbers (1-based, inclusive) of the window
 * around `anchor` in `text`: the nearest enclosing `{...}` block whose
 * opening line looks like a function, method, arrow or route registration,
 * padded by WINDOW_PAD; or anchor +/- NO_BLOCK_PAD when no such block
 * encloses it. Strings and comments are skipped approximately: this is a
 * window, not a parse, and the padding absorbs small errors.
 */
export function defectWindow(text: string, anchor: number): [number, number] {
  const lines = text.split(/\r?\n/);
  const n = lines.length;
  const a = Math.min(Math.max(anchor, 1), n);
  // Build a brace event list with line numbers, skipping strings, template literals and comments.
  const opens: Array<{ line: number; depth: number }> = [];
  const blocks: Array<{ open: number; close: number }> = [];
  let depth = 0;
  let inBlockComment = false;
  for (let i = 0; i < n; i++) {
    const s = lines[i]!;
    let j = 0;
    let quote: string | null = null;
    let lineComment = false;
    while (j < s.length && !lineComment) {
      const c = s[j]!;
      const next = s[j + 1];
      if (inBlockComment) {
        if (c === "*" && next === "/") { inBlockComment = false; j += 2; continue; }
        j++; continue;
      }
      if (quote) {
        if (c === "\\") { j += 2; continue; }
        if (c === quote) quote = null;
        j++; continue;
      }
      if (c === "/" && next === "/") { lineComment = true; break; }
      if (c === "/" && next === "*") { inBlockComment = true; j += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; j++; continue; }
      if (c === "{") { opens.push({ line: i + 1, depth }); depth++; }
      else if (c === "}") { depth = Math.max(0, depth - 1); const o = opens.pop(); if (o) blocks.push({ open: o.line, close: i + 1 }); }
      j++;
    }
  }
  // Candidate blocks enclose the anchor; prefer the innermost whose opening line (or the line before it) looks like a function head.
  const enclosing = blocks.filter((b) => b.open <= a && a <= b.close).sort((x, y) => (y.open - x.open) || (x.close - y.close));
  for (const b of enclosing) {
    const head = `${lines[b.open - 2] ?? ""}\n${lines[b.open - 1] ?? ""}`;
    if (BLOCK_HEAD_RE.test(head)) return [Math.max(1, b.open - WINDOW_PAD), Math.min(n, b.close + WINDOW_PAD)];
  }
  return [Math.max(1, a - NO_BLOCK_PAD), Math.min(n, a + NO_BLOCK_PAD)];
}

// ---------------------------------------------------------------------------
// Findings: the markdown shape the built-in asks for.
// ---------------------------------------------------------------------------

export interface Finding {
  index: number;
  category: string;
  file: string;
  line: number | null;
  severity: string | null;
  description: string;
}

/** Parses `# Vuln N: <category>: \`file:line\`` headings and the bullet lines under each. */
export function parseFindings(markdown: string): Finding[] {
  const out: Finding[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^#+\s*Vuln\s*(\d+)\s*:\s*(.+?)\s*:\s*`?([^`\s:]+(?::\d+)?)`?\s*$/i);
    if (!m) continue;
    const [, idx, category, loc] = m;
    const lm = loc!.match(/^(.*?)(?::(\d+))?$/);
    let severity: string | null = null;
    const desc: string[] = [];
    for (let j = i + 1; j < lines.length && !/^#+\s*Vuln/i.test(lines[j]!); j++) {
      const sm = lines[j]!.match(/^\s*[-*]\s*Severity\s*:\s*(\w+)/i);
      if (sm) severity = sm[1]!;
      const dm = lines[j]!.match(/^\s*[-*]\s*Description\s*:\s*(.*)$/i);
      if (dm) desc.push(dm[1]!);
    }
    out.push({ index: Number(idx), category: category!.trim(), file: lm![1]!.replace(/^\.\//, ""), line: lm![2] ? Number(lm![2]) : null, severity, description: desc.join(" ") });
  }
  return out;
}

/** The hit rule: right file, line inside a defect window, access-control category or description. */
export function runHit(findings: Finding[], files: DefectFile[]): { hit: boolean; by: Finding | null } {
  for (const f of findings) {
    if (!CATEGORY_RE.test(f.category) && !CATEGORY_RE.test(f.description)) continue;
    for (const d of files) {
      if (!d.window || !d.presentAtI) continue;
      if (f.file !== d.path && !f.file.endsWith("/" + d.path) && !d.path.endsWith("/" + f.file)) continue;
      if (f.line !== null && f.line >= d.window[0] && f.line <= d.window[1]) return { hit: true, by: f };
    }
  }
  return { hit: false, by: null };
}

// ---------------------------------------------------------------------------
// Stream-json reading and the tool-call audit.
// ---------------------------------------------------------------------------

export interface ToolCall { name: string; command: string | null; parent: boolean; paths: string[] }
export interface RunParse {
  ok: true;
  models: string[];
  usage: { input: number; output: number; cacheWrite: number; cacheRead: number };
  numTurns: number | null;
  durationMs: number | null;
  reportedCostUsd: number | null;
  markdown: string;
  toolCalls: ToolCall[];
  initTools: string[] | null;
  /** compact_boundary events: the CLI summarised the conversation during the run. Reported, not scored. */
  compactions: number;
}
/** A failed run; `sizeRefusal` is set only when the API refused a request for its size (A4), with the tool calls made before it. */
export type RunParseResult = RunParse | { ok: false; reason: string; sizeRefusal?: string; toolCalls?: ToolCall[] };

/** Reads every JSON line the CLI printed; collects tool_use blocks, the init tool list and the final result. */
export function parseStream(stdout: string): RunParseResult {
  const toolCalls: ToolCall[] = [];
  let initTools: string[] | null = null;
  let result: Record<string, unknown> | null = null;
  let sizeRefusal: string | null = null;
  let compactions = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (ev["type"] === "system" && ev["subtype"] === "init" && Array.isArray(ev["tools"])) initTools = (ev["tools"] as unknown[]).map(String);
    if (ev["type"] === "system" && ev["subtype"] === "compact_boundary") compactions++;
    if (ev["type"] === "assistant") {
      const msg = ev["message"] as { content?: unknown; is_api_error_message?: unknown; api_error?: unknown } | undefined;
      const content = Array.isArray(msg?.content) ? (msg!.content as Array<Record<string, unknown>>) : [];
      // A4: only a message the CLI marks as an API error counts; the model's own prose never does.
      if (ev["is_api_error_message"] === true || msg?.is_api_error_message === true) {
        const apiError = String(ev["api_error"] ?? msg?.api_error ?? "");
        const text = content.filter((b) => b["type"] === "text").map((b) => String(b["text"] ?? "")).join(" ");
        if ((SIZE_REFUSAL_API_ERRORS as readonly string[]).includes(apiError) || SIZE_REFUSAL_RE.test(text)) sizeRefusal = apiError || text.slice(0, 120);
      }
      for (const b of content) {
        if (b["type"] === "tool_use") {
          const input = (b["input"] ?? {}) as Record<string, unknown>;
          const paths = ["file_path", "path", "notebook_path", "pattern", "glob"].map((k) => input[k]).filter((v): v is string => typeof v === "string");
          toolCalls.push({ name: String(b["name"]), command: typeof input["command"] === "string" ? (input["command"] as string) : null, parent: !ev["parent_tool_use_id"], paths });
        }
      }
    }
    if (ev["type"] === "result") result = ev;
  }
  if (!result) return { ok: false, reason: "no result event in the stream" };
  if (result["is_error"] === true || (result["subtype"] !== undefined && result["subtype"] !== "success")) {
    const reason = `result subtype ${String(result["subtype"])}, is_error ${String(result["is_error"])}: ${String(result["result"] ?? "").slice(0, 200)}`;
    if (!sizeRefusal && SIZE_REFUSAL_RE.test(String(result["result"] ?? ""))) sizeRefusal = String(result["result"]).slice(0, 120);
    return sizeRefusal ? { ok: false, reason, sizeRefusal, toolCalls } : { ok: false, reason };
  }
  const mu = (result["modelUsage"] ?? {}) as Record<string, unknown>;
  const models = Object.keys(mu);
  if (models.length === 0) return { ok: false, reason: "the result reports no modelUsage; the model that answered cannot be verified" };
  const u = (result["usage"] ?? {}) as Record<string, number>;
  return {
    ok: true,
    models,
    usage: { input: u["input_tokens"] ?? 0, output: u["output_tokens"] ?? 0, cacheWrite: u["cache_creation_input_tokens"] ?? 0, cacheRead: u["cache_read_input_tokens"] ?? 0 },
    numTurns: typeof result["num_turns"] === "number" ? (result["num_turns"] as number) : null,
    durationMs: typeof result["duration_ms"] === "number" ? (result["duration_ms"] as number) : null,
    reportedCostUsd: typeof result["total_cost_usd"] === "number" ? (result["total_cost_usd"] as number) : null,
    markdown: typeof result["result"] === "string" ? (result["result"] as string) : "",
    toolCalls,
    initTools,
    compactions,
  };
}

/**
 * A3: true when `p` can reach outside `root`. A path that is absolute, starts
 * with `~`, or has a `..` segment must resolve inside `root`; a glob is judged
 * by its prefix before the first wildcard. Plain relative paths stay inside.
 */
export function escapesRoot(p: string, root: string): boolean {
  const s = p.trim().replace(/^["']+|["']+$/g, "");
  if (s.startsWith("~")) return true;
  const reaches = isAbsolute(s) || /^[A-Za-z]:/.test(s) || s.split(/[\\/]/).includes("..");
  if (!reaches) return false;
  const prefix = s.split(/[*?[{]/)[0] ?? "";
  const rel = relative(resolve(root), resolve(root, prefix));
  return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel);
}

/**
 * Returns the calls that void a run: a tool outside TOOL_SET, or a Bash command
 * outside the allowed git prefixes; with `root` (A3), also any file-tool path or
 * git argument that reaches outside the run's repository, and `--no-index`.
 */
export function auditToolCalls(calls: ToolCall[], root?: string): ToolCall[] {
  const bad: ToolCall[] = [];
  for (const c of calls) {
    if (!(TOOL_SET as readonly string[]).includes(c.name)) { bad.push(c); continue; }
    if (root !== undefined && c.paths.some((p) => escapesRoot(p, root))) { bad.push(c); continue; }
    if (c.name === "Bash") {
      const cmd = (c.command ?? "").trim();
      const parts = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0 || !parts.every((p) => BASH_ALLOWED.some((a) => p === a || p.startsWith(a + " ")))) { bad.push(c); continue; }
      const reachesOut = (p: string): boolean => /(^|\s)--no-index(\s|$)/.test(p) || p.split(/\s+/).slice(2).some((a) => escapesRoot(a.replace(/^--?[\w-]+=/, ""), root!));
      if (root !== undefined && parts.some(reachesOut)) bad.push(c);
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------
// The prompt: the built-in's body with its four `!` commands expanded.
// ---------------------------------------------------------------------------

/** Strips the HTML comment and frontmatter; returns the body the CLI would send. */
export function promptBody(fileText: string): string {
  const t = fileText.replace(/\r\n/g, "\n").replace(/^<!--[\s\S]*?-->\n/, "");
  const parts = t.split(/^---\n/m);
  // [ "", frontmatter, body ] when the file starts with ---
  if (parts.length >= 3) return parts.slice(2).join("---\n").replace(/^\n+/, "");
  return t;
}
export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

/** The `!` commands in the body, in order. */
export function bangCommands(body: string): string[] {
  return [...body.matchAll(/^!`([^`]+)`$/gm)].map((m) => m[1]!);
}

/** Replaces each `!`cmd`` line with the given output, in order. */
export function expandPrompt(body: string, outputs: string[]): string {
  let i = 0;
  return body.replace(/^!`([^`]+)`$/gm, () => outputs[i++] ?? "");
}

// ---------------------------------------------------------------------------
// Scoring and Gate A.
// ---------------------------------------------------------------------------

export interface RunRecord {
  set: SetName;
  case: string;
  state: StateKind;
  run: number;
  voided: boolean;
  findings: Finding[];
  hit: boolean;
  anyFinding: boolean;
  /** A4: why this run is unreviewable (size rule before sending, or the API's size refusal); it has no finding. */
  unreviewable?: string | null;
}

export interface CaseScore {
  set: SetName;
  case: string;
  accepted: boolean;
  hasFixSide: boolean;
  vulnerableHits: number;
  fixHits: number;
  vulnerableRuns: number;
  fixRuns: number;
  voided: number;
  unreviewableRuns: number;
  hit: boolean;
  countsForGate: boolean;
}

export function scoreCases(manifest: PreparedManifest, records: RunRecord[]): CaseScore[] {
  return manifest.cases.map((c) => {
    const v = records.filter((r) => r.set === c.set && r.case === c.case && r.state === "vulnerable");
    const f = records.filter((r) => r.set === c.set && r.case === c.case && r.state === "fix");
    const vulnerableHits = v.filter((r) => r.hit && !r.voided).length;
    const fixHits = f.filter((r) => r.hit && !r.voided).length;
    const hasFixSide = c.states.fix !== null;
    const complete = v.length === RUNS && (!hasFixSide || f.length === RUNS);
    // A1 3.1: no fix-side control, no hit for the gate.
    const hit = c.accepted && complete && hasFixSide && vulnerableHits >= HIT_MIN_VULNERABLE && fixHits <= HIT_MAX_FIX;
    return { set: c.set, case: c.case, accepted: c.accepted, hasFixSide, vulnerableHits, fixHits, vulnerableRuns: v.length, fixRuns: f.length, voided: [...v, ...f].filter((r) => r.voided).length, unreviewableRuns: [...v, ...f].filter((r) => r.unreviewable).length, hit, countsForGate: c.set === "held-out" };
  });
}

export interface CleanScore { case: string; runs: number; flaggedRuns: number; unreviewableRuns: number; flagged: boolean }
export function scoreClean(manifest: PreparedManifest, records: RunRecord[]): CleanScore[] {
  return manifest.clean.filter((k) => k.state).map((k) => {
    const rs = records.filter((r) => r.set === "clean" && r.case === k.case);
    const flaggedRuns = rs.filter((r) => r.anyFinding && !r.voided).length;
    return { case: k.case, runs: rs.length, flaggedRuns, unreviewableRuns: rs.filter((r) => r.unreviewable).length, flagged: rs.length === RUNS && flaggedRuns >= CLEAN_FLAG_MIN_RUNS };
  });
}

export type GateLabel = "AGENTIC-INCOMPLETE" | "AGENTIC-PRECONDITION-FAILED" | "AGENTIC-CONTINUE" | "AGENTIC-STOP";
export function gateA(manifest: PreparedManifest, cases: CaseScore[], clean: CleanScore[], voidedSeries: boolean): { label: GateLabel; heldOutHits: number; heldOutAccepted: number; cleanFlags: number; postCutoffHits: number; postCutoffCases: number; reason: string; unreviewableRuns: number; cleanFlagsIfUnreviewableFlagged: number } {
  const held = cases.filter((c) => c.set === "held-out");
  const accepted = held.filter((c) => c.accepted).length;
  const heldOutHits = held.filter((c) => c.hit).length;
  const post = cases.filter((c) => c.set === "post-cutoff");
  const postCutoffHits = post.filter((c) => c.hit).length;
  const cleanFlags = clean.filter((k) => k.flagged).length;
  const plannedClean = manifest.clean.filter((k) => k.state).length;
  // A4: an unreviewable run counts as not flagged. The clean count with those runs counted as flagged is reported beside it and never gated on.
  const a4 = { unreviewableRuns: cases.reduce((n, c) => n + c.unreviewableRuns, 0) + clean.reduce((n, k) => n + k.unreviewableRuns, 0), cleanFlagsIfUnreviewableFlagged: clean.filter((k) => k.runs === RUNS && k.flaggedRuns + k.unreviewableRuns >= CLEAN_FLAG_MIN_RUNS).length };
  const complete = held.filter((c) => c.accepted).every((c) => c.vulnerableRuns === RUNS && (!c.hasFixSide || c.fixRuns === RUNS)) && clean.every((k) => k.runs === RUNS) && clean.length === plannedClean;
  if (accepted < GATE_A_MIN_ACCEPTED) return { label: "AGENTIC-PRECONDITION-FAILED", heldOutHits, heldOutAccepted: accepted, cleanFlags, postCutoffHits, postCutoffCases: post.length, reason: `${accepted} of 10 held-out cases accepted by the blame rule; the gate needs ${GATE_A_MIN_ACCEPTED}`, ...a4 };
  if (voidedSeries) return { label: "AGENTIC-STOP", heldOutHits, heldOutAccepted: accepted, cleanFlags, postCutoffHits, postCutoffCases: post.length, reason: "a run was voided by a tool call outside the allowed set; the series is void", ...a4 };
  if (!complete) return { label: "AGENTIC-INCOMPLETE", heldOutHits, heldOutAccepted: accepted, cleanFlags, postCutoffHits, postCutoffCases: post.length, reason: "not every state has five runs", ...a4 };
  const pass = heldOutHits >= GATE_A_MIN_HITS && cleanFlags <= GATE_A_MAX_CLEAN_FLAGS;
  return { label: pass ? "AGENTIC-CONTINUE" : "AGENTIC-STOP", heldOutHits, heldOutAccepted: accepted, cleanFlags, postCutoffHits, postCutoffCases: post.length, reason: pass ? `${heldOutHits} hits of ${accepted} accepted and ${cleanFlags} of ${plannedClean} clean changes flagged` : `${heldOutHits} hits (needs ${GATE_A_MIN_HITS}) and ${cleanFlags} clean flags (at most ${GATE_A_MAX_CLEAN_FLAGS})`, ...a4 };
}

// ---------------------------------------------------------------------------
// Neutral-repository checks (A1 3.6), over `git` output supplied by the caller.
// ---------------------------------------------------------------------------

export interface RepoFacts {
  /** `git log --format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%s work` lines, newest first. */
  workLog: string[];
  originHeadLog: string[];
  remotes: string[];
  status: string;
}
export function checkNeutralRepo(f: RepoFacts, originDir: string): string[] {
  const bad: string[] = [];
  if (f.workLog.length !== 2) bad.push(`work branch has ${f.workLog.length} commits, expected 2`);
  if (f.originHeadLog.length !== 1) bad.push(`origin/HEAD has ${f.originHeadLog.length} commits, expected 1`);
  for (const line of [...f.workLog, ...f.originHeadLog]) {
    const [, an, ae, cn, ce, ad, cd, subject] = line.split("\0");
    if (an !== NEUTRAL.name || cn !== NEUTRAL.name || ae !== NEUTRAL.email || ce !== NEUTRAL.email) bad.push(`a commit carries a non-neutral author or committer`);
    if (!ad?.startsWith("2000-01-01") || !cd?.startsWith("2000-01-01")) bad.push(`a commit carries a non-neutral date`);
    if (subject !== NEUTRAL.message) bad.push(`a commit carries a non-neutral message`);
  }
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  for (const r of f.remotes) {
    const m = r.match(/^origin\s+(\S+)/);
    if (!m) { bad.push(`unexpected remote line: ${r.slice(0, 60)}`); continue; }
    if (norm(m[1]!) !== norm(originDir)) bad.push("origin does not point at the local bare repository");
  }
  if (f.remotes.length === 0) bad.push("no origin remote");
  if (f.status.trim() !== "") bad.push("working tree is not clean");
  return [...new Set(bad)];
}

/** Rough token estimate the design uses everywhere: 3.5 chars per token, no tokenizer. */
export const estimateTokens = (chars: number): number => Math.round(chars / 3.5);
