/**
 * Proxy judge, wire check and binary pin (Opus arm amendment A2, 2026-10-02:
 * docs/measurements/forced-routing-2026-09-28/opus-arm-amendment-A2-2026-10-02.md).
 *
 * WHY. The Opus arm stopped on its first call because the judge compared
 * `modelUsage[model].maxOutputTokens` in the CLI's result against the pinned
 * cap. That field is the model's built-in default (128,000 for
 * claude-opus-5-5) whatever CLAUDE_CODE_MAX_OUTPUT_TOKENS says; the override
 * is applied to the request. So the field is recorded and never compared,
 * and the request itself is read instead.
 *
 * WHAT THE WIRE CHECK IS. One process, started exactly as a judge call is
 * (same executable, argv, stdin, whitelisted environment, fresh empty
 * working directory), with ONE addition: ANTHROPIC_BASE_URL pointing at a
 * recorder on 127.0.0.1 that answers 400 to everything. No model is
 * reached. The recorded POST /v1/messages must carry the pinned model, the
 * pinned `max_tokens`, adaptive thinking, the pinned effort, an OAuth
 * bearer and no `x-api-key`, no temperature, the request's own system
 * prompt, user message and schema, and nothing naming the repository, the
 * requests directory or the folder the CLI was started from. Its shape (`wireFingerprint`) must equal the first
 * passing check's in the same output directory.
 *
 * WHAT IT CANNOT SEE, stated so nobody reads more into a pass:
 *   1. The checked process has ANTHROPIC_BASE_URL set and the judged one
 *      does not. A CLI that builds its request differently for the real
 *      endpoint would pass here and differ there. Closing that needs TLS
 *      interception of a real call, which is a model call.
 *   2. Only the FIRST request of a process is seen. The recorder answers
 *      400, so whatever the CLI sends after a real answer (a second turn, a
 *      non-streaming retry with a lower cap) is never recorded. The judge
 *      records `num_turns` per call and stops on reported output above the
 *      pinned cap, which bounds this from one side only.
 *   3. It samples: one request before the first call of every pass and of
 *      every resume, not every call.
 *
 * The Authorization value never leaves the request handler: it is reduced
 * there to a class, and no header value other than `anthropic-beta` and
 * `anthropic-version` is kept.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** sha256 of a file, read in chunks (the CLI is about 250 MB). */
