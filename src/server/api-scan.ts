/**
 * The budget gate and the scan behind `POST /api/v1/scan`, after the
 * token, rate limit and body checks in webhook-server.ts. Split out
 * because webhook-server.ts starts the server when imported, so the spend
 * rules here could not be witnessed keylessly there.
 *
 * Every model call is priced against the org's installation:
 *   - no installation for the org: refused, because nothing could be
 *     recorded or capped (it used to run unpriced and uncapped);
 *   - budget refused: the existing 402 / 503 answers;
 *   - a ledger write failed mid-scan: later model calls were refused, so
 *     the result is partial. It is answered 503 with no findings, never
 *     200: a CI caller reads 200 as a pass.
 */
import { costContext, type CostContextStore, type ScanCancel } from "../lib/cost-context";
import { logger } from "../lib/logger";
import {
  DEFAULT_SCAN_DEADLINE_MS,
  holdSlotUntilSettled,
  reportSlotLeak,
  startSignal,
  withScanDeadline,
} from "../lib/scan-deadline";
import { scanQueue, type ScanQueue } from "../lib/scan-queue";
import {
  budgetRefusalHttp,
  checkBudget,
  type BudgetCheck,
} from "../services/cost-store";
import type { ScanMetadata, WorkflowResult } from "../types/workflow.types";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";

export interface ApiScanResponse {
  status: number;
  /** True when the workflow ran, fully or partly. */
  ran: boolean;
  body: unknown;
  retryAfterSeconds?: number;
}

export interface ApiScanDeps {
  checkBudget: (installationId: string) => Promise<BudgetCheck>;
  runWorkflow: (diff: string, metadata: ScanMetadata) => Promise<WorkflowResult>;
  /** The queue the budget read and the scan run through, serial per installation. */
  queue?: ScanQueue;
  /** Longest the scan may run once started; default DEFAULT_SCAN_DEADLINE_MS. */
  deadlineMs?: number;
  /** How long past the deadline the slot is held while the scan settles; default the deadline. */
  slotGraceMs?: number;
}

const defaultDeps: ApiScanDeps = {
  checkBudget,
  runWorkflow: runAuditorWorkflow,
  queue: scanQueue,
};

export async function runApiScan(
  installationId: string | null,
  diff: string,
  metadata: ScanMetadata,
  deps: ApiScanDeps = defaultDeps,
): Promise<ApiScanResponse> {
  if (!installationId) {
    logger.error(
      { scanId: metadata.scanId },
      "api scan refused: the token's org has no installation, so its spend could not be recorded",
    );
    return {
      status: 503,
      ran: false,
      body: {
        error: "spend_unrecordable",
        message:
          "Fixor could not record usage for this scan, so nothing was scanned.",
      },
    };
  }

  // The budget read and the scan share one queue slot per installation,
  // with the webhook scans: a second request cannot read the ledger
  // before the first has written to it (lib/scan-queue.ts).
  //
  // Bounded like a webhook scan (lib/scan-deadline.ts): at the deadline
  // the caller gets 504 and the scan's model calls are cancelled, while
  // the slot stays held until the scan settles (or the grace runs out).
  // Without this a hung API scan held its installation's chain and one
  // global slot until the process restarted (tracker item 5c).
  const queue = deps.queue ?? scanQueue;
  const cancel: ScanCancel = { cancelled: false };
  const ctx: CostContextStore = { installationId, cancel };
  const deadlineMs = deps.deadlineMs ?? DEFAULT_SCAN_DEADLINE_MS;
  const label = { installationId, scanId: metadata.scanId, path: "api/v1/scan" };
  type Gated =
    | { refusal: NonNullable<ReturnType<typeof budgetRefusalHttp>> }
    | { workflow: WorkflowResult }
    | { timedOut: true };
  const clock = startSignal();
  let started: number | undefined;
  const scan = queue.run(
    installationId,
    holdSlotUntilSettled<Gated>({
      deadlineMs,
      graceMs: deps.slotGraceMs,
      work: async () => {
        started = Date.now();
        clock.started();
        const refusal = budgetRefusalHttp(await deps.checkBudget(installationId));
        if (refusal) return { refusal };
        const workflow = await costContext.run(ctx, () =>
          deps.runWorkflow(diff, metadata),
        );
        return { workflow };
      },
      onLeak: () => reportSlotLeak(label, started === undefined ? 0 : Date.now() - started),
    }),
  );
  const outcome = await withScanDeadline<Gated>({
    scan: scan as Promise<Gated>,
    deadlineMs,
    startsWhen: clock.whenStarted,
    cancel,
    label,
    onDeadline: () => ({ timedOut: true }),
  });
  if ("refusal" in outcome) return { ...outcome.refusal, ran: false };
  if ("timedOut" in outcome) {
    // No scan_runs row exists for an API scan (rows are keyed by pull
    // request delivery), so the timeout is recorded only here and in
    // Sentry. 504: the scan ran and was stopped; a CI caller must not
    // read this as a pass.
    return {
      status: 504,
      ran: true,
      body: {
        error: "scan_timed_out",
        message: `Fixor stopped this scan after ${deadlineMs} ms without a result. Retry with a smaller diff.`,
      },
    };
  }
  const { workflow } = outcome;

  if (ctx.ledgerWriteFailed) {
    logger.error(
      { installationId, scanId: metadata.scanId },
      "api scan stopped early: a ledger write failed, so later model calls were refused",
    );
    return {
      status: 503,
      ran: true,
      body: {
        error: "spend_unrecorded",
        message:
          "Fixor could not record this scan's usage and stopped it before finishing, so no result is returned. Retry shortly.",
      },
      retryAfterSeconds: 60,
    };
  }

  return {
    status: 200,
    ran: true,
    body: {
      status: workflow.status,
      automationReady: workflow.automationReady,
      totalFindings: workflow.totalFindings,
      classifiedFindings: workflow.classifiedFindings,
      skippedFindings: workflow.skippedFindings,
      fixesGenerated: workflow.fixesGenerated,
      fixes: workflow.fixes,
      errors: workflow.errors,
      timing: workflow.timing,
    },
  };
}
