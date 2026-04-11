/**
 * Minimal GitHub PR webhook server (Node http only).
 */
import * as http from "http";
import { handlePullRequestWebhook } from "../integrations/github/pr-webhook-handler";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required environment variable: ${name}`);
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
      riskExplanationsCount: result.workflow.exploits?.length ?? 0,
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
  requireEnv("GITHUB_TOKEN");
  requireEnv("ANTHROPIC_API_KEY");

  const portRaw = process.env.PORT?.trim() || "3000";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error("Invalid PORT");
    process.exit(1);
  }

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  const skipSignatureVerification = !webhookSecret;

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const path =
        req.url !== undefined ? new URL(req.url, `http://${host}`).pathname : "";

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
        token: process.env.GITHUB_TOKEN!.trim(),
        updateExisting: true,
        usePrDiffFallback: true,
      });

      jsonResponse(res, 200, summarizeWebhookResult(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  });

  server.listen(port, () => {
    console.log(`Fixor webhook server listening on port ${port}`);
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
