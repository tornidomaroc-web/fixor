import { analyzePrDiff } from "../../services/pr-diff-analyzer";
import { getInstallationToken, readAppId } from "./app-auth.service";
import { generatePdfReport } from "../../services/pdf-report.service";
import {
  uploadPdfBuffer,
  uploadSarifText,
  buildReportPublicId,
  buildSignedReportUrl,
} from "../../services/cloudinary-upload.service";
import {
  buildSarifLog,
  sarifToJson,
} from "../../services/sarif-output.service";
import { runAuditorWorkflow } from "../../workflows/auditor-workflow";
import type { ScanMetadata, WorkflowResult } from "../../types/workflow.types";
import type { GitHubApiErrorDetails } from "./github-api-error";
import { GitHubApiError } from "./github-api-error";
import { postFixorPullRequestComment } from "./post-pr-comment.service";
import type { PostPrCommentResult } from "./github-types";
import { validateGitHubPullRequestPayload } from "./github-payload-validation";
import { buildFixorExecutionKey } from "./persistence/pilot-store";
import { verifyGitHubWebhookSignature256 } from "./webhook-signature";
import { fetchFileAtRef, fetchPrDiff } from "./github-client";
import {
  buildWholeFileScanInput,
  resolveRouteGuardSidecars,
} from "./whole-file-scan-input";
import { costContext, type CostContextStore, type ScanCancel, type ScanSpend } from "../../lib/cost-context";
import {
  DEFAULT_SCAN_DEADLINE_MS,
  holdSlotUntilSettled,
  reportSlotLeak,
  withScanDeadline,
} from "../../lib/scan-deadline";
import { checkBudget, type BudgetCheck } from "../../services/cost-store";
import {
  drizzleScanRunStore,
  emptyOutcome,
  outcomeFromWorkflow,
  type ScanRunOutcome,
  type ScanRunStore,
  type UnfinishedScanRun,
} from "../../services/scan-run-store";
import { logger } from "../../lib/logger";
import { scanQueue, type ScanQueue } from "../../lib/scan-queue";
import { maybeSendFirstScanEmail } from "../../services/first-scan-email";
import {
  computeBudgetWarning,
  triggerLimitWarningEmailIfNeeded,
} from "../../services/scan-limit-warning";
import * as Sentry from "@sentry/node";

export type SemgrepPayloadResolver = (ctx: {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  action?: string;
}) => Promise<unknown> | unknown;

export type HandlePullRequestWebhookOptions = {
  rawBody: string | Buffer;
  payload: unknown;
  signatureHeader?: string | null;
  webhookSecret?: string;
  /** When true, `X-Hub-Signature-256` is not verified (local demos / tests). */
  skipSignatureVerification?: boolean;
  /** Actual dry-run mode for comment posting (mirrored on result). */
  dryRun: boolean;
  /** When omitted, the PR diff is fetched from GitHub via {@link fetchPrDiff}. */
  resolveSemgrep?: SemgrepPayloadResolver;
  workflowMetadata?: ScanMetadata;
  token?: string;
  apiBaseUrl?: string;
  updateExisting?: boolean;
  maxDetailedFixes?: number;
  /** Overrides default `owner/repo/pr-N/sha` idempotency key. */
  executionKey?: string;
  usePrDiffFallback?: boolean;
  /**
   * H2 test/demo injection: overrides the GitHub contents fetch used to
   * upgrade the PR diff to whole-file scan input. When provided and
   * `resolveSemgrep` returns a raw diff string, the same whole-file
   * enrichment runs deterministically (no network).
   */
  fetchFileAtRefImpl?: (path: string) => Promise<string>;
  /**
   * Test injection: overrides the budget gate (both the pre-scan check and
   * the post-scan re-read). Production always uses `checkBudget`.
   */
  checkBudgetImpl?: (installationId: number | string) => Promise<BudgetCheck>;
  /**
   * `X-GitHub-Delivery` of this delivery. Recorded on the scan_runs row,
   * where its unique index stops a redelivered event being scanned twice.
   */
  deliveryId?: string | null;
  /** Test injection: the scan_runs writer. Production uses the Drizzle store. */
  scanRunStore?: ScanRunStore;
  /**
   * A delivery with no installation cannot be priced or capped, so it is
   * refused unless the caller says so. Only demos and keyless tests set
   * this; the webhook server never does.
   */
  allowUnpricedScan?: boolean;
  /**
   * How long one scan may take, everything included, before its row is
   * closed as `timed_out` and the caller is answered. The work itself is
   * not cancelled (GitHub fetches carry no timeout), but its row cannot
   * stay `running` forever. Default DEFAULT_SCAN_DEADLINE_MS.
   */
  scanDeadlineMs?: number;
  /**
   * How long past the deadline a timed-out scan keeps its queue slot while
   * it settles; then the slot is released and the leak reported. Default:
   * the deadline again (lib/scan-deadline.ts).
   */
  scanSlotGraceMs?: number;
  /** Test injection: the queue scans run through. Production uses the process-wide one. */
  scanQueue?: ScanQueue;
  pilotPersistence?: boolean;
  pilotStorePath?: string;
  forceRepost?: boolean;
  maxCommentUtf8Bytes?: number;
};

