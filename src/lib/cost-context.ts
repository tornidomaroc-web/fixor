/**
 * Async-local context that carries the GitHub installation id from the
 * webhook handler down through every Claude call without changing
 * detector / fix-service signatures.
 *
 * The handler wraps the workflow in `costContext.run({ installationId },
 * () => runAuditorWorkflow(...))`. callClaude reads the current
 * installationId from this store and records cost against it.
 *
 * A PR scan also carries its `scan_runs` row id and a per-scan spend
 * accumulator. The accumulator is the ONLY source of a scan's
 * `cost_usd`: the process-wide counters in llm-call-ledger.ts are
 * snapshot deltas, so two scans running at once would each absorb the
 * other's calls. The async-local store is per scan by construction.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface ScanSpend {
  usd: number;
}

export interface CostContextStore {
  installationId: string | number;
  /** `scan_runs.id` of the PR scan in progress; absent when no row was written. */
  scanRunId?: string;
  /** Running USD total for this scan only. */
  scanSpend?: ScanSpend;
}

export const costContext = new AsyncLocalStorage<CostContextStore>();

export function currentInstallationId(): string | number | undefined {
  return costContext.getStore()?.installationId;
}

export function currentScanRunId(): string | undefined {
  return costContext.getStore()?.scanRunId;
}

/** Adds one priced call to the current scan's total; a no-op outside a scan. */
export function addScanSpend(costUsd: number): void {
  const spend = costContext.getStore()?.scanSpend;
  if (spend && Number.isFinite(costUsd) && costUsd > 0) spend.usd += costUsd;
}
