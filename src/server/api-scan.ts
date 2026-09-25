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
import { costContext, type CostContextStore } from "../lib/cost-context";
import { logger } from "../lib/logger";
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
  const queue = deps.queue ?? scanQueue;
  const ctx: CostContextStore = { installationId };
  type Gated =
    | { refusal: NonNullable<ReturnType<typeof budgetRefusalHttp>> }
    | { workflow: WorkflowResult };
  const outcome = await queue.run<Gated>(installationId, async () => {
    const refusal = budgetRefusalHttp(await deps.checkBudget(installationId));
    if (refusal) return { refusal };
    const workflow = await costContext.run(ctx, () =>
      deps.runWorkflow(diff, metadata),
    );
    return { workflow };
  });
  if ("refusal" in outcome) return { ...outcome.refusal, ran: false };
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
