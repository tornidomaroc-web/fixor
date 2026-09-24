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
import { costContext, type ScanSpend } from "../../lib/cost-context";
import { checkBudget, type BudgetCheck } from "../../services/cost-store";
import {
  drizzleScanRunStore,
  emptyOutcome,
  outcomeFromWorkflow,
  type ScanRunOutcome,
  type ScanRunStore,
} from "../../services/scan-run-store";
import { logger } from "../../lib/logger";
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
};

export type HandlePullRequestWebhookResult =
  | HandlePullRequestWebhookSuccess
  | HandlePullRequestWebhookFailure;

/**
 * Validates webhook payload (and optionally signature), resolves Semgrep JSON, runs Fixor workflow,
 * then builds and posts/updates the aggregated PR comment (or dry-run preview).
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
    async () => handlePullRequestWebhookImpl(options),
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

async function handlePullRequestWebhookImpl(
  options: HandlePullRequestWebhookOptions,
): Promise<HandlePullRequestWebhookResult> {
  const dryRun = options.dryRun === true;

  let signatureState: WebhookSignatureState = "skipped";
  if (!options.skipSignatureVerification) {
    const secret = options.webhookSecret?.trim();
    if (!secret) {
      return {
        ok: false,
        dryRun,
        signatureState: "invalid",
        error:
          "Webhook signature verification required but GITHUB_WEBHOOK_SECRET (or webhookSecret) is missing",
      };
    }
    const valid = verifyGitHubWebhookSignature256(
      options.rawBody,
      options.signatureHeader,
      secret
    );
    signatureState = valid ? "valid" : "invalid";
    if (!valid) {
      return {
        ok: false,
        dryRun,
        signatureState: "invalid",
        error: "Invalid or missing X-Hub-Signature-256",
      };
    }
  }

  const validated = validateGitHubPullRequestPayload(options.payload);
  if (!validated.ok) {
    return {
      ok: false,
      dryRun,
      signatureState,
      error: validated.error,
      missingFields: validated.missingFields,
    };
  }

  const { owner, repo, pullNumber, headSha, action } = validated.data;

  const payloadObj = options.payload as Record<string, unknown> | null;
  const installation = payloadObj && typeof payloadObj === "object"
    ? (payloadObj as any).installation
    : null;
  const installationId = installation && typeof installation.id === "number"
    ? installation.id
    : null;

  // One scan_runs row per delivery that names an installation, written
  // before any GitHub call or budget read so every outcome below has a
  // row to finish. A delivery with no installation cannot be scoped to an
  // org, so it gets none.
  const store = options.scanRunStore ?? drizzleScanRunStore();
  const run: ScanRunState = { id: null, outcome: null, spend: { usd: 0 } };
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
        return {
          ok: false,
          dryRun,
          signatureState,
          error: "Delivery already received; not scanned again",
          duplicateDelivery: true,
        };
      }
      run.id = created.id;
    } catch (err) {
      // History is observability: a failed insert must not cost the
      // customer their scan. PR2 decides whether it should refuse spend.
      reportScanRunFailure("create", err, { installationId, deliveryId, owner, repo, pullNumber, headSha });
    }
  }

  try {
    return await scanDelivery(options, run, store, {
      dryRun,
      signatureState,
      owner,
      repo,
      pullNumber,
      headSha,
      action,
      installationId,
    });
  } finally {
    // The ONLY place a row reaches its final state, exactly once. An
    // outcome left unset means the scan threw before it decided one.
    if (run.id !== null) {
      const outcome = run.outcome ?? emptyOutcome("failed", "internal_error");
      try {
        await store.finish(run.id, outcome, new Date());
      } catch (err) {
        reportScanRunFailure("finish", err, { installationId, owner, repo, pullNumber, headSha });
      }
    }
  }
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
};

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

  let semgrepPayload: unknown;
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

  const metadata: ScanMetadata = {
    ...options.workflowMetadata,
    repoName: `${owner}/${repo}`,
    commitId: headSha,
  };

  let workflow: WorkflowResult;
  if (installationId === null) {
    // Should not happen for properly authenticated GitHub App webhooks,
    // but degrade gracefully without recording cost.
    workflow = await runAuditorWorkflow(semgrepPayload, metadata);
  } else {
    const budgetGate = options.checkBudgetImpl ?? checkBudget;
    const budget = await budgetGate(installationId);
    if (!budget.withinBudget) {
      const now = new Date().toISOString();
      const notRun = {
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
      if (run.id !== null) {
        try {
          await store.markRunning(run.id);
        } catch (err) {
          reportScanRunFailure("running", err, { installationId, owner, repo, pullNumber, headSha });
        }
      }
      workflow = await costContext.run(
        {
          installationId,
          ...(run.id !== null ? { scanRunId: run.id } : {}),
          scanSpend: run.spend,
        },
        async () => runAuditorWorkflow(semgrepPayload, metadata),
      );

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
    // was refused because its budget could not be verified — nothing
    // was scanned, so there is no first scan to announce.
    if (
      !dryRun &&
      installationId &&
      workflow.status !== "budget_unverifiable"
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

    run.outcome = outcomeFromWorkflow(workflow, run.spend.usd, inputDegraded);
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
      const scanned = outcomeFromWorkflow(workflow, run.spend.usd, inputDegraded);
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
