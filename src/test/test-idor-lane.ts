/**
 * IDOR lane-boundary test (real-shape FastAPI corpus).
 *
 * STATUS: PENDING acceptance spec for a DEFERRED fix. The shipped idor prompt
 * still over-fires on the no-auth/admin-mutation lanes (~75% of runs on
 * users.py), so this test currently FAILS by design — that is expected, not a
 * regression. A surgical prompt clause was tried and reverted (commit history)
 * because it did not converge; reliable lane separation needs proper
 * prompt-lane iteration verified by a full idor nRuns stability re-baseline.
 * Do NOT wire into CI until that fix lands and this passes across nRuns.
 *
 * Reproduces the over-firing surfaced by the real-shape proof: the idor
 * detector claimed routes whose DOMINANT defect belongs to another detector's
 * lane — a privileged admin mutation (admin-check's lane) and a no-auth
 * destructive op (auth-bypass's lane). Classic IDOR (an AUTHENTICATED caller
 * reaching another user's OWNED sub-resource via an unscoped reference) must
 * still fire.
 *
 * Asserts:
 *   - items.py  GET /items/{item_id}      -> idor FIRES   (positive control)
 *   - admin.py  POST /users/{id}/role     -> idor SILENT  (admin-check lane)
 *   - users.py  DELETE /users/{user_id}   -> idor SILENT  (auth-bypass lane)
 *
 * COST: LLM detector test — ~3 DETECTION-model (Sonnet 4.6) calls per run,
 * one per file that clears the prefilter; ~$0.01/call ≈ $0.03/run real cost.
 * Not wired into CI (cost + non-determinism), mirroring test:idor.
 * Run: npm run test:idor-lane  (needs ANTHROPIC_API_KEY).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IdorDetector } from "../analysis-engine/detectors/idor.detector";

const APP = "fixtures/real-shape/fastapi-saas/app/routers";

async function firesIdor(file: string): Promise<boolean> {
  const detector = new IdorDetector();
  const content = readFileSync(join(APP, file), "utf8");
  const findings = await detector.analyzeFile(file, content, "py");
  return findings.length > 0;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("ANTHROPIC_API_KEY is not set. Export it before running this test.\n");
    process.exit(1);
  }

  let failures = 0;
  const check = (cond: boolean, label: string) => {
    if (cond) {
      process.stdout.write(`    PASS  ${label}\n`);
    } else {
      failures++;
      process.stdout.write(`    FAIL  ${label}\n`);
    }
  };

  const itemsFires = await firesIdor("items.py");
  check(itemsFires, "items.py GET /items/{item_id} — idor FIRES (authenticated, another's owned sub-resource, no ownership scope)");

  const adminFires = await firesIdor("admin.py");
  check(!adminFires, "admin.py POST /users/{id}/role — idor SILENT (privileged admin mutation → admin-check lane)");

  const usersFires = await firesIdor("users.py");
  check(!usersFires, "users.py DELETE /users/{user_id} — idor SILENT (no auth on destructive op → auth-bypass lane)");

  process.stdout.write(`\n[idor-lane] ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[idor-lane] ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