export function sha256File(path: string): string {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/**
 * Where the CLI's updater writes: it keeps the newest three builds under
 * `claude/versions/` and rewrites `.local/bin/claude(.exe)`. The pinned
 * 2.1.284 was deleted from there between the pre-registration and the run.
 */
export const UPDATER_MANAGED_PATH = /[\\/]claude[\\/]versions[\\/]|[\\/]\.local[\\/]bin[\\/]claude(\.exe)?$/i;
export const SHA256_SHAPE = /^[0-9a-f]{64}$/;

/** Returns the reason to refuse the executable, or null. */
export function binaryGate(path: string, pinnedSha256: string | undefined, hash: (p: string) => string = sha256File): { refuse: string | null; sha256: string | null } {
  if (UPDATER_MANAGED_PATH.test(path)) {
    return { refuse: `--claude ${path} is under the CLI updater's control (versions/ keeps three builds and prunes the rest; .local/bin is rewritten on update); copy the pinned build to a path the updater does not manage`, sha256: null };
  }
  if (pinnedSha256 === undefined) return { refuse: "--claude-sha256 <64 hex> is required: the judge accepts the CLI by hash, never by version string or path alone", sha256: null };
  if (!SHA256_SHAPE.test(pinnedSha256)) return { refuse: `--claude-sha256 ${pinnedSha256} is not 64 lower-case hex characters`, sha256: null };
  const actual = hash(path);
  if (actual !== pinnedSha256) return { refuse: `--claude ${path} has sha256 ${actual}, not the pinned ${pinnedSha256}`, sha256: actual };
  return { refuse: null, sha256: actual };
}

// ---------------------------------------------------------------------------
// The recorder and the capture.
// ---------------------------------------------------------------------------

export type AuthClass = "bearer-oauth" | "bearer-other" | "other" | "absent";
const OAUTH_BEARER = /^Bearer\s+sk-ant-oat\d\d-/;

export interface WireRequest {
  method: string;
  path: string;
  headerNames: string[];
  authClass: AuthClass;
  apiKeyHeader: boolean;
  betaHeader: string | null;
  versionHeader: string | null;
  body: string;
}
export interface WireCapture {
  requests: WireRequest[];
  exit: number | null;
  timedOut: boolean;
  spawnError: string | null;
}

/** A hang guard, not a measurement: nothing asserts on how long a check took. */
export const WIRE_TIMEOUT_MS = 180_000;

function one(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(",") : v;
}

/**
 * Starts the recorder, runs one process against it, returns what it sent.
 * The process gets `env` plus ANTHROPIC_BASE_URL and nothing else.
 */
export function captureWire(o: { cmd: string; args: string[]; env: Record<string, string>; stdin: string; cwd: string; timeoutMs?: number }): Promise<WireCapture> {
  return new Promise((resolveCapture) => {
    const requests: WireRequest[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const auth = one(req.headers["authorization"]);
        requests.push({
          method: req.method ?? "",
          path: req.url ?? "",
          headerNames: Object.keys(req.headers).sort(),
          authClass: auth === null ? "absent" : OAUTH_BEARER.test(auth) ? "bearer-oauth" : /^Bearer\s/.test(auth) ? "bearer-other" : "other",
          apiKeyHeader: req.headers["x-api-key"] !== undefined,
          betaHeader: one(req.headers["anthropic-beta"]),
          versionHeader: one(req.headers["anthropic-version"]),
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "wire check recorder: request recorded, no model reached" } }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      let settled = false;
      let timedOut = false;
      const finish = (exit: number | null, spawnError: string | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.closeAllConnections();
        server.close(() => resolveCapture({ requests, exit, timedOut, spawnError }));
      };
      const child = spawn(o.cmd, o.args, { cwd: o.cwd, env: { ...o.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, o.timeoutMs ?? WIRE_TIMEOUT_MS);
      child.on("error", (e) => finish(null, e.message));
      child.on("close", (code) => finish(code, null));
      child.stdin.on("error", () => undefined);
      child.stdin.end(o.stdin);
    });
  });
}

// ---------------------------------------------------------------------------
// Reading a capture.
// ---------------------------------------------------------------------------

export interface WireFacts {
  /** POSTs to /v1/messages (not count_tokens). The check needs exactly one. */
  messagesPosts: number;
  otherRequests: string[];
  parseError: string | null;
  model: unknown;
  maxTokens: unknown;
  thinking: unknown;
  outputConfig: unknown;
  temperaturePresent: boolean;
  stream: unknown;
  bodyKeys: string[];
  toolNames: string[];
  toolSchemas: unknown[];
  betas: string[];
  anthropicVersion: string | null;
  authClass: AuthClass;
  apiKeyHeader: boolean;
  messageShape: Array<{ role: string; blocks: number }>;
  systemBlocks: number;
  systemTexts: string[];
  userTexts: string[];
  /** Every string in the body, for the path-leak check. Never written anywhere. */
  strings: string[];
}

function texts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? [(b as { text: string }).text] : []));
}
function leaves(v: unknown, into: string[]): void {
  if (typeof v === "string") into.push(v);
  else if (Array.isArray(v)) for (const x of v) leaves(x, into);
  else if (v && typeof v === "object") for (const x of Object.values(v)) leaves(x, into);
}
const isMessagesPost = (r: WireRequest): boolean => r.method === "POST" && /^\/v1\/messages(\?|$)/.test(r.path);

export function wireFacts(capture: WireCapture): WireFacts {
  const posts = capture.requests.filter(isMessagesPost);
  const facts: WireFacts = {
    messagesPosts: posts.length,
    otherRequests: capture.requests.filter((r) => !isMessagesPost(r)).map((r) => `${r.method} ${r.path.split("?")[0]}`),
    parseError: null,
    model: undefined,
    maxTokens: undefined,
    thinking: undefined,
    outputConfig: undefined,
    temperaturePresent: false,
    stream: undefined,
    bodyKeys: [],
    toolNames: [],
    toolSchemas: [],
    betas: [],
    anthropicVersion: null,
    authClass: "absent",
    apiKeyHeader: capture.requests.some((r) => r.apiKeyHeader),
    messageShape: [],
    systemBlocks: 0,
    systemTexts: [],
    userTexts: [],
    strings: [],
  };
  const p = posts[0];
  if (!p) return facts;
  facts.authClass = p.authClass;
  facts.anthropicVersion = p.versionHeader;
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(p.body) as Record<string, unknown>;
  } catch (e) {
    facts.parseError = (e as Error).message;
    return facts;
  }
  facts.model = b["model"];
  facts.maxTokens = b["max_tokens"];
  facts.thinking = b["thinking"];
  facts.outputConfig = b["output_config"];
  facts.temperaturePresent = "temperature" in b;
  facts.stream = b["stream"];
  facts.bodyKeys = Object.keys(b).sort();
  const tools = Array.isArray(b["tools"]) ? (b["tools"] as Array<{ name?: unknown; input_schema?: unknown }>) : [];
  facts.toolNames = tools.map((t) => String(t.name));
  facts.toolSchemas = tools.map((t) => t.input_schema);
  const bodyBetas = Array.isArray(b["betas"]) ? (b["betas"] as unknown[]).map(String) : [];
  facts.betas = [...new Set([...(p.betaHeader ?? "").split(",").map((s) => s.trim()).filter(Boolean), ...bodyBetas])].sort();
  const messages = Array.isArray(b["messages"]) ? (b["messages"] as Array<{ role?: unknown; content?: unknown }>) : [];
  facts.messageShape = messages.map((m) => ({ role: String(m.role), blocks: Array.isArray(m.content) ? m.content.length : 1 }));
  facts.systemBlocks = Array.isArray(b["system"]) ? (b["system"] as unknown[]).length : b["system"] === undefined ? 0 : 1;
  facts.systemTexts = texts(b["system"]);
  facts.userTexts = messages.filter((m) => m.role === "user").flatMap((m) => texts(m.content));
  leaves(b, facts.strings);
  return facts;
}