export type WebhookSignatureState = "skipped" | "valid" | "invalid";

export type HandlePullRequestWebhookSuccess = {
  ok: true;
  dryRun: boolean;
  signatureState: WebhookSignatureState;
  data: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
  };
  workflow: WorkflowResult;
  comment: PostPrCommentResult;
};

export type HandlePullRequestWebhookFailure = {
  ok: false;
  dryRun: boolean;
  signatureState: WebhookSignatureState;
  error: string;
  missingFields?: string[];
  /** Present when GitHub REST returned a non-2xx response. */
  githubError?: GitHubApiErrorDetails;
  /**
   * The delivery was already recorded, so nothing ran. Not a failure:
   * the route answers 200 for it.
   */
  duplicateDelivery?: true;
  /** The delivery names no installation and `allowUnpricedScan` is not set. */
  unpricedRefused?: true;
  /** The scan outlived `scanDeadlineMs`; its row is closed as timed out. */
  timedOut?: true;
};

/** A delivery the webhook can acknowledge: its row exists (or its insert failed and the run will say so). */
export type AcceptedPullRequestDelivery = {
  accepted: true;
  scanRunId: string | null;
  /** False when the scan_runs insert failed: nothing durable records this delivery. */
  recorded: boolean;
  data: { owner: string; repo: string; pullNumber: number; headSha: string };
  /** The scan, the comment and the row's final state. Call once. */
  run: () => Promise<HandlePullRequestWebhookResult>;
};

export type AcceptPullRequestDeliveryResult =
  | AcceptedPullRequestDelivery
  | { accepted: false; result: HandlePullRequestWebhookFailure };

/** Ten minutes: the 120 s workflow race plus every GitHub call, several times over. Defined in lib/scan-deadline.ts, shared with the API path. */
export { DEFAULT_SCAN_DEADLINE_MS };

export type HandlePullRequestWebhookResult =
  | HandlePullRequestWebhookSuccess
  | HandlePullRequestWebhookFailure;

/**
 * Validates webhook payload (and optionally signature), resolves Semgrep JSON, runs Fixor workflow,
 * then builds and posts/updates the aggregated PR comment (or dry-run preview).
 *
 * The synchronous composition of acceptPullRequestDelivery and its `run`,
 * for demos, tests and any caller that wants the result in one call. The
 * webhook server uses the two halves: it acknowledges after accept and
 * runs the scan afterwards (github-webhook-route.ts).
 */
export async function handlePullRequestWebhook(
  options: HandlePullRequestWebhookOptions
): Promise<HandlePullRequestWebhookResult> {
  return Sentry.startSpan(
    {
      name: "fixor.handler.pr_webhook",
      op: "http.webhook",
      attributes: {
        "fixor.dry_run": options.dryRun === true,
        "fixor.skip_signature": options.skipSignatureVerification === true,
      },
    },
    async () => {
      const accepted = await acceptPullRequestDelivery(options);
      return accepted.accepted ? accepted.run() : accepted.result;
    },
  );
}

/**
 * A GitHub call that failed inside the webhook is a loud failure, never a
 * quiet `ok:false`: from 2026-07-10 to 2026-09-23 every comment post was
 * refused with 401 by an expired token, the handler returned `ok:false`,
 * the webhook answered 200, and nothing was logged or sent to Sentry, so
 * about 96 scanned and paid-for pull requests received no comment and
 * nobody knew. Logs at error level and captures to Sentry (a no-op when
 * SENTRY_DSN is unset), tagged with the phase that failed.
 */
export function reportGitHubFailure(
  phase: "pr_fetch" | "comment_post",
  err: GitHubApiError,
  where: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
    installationId: number | null;
  },
): void {
  const fields = {
    phase,
    status: err.details.status,
    reason: err.details.message,
    requestId: err.details.requestId,
    ...where,
  };
  logger.error(
    fields,
    phase === "comment_post"
      ? "GitHub refused the PR comment: the scan ran but no report was posted"
      : "GitHub refused the pull request fetch: the scan did not run",
  );
  Sentry.captureException(err, {
    tags: { "fixor.phase": phase, "fixor.github_status": String(err.details.status) },
    extra: fields,
  });
}

