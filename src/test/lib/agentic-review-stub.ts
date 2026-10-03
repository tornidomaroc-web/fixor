/**
 * Stub `claude` executable for `test:agentic-review-rehearsal`. No model, no
 * outbound network. It records what it receives (argv, stdin, cwd, env) to
 * `capture.jsonl` beside itself and answers in the stream-json shape
 * `claude -p --output-format stream-json --verbose` prints. Behaviour comes
 * from `stub-config.json` beside itself:
 *
 *   marker        a string; every file in the cwd tree containing it is
 *                 reported as `# Vuln N: missing_authorization: \`path:line\``
 *                 at the marker's line (the "detector" behaviour)
 *   flagAll       also report every file listed in the prompt's FILES
 *                 MODIFIED block, at the first changed line the prompt's
 *                 diff shows for it (the "flag everything" behaviour)
 *   category      the category word to print (default missing_authorization)
 *   reportModel   the model to report (default: the --model argv)
 *   extraTool     emit one tool_use with this tool name (to test the audit)
 *   extraBash     emit one Bash tool_use with this command
 *   extraUse      emit one tool_use {name, input}; "{cwd}" in a string input becomes the cwd
 *   failAfter     exit 1 with no output once more than N runs have been made
 *   writeFile     write this relative file into the cwd (to test the clean-tree check)
 *   outputTokens  output_tokens to report (default 2000)
 *
 * WIRE CHECK (ANTHROPIC_BASE_URL set): POSTs the request the real CLI was
 * seen to send for the built-in command, bent by `wire` as the proxy-judge
 * stub does, then exits 1 on the recorder's 400.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join, relative } from "node:path";

interface Cfg { marker?: string; flagAll?: boolean; category?: string; reportModel?: string; extraTool?: string; extraBash?: string; extraUse?: { name: string; input: Record<string, string> }; failAfter?: number; writeFile?: string; outputTokens?: number; wire?: Record<string, unknown> }
const here = __dirname;
const cfgPath = join(here, "stub-config.json");
const cfg = (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}) as Cfg;
const argv = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
const cwd = process.cwd();
const opt = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const bump = (file: string): number => { const p = join(here, file); const n = (existsSync(p) ? Number(readFileSync(p, "utf8")) : 0) + 1; writeFileSync(p, String(n)); return n; };
const model = cfg.reportModel ?? opt("--model") ?? "unknown";
const tools = (opt("--tools") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const base = process.env["ANTHROPIC_BASE_URL"];
if (base) {
  appendFileSync(join(here, "wire-capture.jsonl"), JSON.stringify({ argv, stdin, cwd, env: process.env }) + "\n");
  const n = bump("wire-count.txt");
  const bend = (cfg.wire && n >= Number(cfg.wire["fromCount"] ?? 1) ? cfg.wire : {}) as Record<string, unknown>;
  if (bend["noPost"]) process.exit(1);
  const envCap = process.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"];
  const toolNames = (bend["tools"] as string[] | undefined) ?? tools;
  const body = JSON.stringify({
    model: bend["model"] ?? opt("--model") ?? "unknown",
    max_tokens: bend["maxTokens"] ?? (envCap ? Number(envCap) : 128000),
    stream: true,
    thinking: { type: bend["thinkingType"] ?? "adaptive", display: "omitted" },
    output_config: { effort: bend["effort"] ?? opt("--effort") ?? "medium" },
    system: [{ type: "text", text: "stub: claude code system prompt" }],
    messages: [{ role: "user", content: [{ type: "text", text: "stub: reminder" }, { type: "text", text: stdin }] }],
    tools: toolNames.map((t) => ({ name: t, description: "stub", input_schema: { type: "object" } })),
    metadata: { user_id: "stub" },
  });
  const headers: Record<string, string> = { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), "anthropic-version": "2023-06-01", "anthropic-beta": "stub-beta-a", authorization: (bend["auth"] as string) ?? "Bearer sk-ant-oat01-stub" };
  if (bend["apiKeyHeader"]) headers["x-api-key"] = "stub-not-a-key";
  const u = new URL("/v1/messages?beta=true", base);
  const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers }, (res) => { res.resume(); res.on("end", () => process.exit(1)); });
  req.on("error", () => process.exit(1));
  req.end(body);
} else {
  appendFileSync(join(here, "capture.jsonl"), JSON.stringify({ argv, stdin, cwd, env: process.env }) + "\n");
  const count = bump("count.txt");
  if (cfg.failAfter !== undefined && count > cfg.failAfter) { process.stderr.write("stub: simulated cut-off\n"); process.exit(1); }
  if (cfg.writeFile) writeFileSync(join(cwd, cfg.writeFile), "stub wrote this\n");

  const findings: Array<{ file: string; line: number }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      if (e === ".git" || e === "node_modules") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (cfg.marker) {
        const t = readFileSync(p, "utf8");
        const i = t.indexOf(cfg.marker);
        if (i >= 0) findings.push({ file: relative(cwd, p).replace(/\\/g, "/"), line: t.slice(0, i).split("\n").length });
      }
    }
  };
  walk(cwd);
  if (cfg.flagAll) {
    const files = (stdin.match(/FILES MODIFIED:\n\n```\n([\s\S]*?)```/) ?? [])[1]?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
    // Flag every modified file at its first route-registration line: the "every new handler lacks auth" reviewer.
    for (const f of files) {
      if (findings.some((x) => x.file === f)) continue;
      const p = join(cwd, f);
      const lines = existsSync(p) ? readFileSync(p, "utf8").split("\n") : [];
      const k = lines.findIndex((l) => /\b(router|app)\.(get|post|put|patch|delete)\s*\(/.test(l));
      findings.push({ file: f, line: k >= 0 ? k + 1 : 1 });
    }
  }
  const category = cfg.category ?? "missing_authorization";
  const md = findings.length ? findings.map((f, i) => `# Vuln ${i + 1}: ${category}: \`${f.file}:${f.line}\`\n\n* Severity: High\n* Description: stub: no model was consulted\n* Exploit Scenario: none\n* Recommendation: none\n`).join("\n") : "No high-confidence security vulnerabilities were found in this change.";
  const emit = (o: unknown): void => void process.stdout.write(JSON.stringify(o) + "\n");
  emit({ type: "system", subtype: "init", model, tools, apiKeySource: "none", claude_code_version: "stub" });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "README.md" } }] } });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "git log --no-decorate origin/HEAD..." } }] } });
  if (cfg.extraTool) emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: cfg.extraTool, input: { url: "http://example.invalid" } }] } });
  if (cfg.extraBash) emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t4", name: "Bash", input: { command: cfg.extraBash } }] } });
  if (cfg.extraUse) emit({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t5", name: cfg.extraUse.name, input: Object.fromEntries(Object.entries(cfg.extraUse.input).map(([k, v]) => [k, v.replace("{cwd}", cwd)])) }] } });
  const inputTokens = Math.ceil(stdin.length / 3.5);
  const outputTokens = cfg.outputTokens ?? 2000;
  emit({ type: "result", subtype: "success", is_error: false, duration_ms: 1, num_turns: 3, result: md, session_id: "stub", total_cost_usd: 0, usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, modelUsage: { [model]: { inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, maxOutputTokens: 128000 } } });
}
