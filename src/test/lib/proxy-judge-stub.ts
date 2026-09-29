/**
 * Stub `claude` executable for `test:proxy-judge-rehearsal`. No model, no
 * network. It records EVERYTHING it receives (argv, stdin, cwd, the cwd's
 * entries, the whole environment) to `capture.jsonl` beside itself, so the
 * rehearsal can prove what the judge lets through; it answers in the shape
 * `claude -p --output-format json --json-schema` prints; and it takes its
 * behaviour from `stub-config.json` beside itself, never from the
 * environment (the judge passes none):
 *
 *   reportModel  the model to report in modelUsage (default: the --model argv)
 *   failAfter    exit 1 with no output once more than N calls have been made
 *   flagWhen     answer vulnerable/high when stdin contains this string
 *   reportMaxOutput  the maxOutputTokens to report (default: what the real
 *                CLI does, CLAUDE_CODE_MAX_OUTPUT_TOKENS if the judge set it,
 *                else 32000; the one environment value it reads)
 *
 * The rehearsal copies the compiled file into a temporary directory and
 * writes the config there; nothing is written under the repository.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = __dirname;
const cfgPath = join(here, "stub-config.json");
const cfg = (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {}) as { reportModel?: string; failAfter?: number; flagWhen?: string; reportMaxOutput?: number };

const argv = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
const cwd = process.cwd();
appendFileSync(join(here, "capture.jsonl"), JSON.stringify({ argv, stdin, cwd, cwdEntries: readdirSync(cwd), env: process.env }) + "\n");

const countPath = join(here, "count.txt");
const count = (existsSync(countPath) ? Number(readFileSync(countPath, "utf8")) : 0) + 1;
writeFileSync(countPath, String(count));
if (cfg.failAfter !== undefined && count > cfg.failAfter) {
  process.stderr.write("stub: simulated cut-off (rate limit reached)\n");
  process.exit(1);
}

const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const model = cfg.reportModel ?? opt("--model") ?? "unknown";
const schema = JSON.parse(opt("--json-schema") ?? "{}") as { properties?: Record<string, unknown> };
const system = opt("--system-prompt") ?? "";
const vuln = !!cfg.flagWhen && stdin.includes(cfg.flagWhen);
const confidence = vuln ? "high" : "low";
const reasoning = "stub: no model was consulted";
const structured_output = schema.properties && "verdicts" in schema.properties
  ? { verdicts: [{ pairIndex: 0, isVulnerable: vuln, confidence, reasoning, suggestedFix: "", callerAuth: "unclear", operationClass: "user_resource" }] }
  : { isVulnerable: vuln, confidence, reasoning, authPresent: "unclear", operationKind: "general", suggestedFix: "", vulnerableRoute: "" };

const inputTokens = Math.ceil((system.length + stdin.length) / 3.5);
const outputTokens = 120;
const maxOutputTokens = cfg.reportMaxOutput ?? (process.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] ? Number(process.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"]) : 32000);
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