/**
 * The half of the handler that runs before the webhook is acknowledged:
 * signature, payload, the installation, and the scan_runs row. Cheap and
 * free of GitHub calls, budget reads and model calls, so the answer to
 * GitHub arrives in well under its 10 s limit. Everything that can take
 * long, or spend, is behind `run`.
 */
export async function acceptPullRequestDelivery(
  options: HandlePullRequestWebhookOptions,
): Promise<AcceptPullRequestDeliveryResult> {
  const dryRun = options.dryRun === true;
  const refuse = (result: HandlePullRequestWebhookFailure): AcceptPullRequestDeliveryResult =>
    ({ accepted: false, result });

  let signatureState: WebhookSignatureState = "skipped";
  if (!options.skipSignatureVerification) {
    const secret = options.webhookSecret?.trim();
    if (!secret) {
      return refuse({
        ok: false,
        dryRun,
        signatureState: "invalid",
        error:
          "Webhook signature verification required but GITHUB_WEBHOOK_SECRET (or webhookSecret) is missing",
      });
    }
    const valid = verifyGitHubWebhookSignature256(
      options.rawBody,
      options.signatureHeader,
      secret
    );
    signatureState = valid ? "valid" : "invalid";
    if (!valid) {
      return refuse({
        ok: false,
        dryRun,
        signatureState: "invalid",
        error: "Invalid or missing X-Hub-Signature-256",
      });
    }
  }

  const validated = validateGitHubPullRequestPayload(options.payload);
  if (!validated.ok) {
    return refuse({
      ok: false,
      dryRun,
      signatureState,
      error: validated.error,
      missingFields: validated.missingFields,
    });
  }

  const { owner, repo, pullNumber, headSha, action } = validated.data;

  const payloadObj = options.payload as Record<string, unknown> | null;
  const installation = payloadObj && typeof payloadObj === "object"
    ? (payloadObj as any).installation
    : null;
  const installationId = installation && typeof installation.id === "number"
    ? installation.id
    : null;

  // A delivery with no installation cannot be scoped to an org, so it has
  // no budget, no ledger and no row. A GitHub App delivery always carries
  // one; this is reachable only by a repository webhook configured with
  // Fixor's secret, or a local demo. Refused unless the caller opted in.
  if (installationId === null && options.allowUnpricedScan !== true) {
    logger.warn(
      { owner, repo, pullNumber, headSha },
      "pull_request delivery names no installation: refused, it cannot be priced",
    );
    return refuse({
      ok: false,
      dryRun,
      signatureState,
      error: "Delivery names no installation; refused because it cannot be priced",
      unpricedRefused: true,
    });
  }

  // One scan_runs row per delivery that names an installation, written
  // before the acknowledgement and before any GitHub call or budget read,
  // so every outcome below has a row to finish and a process that dies
  // leaves a row for the sweeper.
  const store = options.scanRunStore ?? drizzleScanRunStore();
  const run: ScanRunState = {
    id: null,
    outcome: null,
    spend: { usd: 0 },
    preScanWriteFailed: false,
    spendUnrecorded: false,
    finished: false,
    cancel: { cancelled: false },
  };
  if (installationId !== null) {
    const deliveryId = options.deliveryId ?? null;
    try {
      const created = await store.createPending({
        installationId: String(installationId),
        deliveryId,
        repoFullName: `${owner}/${repo}`,
        pullNumber,
        headSha,
        startedAt: new Date(),
      });
      if (!created.created) {
        // Already received: this delivery has a row, so it was scanned
        // (or is being scanned). Scanning it again would charge it again.
        logger.info(
          { deliveryId, installationId, owner, repo, pullNumber, headSha },
          "pull_request delivery already recorded; not scanned again",
        );
        return refuse({
          ok: false,
          dryRun,
          signatureState,
          error: "Delivery already received; not scanned again",
          duplicateDelivery: true,
        });
      }
      run.id = created.id;
    } catch (err) {
      // A database that refuses this write will refuse the ledger writes
      // too, and an unrecorded call is spend the cap never sees. The scan
      // is refused before any model call (scanDelivery).
      reportScanRunFailure("create", err, { installationId, deliveryId, owner, repo, pullNumber, headSha });
      run.preScanWriteFailed = true;
    }
  }

  const ctx: DeliveryContext = {
    dryRun,
    signatureState,
    owner,
    repo,
    pullNumber,
    headSha,
    action,
    installationId,
  };
  return {
    accepted: true,
    scanRunId: run.id,
    recorded: installationId === null || !run.preScanWriteFailed,
    data: { owner, repo, pullNumber, headSha },
    run: () => runAccepted(options, run, store, ctx),
  };
}

