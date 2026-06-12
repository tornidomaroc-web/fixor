/**
 * Scan-integrity tally for LLM detection calls.
 *
 * Why this exists: when an LLM call fails (dead key, 401, network error,
 * timeout, rate limit), every detector returns [] — indistinguishable
 * from "analyzed and found nothing". Proven live 2026-06-11 (audit run 3:
 * 68 of 90 calls failed after the key died mid-run, and the output still
 * read as a clean scan). For a security tool a false "you're clean" is
 * the worst possible output, so every detection-path callClaude outcome
 * is tallied here at the single chokepoint (anthropic-client.ts) and
 * surfaced in the scan report, the workflow result, the SARIF invocation
 * record, and the CLI exit code.
 *
 * Auxiliary calls (fix generation, risk explainer) are excluded by tag:
 * their failures degrade output quality, not detection coverage, and
 * already surface via visible fallbacks and workflow errors.
 *
 * The tally is module-global with snapshot/delta reads (no plumbing
 * through detector signatures). Concurrent scans in one process can only
 * over-attribute failures to each other (a spurious degraded warning),
 * never under-attribute (a missed one) — fail-closed in the direction
 * that matters for a security tool.
 */

export interface LlmCallFailure {
  /** Stable id of the calling analyzer/detector (e.g. "idor-multi"). */
  caller: string;
  /** Failure class from MessagesCallResult ("no_api_key", "timeout", ...). */
  reason: string;
  model: string;
}

/** Opaque marker for "where the tally stood when my scan started". */
export interface LlmCoverageSnapshot {
  attempted: number;
  failureIndex: number;
}

export interface LlmCoverageDelta {
  /** Detection calls attempted since the snapshot (terminal outcomes only — internal retries are one call). */
  attempted: number;
  /** Detection calls that ended in failure. failed > 0 ⇒ coverage is degraded and 0 findings ≠ clean. */
  failed: number;
  byReason: Record<string, number>;
  byCaller: Record<string, number>;
}

let attempted = 0;
const failures: LlmCallFailure[] = [];

export function recordLlmDetectionCall(
  outcome: { ok: true } | { ok: false; failure: LlmCallFailure },
): void {
  attempted++;
  if (!outcome.ok) failures.push(outcome.failure);
}

export function snapshotLlmCoverage(): LlmCoverageSnapshot {
  return { attempted, failureIndex: failures.length };
}

export function llmCoverageSince(
  snap: LlmCoverageSnapshot,
): LlmCoverageDelta {
  const slice = failures.slice(snap.failureIndex);
  const byReason: Record<string, number> = {};
  const byCaller: Record<string, number> = {};
  for (const f of slice) {
    byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
    byCaller[f.caller] = (byCaller[f.caller] ?? 0) + 1;
  }
  return {
    attempted: attempted - snap.attempted,
    failed: slice.length,
    byReason,
    byCaller,
  };
}

/**
 * CLI exit-code contract: 0 = scan completed with full detection
 * coverage; 2 = scan completed but coverage was degraded (≥1 detection
 * call failed) — CI must not treat the report as a clean result.
 * (1 remains "crashed / usage error", set elsewhere.)
 */
export function coverageExitCode(failed: number): 0 | 2 {
  return failed > 0 ? 2 : 0;
}
