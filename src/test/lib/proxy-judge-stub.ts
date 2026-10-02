/**
 * Stub `claude` executable for `test:proxy-judge-rehearsal`. No model, no
 * outbound network. It records EVERYTHING it receives (argv, stdin, cwd, the
 * cwd's entries, the whole environment) beside itself, so the rehearsal can
 * prove what the judge lets through, and it takes its behaviour from
 * `stub-config.json` beside itself.
 *
 * JUDGE CALL (no ANTHROPIC_BASE_URL in its environment): it appends to
 * `capture.jsonl`, counts in `count.txt`, and answers in the shape
 * `claude -p --output-format json --json-schema` prints.
 *
 *   reportModel      the model to report in modelUsage (default: the --model argv)
 *   failAfter        exit 1 with no output once more than N calls have been made
 *   flagWhen         answer vulnerable/high when stdin contains this string
 *   reportMaxOutput  the maxOutputTokens to report. Default: what the real
 *                    CLI does, the MODEL'S default (128000 for an Opus id,
 *                    else 32000) whatever CLAUDE_CODE_MAX_OUTPUT_TOKENS says
 *   reportOutputTokens  the output_tokens to report (default 120)
 *
 * WIRE CHECK (ANTHROPIC_BASE_URL set, which only the judge's wire check
 * does): it appends to `wire-capture.jsonl`, counts in `wire-count.txt`,
 * POSTs to <base>/v1/messages the request the real CLI was seen to send
 * (the model from --model, `max_tokens` from CLAUDE_CODE_MAX_OUTPUT_TOKENS
 * or the model's default, adaptive thinking, the effort from --effort or
 * high, an OAuth-shaped bearer, the system prompt, stdin and the schema)
 * and exits 1 as the real CLI does on the recorder's 400. `wire` in the
 * config bends that request, from the `fromCount`-th wire check on:
 *
 *   wire.maxTokens, wire.model, wire.thinkingType, wire.effort
 *   wire.apiKeyHeader   also send an x-api-key header
 *   wire.auth           the whole Authorization value
 *   wire.extraBeta      one more anthropic-beta flag (a shape change)
 *   wire.noPost         send nothing
 *   wire.fromCount      apply the above from this wire check on (default 1)
 *
 * The rehearsal copies the compiled file into a temporary directory and
 * writes the config there; nothing is written under the repository.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

interface WireBend {
  maxTokens?: number;
  model?: string;
  thinkingType?: string;
  effort?: string;
  apiKeyHeader?: boolean;
  auth?: string;
  extraBeta?: string;
  noPost?: boolean;
  fromCount?: number;
}
const here = __dirname;
const cfgPath = join(here, "stub-config.json");
const cfg = (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}) as { reportModel?: string; failAfter?: number; flagWhen?: string; reportMaxOutput?: number; reportOutputTokens?: number; wire?: WireBend };

const argv = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
const cwd = process.cwd();
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const bump = (file: string): number => {
  const p = join(here, file);
  const n = (existsSync(p) ? Number(readFileSync(p, "utf8")) : 0) + 1;
  writeFileSync(p, String(n));
  return n;
};
const modelDefaultCap = (m: string): number => (/opus/.test(m) ? 128000 : 32000);
const system = opt("--system-prompt") ?? "";
const schema = JSON.parse(opt("--json-schema") ?? "{}") as { properties?: Record<string, unknown> };

const base = process.env["ANTHROPIC_BASE_URL"];
if (base) {
  appendFileSync(join(here, "wire-capture.jsonl"), JSON.stringify({ argv, stdin, cwd, cwdEntries: readdirSync(cwd), env: process.env }) + "\n");
  const n = bump("wire-count.txt");
  const bend: WireBend = cfg.wire && n >= (cfg.wire.fromCount ?? 1) ? cfg.wire : {};
  if (bend.noPost) process.exit(1);
  const model = bend.model ?? opt("--model") ?? "unknown";
  const envCap = process.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"];
  const body = JSON.stringify({
    model,
    max_tokens: bend.maxTokens ?? (envCap ? Number(envCap) : modelDefaultCap(model)),
    stream: true,
    thinking: { type: bend.thinkingType ?? "adaptive", display: "omitted" },
    output_config: { effort: bend.effort ?? opt("--effort") ?? "high" },
    system: [{ type: "text", text: "stub: identity line" }, { type: "text", text: system }],
    messages: [{ role: "user", content: [{ type: "text", text: "stub: reminder" }, { type: "text", text: stdin }] }],
    tools: [{ name: "StructuredOutput", description: "stub", input_schema: schema }],
    metadata: { user_id: "stub" },
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "anthropic-version": "2023-06-01",
    "anthropic-beta": ["stub-beta-a", ...(bend.extraBeta ? [bend.extraBeta] : [])].join(","),
    authorization: bend.auth ?? "Bearer sk-ant-oat01-stub",
  };
  if (bend.apiKeyHeader) headers["x-api-key"] = "stub-not-a-key";
  const u = new URL("/v1/messages?beta=true", base);
  const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers }, (res) => {
    res.resume();
    res.on("end", () => {
      process.stderr.write(`stub: API Error ${res.statusCode}\n`);
      process.exit(1);
    });
  });
  req.on("error", () => process.exit(1));
  req.end(body);
} else {
  appendFileSync(join(here, "capture.jsonl"), JSON.stringify({ argv, stdin, cwd, cwdEntries: readdirSync(cwd), env: process.env }) + "\n");
  const count = bump("count.txt");
  if (cfg.failAfter !== undefined && count > cfg.failAfter) {
    process.stderr.write("stub: simulated cut-off (rate limit reached)\n");
    process.exit(1);
  }

  const model = cfg.reportModel ?? opt("--model") ?? "unknown";
  const vuln = !!cfg.flagWhen && stdin.includes(cfg.flagWhen);
  const confidence = vuln ? "high" : "low";
  const reasoning = "stub: no model was consulted";
  const structured_output = schema.properties && "verdicts" in schema.properties
    ? { verdicts: [{ pairIndex: 0, isVulnerable: vuln, confidence, reasoning, suggestedFix: "", callerAuth: "unclear", operationClass: "user_resource" }] }
    : { isVulnerable: vuln, confidence, reasoning, authPresent: "unclear", operationKind: "general", suggestedFix: "", vulnerableRoute: "" };

  const inputTokens = Math.ceil((system.length + stdin.length) / 3.5);
  const outputTokens = cfg.reportOutputTokens ?? 120;
  const maxOutputTokens = cfg.reportMaxOutput ?? modelDefaultCap(model);
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      num_turns: 1,
      result: "",
      session_id: "stub-session",
      total_cost_usd: 0,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } },
      modelUsage: { [model]: { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, maxOutputTokens } },
      structured_output,
    }) + "\n",
  );
}
