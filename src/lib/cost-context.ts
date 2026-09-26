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
 *
 * The store also carries the scan's spend guard. `checkBudget` sums
 * `cost_ledger`, so a priced call whose ledger row was not written is
 * spend the cap never sees. When a ledger write fails, callClaude marks
 * the store, and every later model call in the same scan refuses before
 * it reaches the network. The flag lives on the store object, so it stops
 * this scan only; a concurrent scan runs in its own store.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface ScanSpend {
  usd: number;
}

/**
 * The scan's cancellation flag, shared by reference between the deadline
 * that sets it (lib/scan-deadline.ts) and the store that callClaude reads.
 */
export interface ScanCancel {
  cancelled: boolean;
}

export interface CostContextStore {
  installationId: string | number;
  /** `scan_runs.id` of the PR scan in progress; absent when no row was written. */
  scanRunId?: string;
  /** Running USD total for this scan only. */
  scanSpend?: ScanSpend;
  /** Set once a ledger write failed; later model calls in this scan refuse. */
  ledgerWriteFailed?: boolean;
  /** Set by the scan's deadline; later model calls in this scan refuse. */
  cancel?: ScanCancel;
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

/** Stops every later model call in the current scan; a no-op outside a scan. */
export function markLedgerWriteFailed(): void {
  const store = costContext.getStore();
  if (store) store.ledgerWriteFailed = true;
}

/** True once a ledger write in the current scan has failed. */
export function ledgerWriteFailed(): boolean {
  return costContext.getStore()?.ledgerWriteFailed === true;
}

/** True once the current scan's deadline has passed; a no-op outside a scan. */
export function scanCancelled(): boolean {
  return costContext.getStore()?.cancel?.cancelled === true;
}