/**
 * The scan, bounded by the deadline, with the row's final state written
 * exactly once. When the deadline wins, the row is closed as `timed_out`
 * and the caller is answered; the work is not cancelled, and whatever it
 * writes afterwards is a no-op against the finished row.
 */
async function runAccepted(
  options: HandlePullRequestWebhookOptions,
  run: ScanRunState,
  store: ScanRunStore,
  ctx: DeliveryContext,
): Promise<HandlePullRequestWebhookResult> {
  const { owner, repo, pullNumber, headSha, installationId } = ctx;
  const finishOnce = async (): Promise<void> => {
    // The ONLY place a row reaches its final state, exactly once. An
    // outcome left unset means the scan threw before it decided one.
    if (run.id === null || run.finished) return;
    run.finished = true;
    const outcome = run.outcome ?? emptyOutcome("failed", "internal_error");
    try {
      await store.finish(run.id, outcome, new Date());
    } catch (err) {
      reportScanRunFailure("finish", err, { installationId, owner, repo, pullNumber, headSha });
    }
  };

  // One scan at a time per installation, so each budget read sees the
  // previous scan's ledger rows, and a bounded number at once overall
  // (lib/scan-queue.ts). The deadline starts when the scan starts, not
  // while it waits in the queue.
  //
  // The queued task is the scan itself, so the slot is held until the scan
  // has settled (bounded by the grace in lib/scan-deadline.ts), and the
  // deadline race sits OUTSIDE the queue: at the deadline the caller is
  // answered, the row is closed as timed_out and the scan's model calls
  // are cancelled, but its slot is not handed to the next scan while it
  // still runs. The 202 was sent long before any of this (ack-then-scan).
  const queue = options.scanQueue ?? scanQueue;
  const queueKey =
    installationId !== null ? String(installationId) : `unpriced:${owner}/${repo}`;
  const deadlineMs = options.scanDeadlineMs ?? DEFAULT_SCAN_DEADLINE_MS;
  const label = { installationId, owner, repo, pullNumber, headSha, scanRunId: run.id };
  let started: number | undefined;
  const scan = queue.run(
    queueKey,
    holdSlotUntilSettled({
      deadlineMs,
      graceMs: options.scanSlotGraceMs,
      work: async () => {
        started = Date.now();
        try {
          return await scanDelivery(options, run, store, ctx);
        } finally {
          await finishOnce();
        }
      },
      onLeak: () => reportSlotLeak(label, started === undefined ? 0 : Date.now() - started),
    }),
  );

  return withScanDeadline<HandlePullRequestWebhookResult>({
    // A leaked slot resolves the queue task with `undefined`; the caller
    // was answered at the deadline long before, so that value is never seen.
    scan: scan as Promise<HandlePullRequestWebhookResult>,
    deadlineMs,
    cancel: run.cancel,
    label,
    onDeadline: async () => {
      if (!run.finished) {
        run.outcome = emptyOutcome("failed", "timed_out");
        await finishOnce();
      }
      return {
        ok: false,
        dryRun: ctx.dryRun,
        signatureState: ctx.signatureState,
        error: `Scan did not finish within ${deadlineMs} ms`,
        timedOut: true,
      };
    },
  });
}

/**
 * Re-runs a recorded delivery from its row (scan-run-sweeper.ts). The row
 * already exists, so nothing is inserted and the delivery id is not
 * checked again; the store's own `markRunning` leaves a `retrying` row
 * marked as the retry it is.
 */
export async function rerunRecordedScanRun(
  row: UnfinishedScanRun,
  store: ScanRunStore,
  overrides: Partial<HandlePullRequestWebhookOptions> = {},
): Promise<HandlePullRequestWebhookResult> {
  const slash = row.repoFullName.indexOf("/");
  const owner = row.repoFullName.slice(0, slash);
  const repo = row.repoFullName.slice(slash + 1);
  const installationId = Number.parseInt(row.installationId, 10);
  if (slash <= 0 || !repo || !Number.isFinite(installationId)) {
    throw new Error(`scan_runs row ${row.id} cannot be re-run: bad coordinates`);
  }
  const options: HandlePullRequestWebhookOptions = {
    rawBody: "",
    payload: null,
    dryRun: false,
    skipSignatureVerification: true,
    updateExisting: true,
    usePrDiffFallback: true,
    deliveryId: row.deliveryId,
    scanRunStore: store,
    ...overrides,
  };
  const run: ScanRunState = {
    id: row.id,
    outcome: null,
    spend: { usd: 0 },
    preScanWriteFailed: false,
    spendUnrecorded: false,
    finished: false,
    cancel: { cancelled: false },
  };
  return runAccepted(options, run, store, {
    dryRun: options.dryRun === true,
    signatureState: "skipped",
    owner,
    repo,
    pullNumber: row.pullNumber,
    headSha: row.headSha,
    action: undefined,
    installationId,
  });
}

