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
