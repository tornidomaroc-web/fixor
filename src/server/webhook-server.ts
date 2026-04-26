/**
 * Minimal GitHub PR webhook server (Node http only).
 *
 * NOTE: `import "../instrument"` MUST stay first — Sentry's auto-
 * instrumentation hooks Node's http module at init time, so any module
 * imported before it would skip the instrumentation.
 */
import "../instrument";
import * as Sentry from "@sentry/node";
import * as http from "http";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";
import { logger } from "../lib/logger";
import { pingDb, runHealthChecks } from "../lib/health";
import { provisionOrgForInstallation } from "../services/orgs.service";
import {
  getInstallationIdForOrg,
  markTokenUsed,
  verifyApiToken,
} from "../services/api-tokens.service";
import { FixedWindowRateLimiter } from "../lib/rate-limiter";
import { runAuditorWorkflow } from "../workflows/auditor-workflow";
import { costContext } from "../lib/cost-context";
import { checkBudget } from "../services/cost-store";

// Per-token bucket. 60 requests / 60s default — plenty for a CI loop,
// blocks runaway scripts. Override with FIXOR_API_RATE_LIMIT_PER_MIN.
const apiRateLimit = new FixedWindowRateLimiter(
  Number.parseInt(process.env.FIXOR_API_RATE_LIMIT_PER_MIN ?? "60", 10) || 60,
  60_000,
);

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    logger.error({ name }, "missing required environment variable");
    process.exit(1);
  }
  return v;
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handleApiScan(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  // 1. Bearer auth
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    jsonResponse(res, 401, { error: "missing bearer token" });
    return;
  }
  const plainToken = authHeader.slice("Bearer ".length).trim();

  let verified;
  try {
    verified = await verifyApiToken(plainToken);
  } catch (err) {
    Sentry.captureException(err, { tags: { "fixor.phase": "api_token_verify" } });
    logger.error({ err }, "api token verify failed");
    jsonResponse(res, 503, { error: "auth backend unavailable" });
    return;
  }
  if (!verified) {
    jsonResponse(res, 401, { error: "invalid or revoked token" });
    return;
  }

  // 2. Rate limit per token
  if (!apiRateLimit.allow(verified.tokenId)) {
    const retryAfter = apiRateLimit.retryAfterSeconds(verified.tokenId);
    res.setHeader("Retry-After", String(retryAfter));
    jsonResponse(res, 429, {
      error: "rate_limit_exceeded",
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  // 3. Body
  let body: unknown;
  try {
    const raw = await readRawBody(req);
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    jsonResponse(res, 400, { error: "invalid JSON body" });
    return;
  }
  const diff = (body as { diff?: unknown } | null)?.diff;
  if (typeof diff !== "string" || !diff.trim()) {
    jsonResponse(res, 400, { error: "diff is required (string)" });
    return;
  }

  // 4. Budget gate (mirrors pr-webhook-handler)
  const installationId = await getInstallationIdForOrg(verified.orgId);
  if (installationId) {
    const budget = await checkBudget(installationId);
    if (!budget.withinBudget && budget.reason !== "exempt") {
      jsonResponse(res, 402, {
        error: "monthly_budget_exceeded",
        reason: budget.reason,
        monthlySpend: budget.monthlySpend,
        dailySpend: budget.dailySpend,
        caps: budget.caps,
      });
      return;
    }
  }

  // 5. Run workflow
  const metadata = {
    repoName: `api/v1/scan/${verified.orgId}`,
    scanId: verified.tokenId,
  };
  const workflow = installationId
    ? await costContext.run({ installationId }, () =>
        runAuditorWorkflow(diff, metadata),
      )
    : await runAuditorWorkflow(diff, metadata);

  // 6. Best-effort bookkeeping — update last_used_at without blocking
  //    the response. A failed update only loses a timestamp.
  void markTokenUsed(verified.tokenId).catch((err) => {
    logger.warn({ tokenId: verified.tokenId, err }, "markTokenUsed failed");
  });

  jsonResponse(res, 200, {
    status: workflow.status,
    automationReady: workflow.automationReady,
    totalFindings: workflow.totalFindings,
    classifiedFindings: workflow.classifiedFindings,
    skippedFindings: workflow.skippedFindings,
    fixesGenerated: workflow.fixesGenerated,
    fixes: workflow.fixes,
    errors: workflow.errors,
    timing: workflow.timing,
  });
}

function summarizeWebhookResult(
  result: Awaited<ReturnType<typeof handlePullRequestWebhook>>
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      dryRun: result.dryRun,
      signatureState: result.signatureState,
      error: result.error,
      missingFields: result.missingFields,
    };
  }
  return {
    ok: true,
    dryRun: result.dryRun,
    signatureState: result.signatureState,
    data: result.data,
    workflow: {
      status: result.workflow.status,
      sqlInjectionFindings: result.workflow.sqlInjectionFindings,
      fixesGenerated: result.workflow.fixesGenerated,
      riskExplanationsCount: result.workflow.exploits
        ? Object.keys(result.workflow.exploits).length
        : 0,
    },
    comment: {
      commentAction: result.comment.commentAction,
      commentPosted: result.comment.commentPosted,
      commentId: result.comment.commentId,
      dryRun: result.comment.dryRun,
    },
  };
}

