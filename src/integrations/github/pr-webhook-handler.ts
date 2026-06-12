import { analyzePrDiff } from "../../services/pr-diff-analyzer";
import { getInstallationToken } from "./app-auth.service";
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
import { buildWholeFileScanInput } from "./whole-file-scan-input";
import { costContext } from "../../lib/cost-context";
import { checkBudget } from "../../services/cost-store";
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

  let token = options.token?.trim() ?? "";
  if (!token && installationId !== null) {
    token = await getInstallationToken(installationId);
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
      semgrepPayload = await buildWholeFileScanInput(
        semgrepPayload as string,
        fetchImpl,
      );
    }
  } catch (e) {
    if (e instanceof GitHubApiError) {
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
    const budget = await checkBudget(installationId);
    if (!budget.withinBudget && budget.reason !== "exempt") {
      const now = new Date().toISOString();
      workflow = {
        status: "budget_exceeded",
        automationReady: false,
        automationDecisionReason:
          budget.reason === "monthly_exceeded"
            ? "Monthly Anthropic budget reached for this installation"
            : "Daily Anthropic budget reached for this installation",
        totalFindings: 0,
        sqlInjectionFindings: 0,
        classifiedFindings: 0,
        skippedFindings: 0,
        fixesGenerated: 0,
        highQualityPatches: 0,
        mediumQualityPatches: 0,
        lowQualityPatches: 0,
        fixes: [],
        errors: [],
        metadata: metadata ?? {},
        budget: {
          reason: budget.reason as "monthly_exceeded" | "daily_exceeded",
          monthlySpend: budget.monthlySpend,
          dailySpend: budget.dailySpend,
          monthlyCapUsd: budget.caps.monthlyCapUsd,
          dailyCapUsd: budget.caps.dailyCapUsd,
        },
        timing: { startedAt: now, finishedAt: now, durationMs: 0 },
      };
    } else {
      workflow = await costContext.run({ installationId }, async () =>
        runAuditorWorkflow(semgrepPayload, metadata)
      );

      // Re-read post-scan budget so the comment + email use the
      // numbers AFTER this scan's costs landed. checkBudget caches
      // nothing; the second call adds one DB round-trip per scan.
      try {
        const postBudget = await checkBudget(installationId);
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
      token: options.token,
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
    // layer; does not throw. Skipped on dry runs and when no
    // installation is associated (PAT-only paths).
    if (!dryRun && installationId) {
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