/**
 * The did-not-scan notice for a row given up on (scan-run-sweeper.ts):
 * the process died mid-scan and the retry did not finish either. Posted
 * with the installation token like every App comment.
 */
export async function postInterruptedNotice(
  row: UnfinishedScanRun,
  overrides: Partial<Pick<HandlePullRequestWebhookOptions, "token" | "apiBaseUrl" | "dryRun">> = {},
): Promise<PostPrCommentResult> {
  const slash = row.repoFullName.indexOf("/");
  const owner = row.repoFullName.slice(0, slash);
  const repo = row.repoFullName.slice(slash + 1);
  const installationId = Number.parseInt(row.installationId, 10);
  let token = overrides.token?.trim() ?? "";
  let ownAppId: string | undefined;
  if (!token) {
    token = await getInstallationToken(installationId);
    ownAppId = readAppId();
  }
  const metadata: ScanMetadata = { repoName: row.repoFullName, commitId: row.headSha };
  const workflow: WorkflowResult = {
    ...notRunWorkflow(metadata),
    status: "scan_interrupted",
    automationDecisionReason:
      "Scan not completed: it was interrupted and its retry did not finish",
    errors: [
      {
        message:
          "Scan not completed: the scan was interrupted and its retry did not finish, so no result was produced",
      },
    ],
  };
  return postFixorPullRequestComment({
    metadata: { owner, repo, pullNumber: row.pullNumber, commitSha: row.headSha },
    workflow,
    dryRun: overrides.dryRun === true,
    token,
    ownAppId,
    apiBaseUrl: overrides.apiBaseUrl,
    updateExisting: true,
    executionKey: buildFixorExecutionKey(owner, repo, row.pullNumber, row.headSha, installationId),
  });
}

/** Whole-file fetches or parent-layout guards that failed (H2, F-001). */
function scanInputDegraded(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { scanInputErrors?: unknown; routeGuardErrors?: unknown };
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return count(p.scanInputErrors) + count(p.routeGuardErrors) > 0;
}

/** What one delivery's row accumulates while the handler runs. */
type ScanRunState = {
  id: string | null;
  outcome: ScanRunOutcome | null;
  spend: ScanSpend;
  /** The row insert or the `running` update failed: the scan is refused. */
  preScanWriteFailed: boolean;
  /** A ledger write failed mid-scan, so later model calls were refused. */
  spendUnrecorded: boolean;
  /** The final state was written (or attempted) once; never again. */
  finished: boolean;
  /** Set by the deadline; callClaude refuses this scan's later model calls. */
  cancel: ScanCancel;
};

/**
 * The row outcome for a workflow that ran. A scan stopped by the spend
 * guard is `incomplete` with its own code, so the dashboard says why; its
 * `cost_usd` still counts the unrecorded calls (the accumulator is written
 * before the ledger).
 */
function scannedOutcome(
  run: ScanRunState,
  workflow: WorkflowResult,
  inputDegraded: boolean,
): ScanRunOutcome {
  const outcome = outcomeFromWorkflow(workflow, run.spend.usd, inputDegraded);
  if (run.spendUnrecorded && outcome.status !== "skipped") {
    return { ...outcome, status: "incomplete", code: "spend_unrecorded" };
  }
  return outcome;
}

/** A workflow result for a scan that did not run. */
function notRunWorkflow(metadata: ScanMetadata): Omit<
  WorkflowResult,
  "status" | "automationDecisionReason" | "errors"
> {
  const now = new Date().toISOString();
  return {
    automationReady: false,
    totalFindings: 0,
    sqlInjectionFindings: 0,
    classifiedFindings: 0,
    skippedFindings: 0,
    fixesGenerated: 0,
    highQualityPatches: 0,
    mediumQualityPatches: 0,
    lowQualityPatches: 0,
    fixes: [],
    metadata: metadata ?? {},
    timing: { startedAt: now, finishedAt: now, durationMs: 0 },
  };
}

type DeliveryContext = {
  dryRun: boolean;
  signatureState: WebhookSignatureState;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  action: string | undefined;
  installationId: number | null;
};