/** JSON with object keys sorted at every level: two equal values give equal text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export interface WireExpect {
  model: string;
  maxTokens: number;
  effort: string;
  /** The request's own content: what a judge call for it would carry. */
  system: string;
  user: string;
  schema: unknown;
  /** Paths that must not occur in any string of the body. */
  forbidden: string[];
}

/** The tool `--json-schema` turns the required output shape into. */
export const WIRE_TOOL_NAME = "StructuredOutput";

/** Every way the recorded request differs from what the run pins. Empty means the check passed. */
export function checkWire(f: WireFacts, e: WireExpect): string[] {
  const bad: string[] = [];
  if (f.messagesPosts !== 1) {
    bad.push(`expected exactly one POST /v1/messages, saw ${f.messagesPosts}${f.otherRequests.length ? ` (other requests: ${f.otherRequests.join(", ")})` : ""}`);
    if (f.messagesPosts === 0) return bad;
  }
  if (f.parseError) return [...bad, `the recorded body is not JSON: ${f.parseError}`];
  if (f.model !== e.model) bad.push(`model on the wire is ${JSON.stringify(f.model)}, pinned ${e.model}`);
  if (f.maxTokens !== e.maxTokens) bad.push(`max_tokens on the wire is ${JSON.stringify(f.maxTokens)}, pinned ${e.maxTokens}`);
  if ((f.thinking as { type?: unknown } | undefined)?.type !== "adaptive") bad.push(`thinking on the wire is ${JSON.stringify(f.thinking)}, expected adaptive`);
  if ((f.outputConfig as { effort?: unknown } | undefined)?.effort !== e.effort) bad.push(`output_config on the wire is ${JSON.stringify(f.outputConfig)}, pinned effort ${e.effort}`);
  if (f.temperaturePresent) bad.push("a temperature is sent; neither arm's recorded request carried one");
  if (f.apiKeyHeader) bad.push("an x-api-key header is sent: this process would bill the API");
  if (f.authClass !== "bearer-oauth") bad.push(`authorization is ${f.authClass}, expected a Bearer OAuth access token (the subscription login)`);
  if (f.toolNames.length !== 1 || f.toolNames[0] !== WIRE_TOOL_NAME) bad.push(`tools on the wire are [${f.toolNames.join(", ")}], expected only ${WIRE_TOOL_NAME}`);
  else if (canonical(f.toolSchemas[0]) !== canonical(e.schema)) bad.push("the tool's input schema on the wire is not the request's schema");
  if (!f.systemTexts.includes(e.system)) bad.push("no system block on the wire equals the request's system prompt");
  if (!f.userTexts.includes(e.user)) bad.push("no user text block on the wire equals the request's user message");
  for (const s of e.forbidden) {
    if (s && f.strings.some((x) => x.includes(s) || x.includes(s.replace(/\\/g, "/")))) bad.push(`the body names ${s}`);
  }
  return bad;
}

/**
 * The request's shape with the case content and every per-call value left
 * out. The first passing check in an output directory becomes the baseline;
 * a later check that differs stops the run, so a pass cannot silently be
 * judged under a different request shape than the one before it.
 */
export function wireFingerprint(f: WireFacts): Record<string, unknown> {
  return {
    model: f.model,
    max_tokens: f.maxTokens,
    thinking: f.thinking,
    output_config: f.outputConfig,
    temperaturePresent: f.temperaturePresent,
    stream: f.stream,
    bodyKeys: f.bodyKeys,
    toolNames: f.toolNames,
    betas: f.betas,
    anthropicVersion: f.anthropicVersion,
    authClass: f.authClass,
    apiKeyHeader: f.apiKeyHeader,
    messageShape: f.messageShape,
    systemBlocks: f.systemBlocks,
  };
}
