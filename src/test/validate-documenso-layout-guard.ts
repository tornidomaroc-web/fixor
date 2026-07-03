/**
 * Real-world validation of the Phase G layout-auth slice against the actual
 * Documenso clone (the codebase that revealed the blind spot).
 *
 * Proof standard (operator): synthetic fixtures passing is NOT the proof;
 * the real _authenticated+/admin+ routes suppressing correctly is. For each
 * real route we run admin-check twice:
 *   BEFORE  = no route-guard sidecar (today's behavior) -> expect FLAGGED
 *             (the cross-file false positive: admin read, gate is in the
 *             parent layout the detector cannot see). This BEFORE-flag also
 *             proves the fix does not over-suppress: an unguarded copy flags.
 *   AFTER   = sidecar from the REAL resolver walking the REAL ancestor
 *             _layout.tsx files (fence 4: read above scan root) -> expect
 *             CLEARED (isVulnerable=false), the FP removed.
 *
 * Halt-on-dirty-validation: if a BEFORE route does NOT flag (no FP to fix)
 * or an AFTER route is NOT cleared (fix didn't take) the script exits 1.
 */

import { readFileSync } from "node:fs";

import { AdminCheckDetector } from "../analysis-engine/detectors/admin-check.detector";
import { resolveRemixRouteGuard } from "../analysis-engine/detectors/shared/route-guard-resolver";
import { SIDECAR_KINDS } from "../analysis-engine/sidecar-kinds";

const DOC_ROUTES =
  "D:/RAGHAD JAD/Documenso/apps/remix/app/routes";

const ROUTES = [
  "_authenticated+/admin+/stats.tsx",
  "_authenticated+/admin+/organisations.$id.tsx",
  "_authenticated+/admin+/users._index.tsx",
];

interface Verdict {
  isVulnerable: boolean;
  confidence: string;
  reasoning: string;
}

async function verdictFor(
  rel: string,
  content: string,
  guard: string | null,
): Promise<Verdict | null> {
  const detector = new AdminCheckDetector();
  const sidecars = guard ? { [SIDECAR_KINDS.ROUTE_GUARD]: guard } : undefined;
  await detector.analyzeFile(`app/routes/${rel}`, content, "tsx", sidecars);
  return detector.lastDiagnostics[0]?.verdict ?? null;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stdout.write("SKIPPED: ANTHROPIC_API_KEY not set (opt-in live-LLM test). Set the key to run it live.\n");
    return;
  }

  // Show the resolver output once, to prove it found the real ancestor
  // admin layout above the route (fence 4).
  const sampleAbs = `${DOC_ROUTES}/${ROUTES[0]}`;
  const sampleGuard = resolveRemixRouteGuard(sampleAbs);
  process.stdout.write(
    `Resolver output for ${ROUTES[0]}:\n${sampleGuard ?? "(null)"}\n\n`,
  );

  let failures = 0;
  for (const rel of ROUTES) {
    const abs = `${DOC_ROUTES}/${rel}`;
    const content = readFileSync(abs, "utf8");
    const guard = resolveRemixRouteGuard(abs);

    const before = await verdictFor(rel, content, null);
    await new Promise((r) => setTimeout(r, 800));
    const after = await verdictFor(rel, content, guard);
    await new Promise((r) => setTimeout(r, 800));

    const beforeFlagged = before?.isVulnerable === true;
    const afterCleared = after?.isVulnerable === false;
    const ok = beforeFlagged && afterCleared;
    if (!ok) failures++;

    process.stdout.write(
      `[${ok ? "PASS" : "FAIL"}] ${rel}\n` +
        `   BEFORE (no guard): ${before ? `${before.isVulnerable ? "FLAGGED" : "cleared"}/${before.confidence}` : "null"}\n` +
        `   AFTER  (real guard): ${after ? `${after.isVulnerable ? "FLAGGED" : "CLEARED"}/${after.confidence}` : "null"}\n`,
    );
    if (!beforeFlagged)
      process.stdout.write("   ! BEFORE did not flag — no FP to fix here.\n");
    if (!afterCleared)
      process.stdout.write("   ! AFTER not cleared — fix did not take.\n");
    if (after?.reasoning)
      process.stdout.write(`   AFTER reasoning: ${after.reasoning}\n`);
  }

  process.stdout.write(
    `\nDocumenso real-route validation: ${ROUTES.length - failures}/${ROUTES.length} routes (BEFORE flag -> AFTER cleared)\n`,
  );
  if (failures > 0) {
    process.stdout.write("FAIL: dirty validation — halting, do not merge.\n");
    process.exit(1);
  }
  process.stdout.write("PASS.\n");
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