function reportScanRunFailure(
  step: "create" | "running" | "finish",
  err: unknown,
  where: Record<string, unknown>,
): void {
  logger.error(
    { phase: "scan_run_record", step, err, ...where },
    "scan_runs write failed: this delivery is missing from scan history",
  );
  Sentry.captureException(err, {
    tags: { "fixor.phase": "scan_run_record", "fixor.scan_run_step": step },
    extra: where,
  });
}

async function scanDelivery(
  options: HandlePullRequestWebhookOptions,
  run: ScanRunState,
  store: ScanRunStore,
  ctx: DeliveryContext,
): Promise<HandlePullRequestWebhookResult> {
  const { dryRun, signatureState, owner, repo, pullNumber, headSha, action, installationId } = ctx;

  let token = options.token?.trim() ?? "";
  // Set only when the handler mints the installation token itself: the
  // comment it may then edit is one this App created (github-client.ts).
  let ownAppId: string | undefined;
  if (!token && installationId !== null) {
    token = await getInstallationToken(installationId);
    ownAppId = readAppId();
  }
  if (!token) {
    token = process.env.GITHUB_TOKEN?.trim() ?? "";
  }

  const metadata: ScanMetadata = {
    ...options.workflowMetadata,
    repoName: `${owner}/${repo}`,
    commitId: headSha,
  };

  // The budget gate runs BEFORE the pull request is fetched: a capped or
  // unverifiable installation costs no diff fetch and no whole-file
  // fetches, only the notice. (An installation at a $0 cap used to fetch
  // every changed file first.)
  const budgetGate = options.checkBudgetImpl ?? checkBudget;
  let budget: BudgetCheck | null = null;
  if (installationId !== null) {
    budget = await budgetGate(installationId);
  }
  const refused = budget !== null && !budget.withinBudget;

  let semgrepPayload: unknown = null;
  if (!refused) {
    try {
      if (options.resolveSemgrep) {
        semgrepPayload = await Promise.resolve(
          options.resolveSemgrep({
            owner,
            repo,
            pullNumber,
            headSha,
            action,
          })
        );
        if (
          (semgrepPayload === null || semgrepPayload === undefined) &&
          options.usePrDiffFallback === true &&
          token
        ) {
          const diffFindings = await analyzePrDiff(owner, repo, pullNumber, token);
          if (diffFindings.length > 0) {
            semgrepPayload = {
              results: [],
              findings: diffFindings,
              _source: "pr-diff",
            };
          }
        }
      } else {
        if (!token) {
          run.outcome = emptyOutcome("failed", "internal_error");
          return {
            ok: false,
            dryRun,
            signatureState,
            error:
              "GITHUB_TOKEN (or token option) is required when resolveSemgrep is not provided",
          };
        }
        semgrepPayload = await fetchPrDiff(
          owner,
          repo,
          pullNumber,
          token,
          options.apiBaseUrl
        );
      }

      // H2: upgrade a raw PR diff to whole-file scan input — the
      // condition every detector baseline was measured under. Fetches
      // each changed file at the PR head; fetch failures fall back to
      // the diff slice AND surface as degraded scan input through the
      // workflow's error machinery. Applies to the fetched-diff path and
      // to resolver-supplied raw diff strings (deterministic demos via
      // fetchFileAtRefImpl).
      const enrichEligible =
        (!options.resolveSemgrep || options.fetchFileAtRefImpl !== undefined) &&
        typeof semgrepPayload === "string" &&
        semgrepPayload.includes("diff --git");
      if (enrichEligible) {
        const fetchImpl =
          options.fetchFileAtRefImpl ??
          ((p: string) =>
            fetchFileAtRef(owner, repo, p, headSha, token, options.apiBaseUrl));
        const scanInput = await buildWholeFileScanInput(
          semgrepPayload as string,
          fetchImpl,
        );
        // F-001: resolve parent-layout route guards on the webhook path so
        // Engine B clears layout-gated Remix/RR-v7 routes exactly as Engine A
        // (cli/scan.ts) does. Additive — only /routes/ files with a PROVEN
        // blocking ancestor layout get a sidecar; a non-404 layout fetch
        // failure surfaces as a routeGuardError (fail-loud), never silently.
        // Guard errors ride their OWN channel (not scanInputErrors) so H2's
        // whole-file failure message stays byte-identical.
        const guards = await resolveRouteGuardSidecars(
          Object.keys(scanInput.changedLinesByPath),
          fetchImpl,
        );
        semgrepPayload = {
          ...scanInput,
          sidecarsByPath: guards.sidecarsByPath,
          routeGuardErrors: guards.routeGuardErrors,
        };
      }
    } catch (e) {
      if (e instanceof GitHubApiError) {
        reportGitHubFailure("pr_fetch", e, { owner, repo, pullNumber, headSha, installationId });
        run.outcome = emptyOutcome("failed", "pr_fetch_refused");
        return {
          ok: false,
          dryRun,
          signatureState,
          error: e.message,
          githubError: e.details,
        };
      }
      throw e;
    }
  } // end of the fetch, skipped for a refused budget

  let workflow: WorkflowResult;
  if (installationId === null) {
    // Reachable only with `allowUnpricedScan` (acceptPullRequestDelivery
    // refuses it otherwise): demos and keyless tests. NOT guarded by the
    // budget or the spend guard: nothing here can be priced.
    workflow = await runAuditorWorkflow(semgrepPayload, metadata);
  } else {
    if (budget !== null && !budget.withinBudget) {
      const notRun = notRunWorkflow(metadata);
      if (
        budget.reason === "monthly_exceeded" ||
        budget.reason === "daily_exceeded"
      ) {
        workflow = {
          ...notRun,
          status: "budget_exceeded",
          automationDecisionReason:
            budget.reason === "monthly_exceeded"
              ? "Monthly Anthropic budget reached for this installation"
              : "Daily Anthropic budget reached for this installation",
          errors: [],
          budget: {
            reason: budget.reason,
            monthlySpend: budget.monthlySpend,
            dailySpend: budget.dailySpend,
            monthlyCapUsd: budget.caps.monthlyCapUsd,
            dailyCapUsd: budget.caps.dailyCapUsd,
          },
        };
      } else {
        // budget_unverifiable, or any refusal reason not handled above:
        // the scan is refused, never run unpriced. The PR comment says the
        // commit was not scanned — it must never render as a clean report.
        workflow = {
          ...notRun,
          status: "budget_unverifiable",
          automationDecisionReason:
            "Scan skipped: this installation's usage budget could not be verified",
          errors: [
            {
              message:
                "Scan skipped: the usage budget could not be verified, so no code was analyzed",
            },
          ],
        };
      }
    } else {
      if (run.id !== null && !run.preScanWriteFailed) {
        try {
          await store.markRunning(run.id);
        } catch (err) {
          reportScanRunFailure("running", err, { installationId, owner, repo, pullNumber, headSha });
          run.preScanWriteFailed = true;
        }
      }
      if (run.preScanWriteFailed) {
        // The last database write before the first model call failed, so the
        // ledger writes would likely fail too. Refused, never run unrecorded.
        logger.error(
          { installationId, owner, repo, pullNumber, headSha },
          "scan refused: a database write failed before the scan, so its spend could not be recorded",
        );
        workflow = {
          ...notRunWorkflow(metadata),
          status: "spend_unrecordable",
          automationDecisionReason:
            "Scan skipped: this scan's usage could not be recorded",
          errors: [
            {
              message:
                "Scan skipped: the scan's usage could not be recorded, so no code was analyzed",
            },
          ],
        };
      } else {
        const scanCtx: CostContextStore = {
          installationId,
          ...(run.id !== null ? { scanRunId: run.id } : {}),
          scanSpend: run.spend,
          cancel: run.cancel,
        };
        workflow = await costContext.run(scanCtx, async () =>
          runAuditorWorkflow(semgrepPayload, metadata),
        );
        if (scanCtx.ledgerWriteFailed) {
          run.spendUnrecorded = true;
          logger.error(
            { installationId, owner, repo, pullNumber, headSha, scanSpendUsd: run.spend.usd },
            "scan stopped early: a ledger write failed, so later model calls were refused",
          );
        }

        // Re-read post-scan budget so the comment + email use the
        // numbers AFTER this scan's costs landed. checkBudget caches
        // nothing; the second call adds one DB round-trip per scan.
        try {
          const postBudget = await budgetGate(installationId);
          const warning = computeBudgetWarning(
            postBudget.monthlySpend,
            postBudget.caps.monthlyCapUsd,
          );
          if (warning) {
            workflow.budgetWarning = warning;
          }
        } catch (e) {
          logger.warn(
            { installationId, err: e },
            "post-scan budget re-read failed; budgetWarning skipped",
          );
        }
      }
    }
  }

  let pdfUrl: string | null = null;
  let sarifUrl: string | null = null;
  if (workflow.fixes.length > 0) {
    const publicId = buildReportPublicId(owner, repo, pullNumber, headSha);

    try {
      const pdfBuffer = await generatePdfReport(workflow, {
        owner,
        repo,
        pullNumber,
        commitSha: headSha,
      });
      const pdfReport = await uploadPdfBuffer(pdfBuffer, publicId);
      pdfUrl = buildSignedReportUrl(pdfReport);
      logger.info(
        { publicId: pdfReport.publicId },
        "PDF report uploaded (signed URL minted)",
      );
    } catch (pdfError) {
      Sentry.captureException(pdfError, {
        tags: { "fixor.phase": "pdf_upload" },
        extra: { owner, repo, pullNumber, headSha },
      });
      logger.warn({ err: pdfError }, "PDF generation/upload failed");
    }

    try {
      const sarif = buildSarifLog(workflow, {
        repoSlug: `${owner}/${repo}`,
        commitSha: headSha,
      });
      const sarifReport = await uploadSarifText(sarifToJson(sarif), publicId);
      sarifUrl = buildSignedReportUrl(sarifReport, { attachment: true });
      logger.info(
        { publicId: sarifReport.publicId },
        "SARIF log uploaded (signed URL minted)",
      );
    } catch (sarifError) {
      Sentry.captureException(sarifError, {
        tags: { "fixor.phase": "sarif_upload" },
        extra: { owner, repo, pullNumber, headSha },
      });
      logger.warn({ err: sarifError }, "SARIF generation/upload failed");
    }
  }
  workflow.pdfUrl = pdfUrl;
  workflow.sarifUrl = sarifUrl;
  const inputDegraded = scanInputDegraded(semgrepPayload);

  const executionKey =
    options.executionKey?.trim() ??
    buildFixorExecutionKey(owner, repo, pullNumber, headSha, installationId);

  try {
    const comment = await postFixorPullRequestComment({
      metadata: {
        owner,
        repo,
        pullNumber,
        commitSha: headSha,
        scanId: options.workflowMetadata?.scanId,
      },
      workflow,
      dryRun,
      // The token resolved above: the installation token for every App
      // delivery. Never options.token, which production leaves unset and
      // which sent the poster to its GITHUB_TOKEN fallback.
      token,
      ownAppId,
      apiBaseUrl: options.apiBaseUrl,
      updateExisting: options.updateExisting,
      maxDetailedFixes: options.maxDetailedFixes,
      executionKey,
      pilotPersistence: options.pilotPersistence,
      pilotStorePath: options.pilotStorePath,
      forceRepost: options.forceRepost,
      maxCommentUtf8Bytes: options.maxCommentUtf8Bytes,
    });

    // Best-effort first-scan email (5E-4). Idempotent at the SQL
    // layer; does not throw. Skipped on dry runs, when no
    // installation is associated (PAT-only paths), and when the scan
    // was refused because its budget could not be verified or its spend
    // could not be recorded — nothing was scanned, so there is no first
    // scan to announce.
    if (
      !dryRun &&
      installationId &&
      workflow.status !== "budget_unverifiable" &&
      workflow.status !== "spend_unrecordable"
    ) {
      const prUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
      maybeSendFirstScanEmail({
        installationId: String(installationId),
        prUrl,
        repoFullName: `${owner}/${repo}`,
        pullNumber,
      }).catch((err) => {
        logger.warn(
          { installationId, owner, repo, pullNumber, err },
          "maybeSendFirstScanEmail unhandled rejection",
        );
      });
    }

    // Best-effort 80%-of-budget nudge email (5E-5). Same
    // fire-and-forget shape; idempotent across the calendar month
    // at the SQL layer.
    if (!dryRun && installationId && workflow.budgetWarning) {
      triggerLimitWarningEmailIfNeeded({
        installationId: String(installationId),
        warning: workflow.budgetWarning,
        repoFullName: `${owner}/${repo}`,
        pullNumber,
      }).catch((err) => {
        logger.warn(
          { installationId, owner, repo, pullNumber, err },
          "triggerLimitWarningEmailIfNeeded unhandled rejection",
        );
      });
    }

    run.outcome = scannedOutcome(run, workflow, inputDegraded);
    return {
      ok: true,
      dryRun,
      signatureState,
      data: { owner, repo, pullNumber, headSha },
      workflow,
      comment,
    };
  } catch (e) {
    if (e instanceof GitHubApiError) {
      reportGitHubFailure("comment_post", e, { owner, repo, pullNumber, headSha, installationId });
      const scanned = scannedOutcome(run, workflow, inputDegraded);
      // A skipped delivery stays skipped: nothing was scanned either way.
      run.outcome =
        scanned.status === "skipped"
          ? scanned
          : { ...scanned, status: "failed", code: "comment_refused" };
      return {
        ok: false,
        dryRun,
        signatureState,
        error: e.message,
        githubError: e.details,
      };
    }
    throw e;
  }
}
