/**
 * F-001 live parity test — OPT-IN, makes real LLM calls. NOT in test:ci.
 *
 * Proves end-to-end that the shipped Engine-B path (runAuditorWorkflow),
 * once the parent-layout route-guard sidecar is resolved and forwarded,
 * CLEARS the neutral layout-gated fixture that false-positived 6/6 in
 * Phase 3D. Repeated-sample (N>=3) per the F-008 lesson: a single LLM
 * sample is not a verdict.
 *
 * Gate: runs only when FIXOR_LIVE_TESTS=1 (and ANTHROPIC_API_KEY is set).
 * Otherwise it prints "skipped" and exits 0, so it can never run — or
 * spend — in the default/CI path.
 *
 * Run: FIXOR_LIVE_TESTS=1 npm run test:f001-parity
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveRouteGuardSidecars } from "../integrations/github/whole-file-scan-input";
import { buildSyntheticDiff } from "../cli/diff-builder";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import { getAnthropicClient } from "../analysis-engine/anthropic-client";
import { calculateCost } from "../services/cost-tracking.service";

const FIXTURE_ROOT = join(__dirname, "..", "..", "fixtures", "f001-layout-guard");
const ROUTE = "app/routes/dashboard+/billing.tsx";
const LAYOUT = "app/routes/dashboard+/_layout.tsx";
const N = 3;

async function main(): Promise<void> {
  if (process.env.FIXOR_LIVE_TESTS !== "1") {
    process.stdout.write(
      "test:f001-parity SKIPPED (opt-in). Set FIXOR_LIVE_TESTS=1 to run the live parity check.\n",
    );
    return;
  }
  const client = getAnthropicClient();
  if (!client) {
    process.stdout.write("test:f001-parity SKIPPED: ANTHROPIC_API_KEY not set.\n");
    return;
  }

  // Live per-call meter (patch the cached singleton client).
  const calls: number[] = [];
  const origCreate = client.messages.create.bind(client.messages);
  (client.messages as { create: unknown }).create = async (body: any, opts: any) => {
    const msg = await origCreate(body, opts);
    const u = (msg.usage ?? {}) as unknown as Record<string, number>;
    calls.push(
      calculateCost({
        model: body.model,
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
      }),
    );
    return msg;
  };

  // Build the shipped Engine-B input for the layout-gated fixture: resolve
  // the route-guard sidecar via the async webhook resolver, then feed the
  // whole-file synthetic diff + sidecar to the workflow — exactly what the
  // fixed pr-webhook-handler assembles.
  const present = new Set([ROUTE, LAYOUT]);
  const fetchFile = async (p: string) => {
    if (present.has(p)) return readFileSync(join(FIXTURE_ROOT, p), "utf8");
    const e = new Error(`GitHub API 404`) as Error & { details: { status: number } };
    e.details = { status: 404 };
    throw e;
  };
  const { sidecarsByPath } = await resolveRouteGuardSidecars([ROUTE], fetchFile);
  const diff = buildSyntheticDiff(ROUTE, readFileSync(join(FIXTURE_ROOT, ROUTE), "utf8"));

  let falsePositives = 0;
  for (let i = 0; i < N; i++) {
    const before = calls.length;
    const r = await runAuditorWorkflow(
      { diff, sidecarsByPath, changedLinesByPath: {} },
      { scanId: `f001-parity-${i + 1}` },
    );
    const authFps = (r.fixes ?? []).filter((f) => f.findingType === "auth_bypass_risk").length;
    if (authFps > 0) falsePositives++;
    const spend = calls.slice(before).reduce((a, c) => a + c, 0);
    process.stdout.write(
      `  run ${i + 1}/${N}: auth_bypass_risk findings=${authFps} (expect 0) · $${spend.toFixed(4)}\n`,
    );
  }

  const total = calls.reduce((a, c) => a + c, 0);
  process.stdout.write(
    `\nF-001 live parity: ${falsePositives === 0 ? "PASS" : `FAIL (${falsePositives}/${N} runs still FP)`} · total $${total.toFixed(4)} across ${calls.length} calls\n`,
  );
  if (falsePositives > 0) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`ERROR: ${e && e.stack ? e.stack : String(e)}\n`);
  process.exit(1);
});