async function main(): Promise<void> {
  const hasAppAuth = !!(process.env.GITHUB_APP_ID?.trim() && process.env.GITHUB_APP_PRIVATE_KEY?.trim());
  const hasPatAuth = !!process.env.GITHUB_TOKEN?.trim();
  if (!hasAppAuth && !hasPatAuth) {
    logger.error(
      "missing auth: set either GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, or GITHUB_TOKEN",
    );
    process.exit(1);
  }
  requireEnv("ANTHROPIC_API_KEY");

  const portRaw = process.env.PORT?.trim() || "3000";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    logger.error({ portRaw }, "invalid PORT");
    process.exit(1);
  }

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  const allowUnsigned = process.env.ALLOW_UNSIGNED_WEBHOOKS?.trim() === "true";
  const nodeEnv = process.env.NODE_ENV?.trim() ?? "production";
  const skipSignatureVerification = !webhookSecret;

  if (skipSignatureVerification) {
    if (nodeEnv === "production" || !allowUnsigned) {
      logger.error(
        "refusing to start: GITHUB_WEBHOOK_SECRET is required. for local dev set ALLOW_UNSIGNED_WEBHOOKS=true and NODE_ENV!=production",
      );
      process.exit(1);
    }
    logger.warn(
      "starting with signature verification DISABLED (ALLOW_UNSIGNED_WEBHOOKS=true). dev only",
    );
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const path =
        req.url !== undefined ? new URL(req.url, `http://${host}`).pathname : "";

      if (req.method === "GET" && path === "/health") {
        const report = await runHealthChecks();
        jsonResponse(res, report.status === "ok" ? 200 : 503, report);
        return;
      }

      if (req.method === "GET" && path === "/ready") {
        const dbStatus = await pingDb();
        const ready = dbStatus === "ok";
        jsonResponse(res, ready ? 200 : 503, { ready, db: dbStatus });
        return;
      }

      if (req.method === "POST" && path === "/api/v1/scan") {
        await handleApiScan(req, res);
        return;
      }

      if (req.method !== "POST" || path !== "/webhook") {
        res.writeHead(404);
        res.end();
        return;
      }

      const rawBody = await readRawBody(req);
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const gitHubEvent = req.headers["x-github-event"];
      const eventStr =
        typeof gitHubEvent === "string"
          ? gitHubEvent
          : Array.isArray(gitHubEvent)
            ? gitHubEvent[0] ?? ""
            : "";

      if (eventStr === "installation" || eventStr === "installation_repositories") {
        const action = (payload as any)?.action;
        const instId = (payload as any)?.installation?.id;
        logger.info({ action, installationId: instId }, "installation event");

        if (
          eventStr === "installation" &&
          action === "created" &&
          instId !== undefined &&
          instId !== null
        ) {
          try {
            const result = await provisionOrgForInstallation(
              String(instId),
              eventStr,
            );
            jsonResponse(res, 200, {
              status: "installation_acknowledged",
              action,
              installationId: instId,
              orgId: result.orgId,
              orgCreated: result.created,
            });
            return;
          } catch (err) {
            // Provisioning failed (DB outage, transient FK violation,
            // etc). Return 5xx so GitHub retries the webhook — by 5B-2
            // this path is the ONLY way an org gets a row, so a lost
            // delivery would orphan the install.
            Sentry.captureException(err, {
              tags: { "fixor.phase": "org_provision" },
              extra: { installationId: String(instId) },
            });
            logger.error(
              { installationId: String(instId), err },
              "org provisioning failed",
            );
            jsonResponse(res, 503, {
              error: "org provisioning failed; will retry",
            });
            return;
          }
        }

        jsonResponse(res, 200, { status: "installation_acknowledged", action, installationId: instId });
        return;
      }
      if (eventStr !== "pull_request") {
        jsonResponse(res, 200, { status: "ignored" });
        return;
      }

      const sigHeaderRaw = req.headers["x-hub-signature-256"];
      const signatureHeader =
        typeof sigHeaderRaw === "string"
          ? sigHeaderRaw
          : Array.isArray(sigHeaderRaw)
            ? sigHeaderRaw[0]
            : undefined;

      const dryRun = process.env.DRY_RUN?.trim() === "true";

      const result = await handlePullRequestWebhook({
        rawBody,
        payload,
        signatureHeader: signatureHeader ?? null,
        webhookSecret: webhookSecret || undefined,
        skipSignatureVerification,
        dryRun,
        updateExisting: true,
        usePrDiffFallback: true,
      });

      jsonResponse(res, 200, summarizeWebhookResult(result));
    } catch (err) {
      Sentry.captureException(err);
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, "unhandled error in webhook request");
      jsonResponse(res, 500, { error: message });
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "Fixor webhook server listening");
  });

  const shutdown = (): void => {
    server.close(() => {
      // Flush any pending Sentry events before the process exits.
      void Sentry.close(2000).finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
