/**
 * Routing core for POST /webhook, extracted from webhook-server.ts so the
 * authentication gate is testable without a live HTTP server or database
 * (see test/test-webhook-gate.ts).
 *
 * SECURITY INVARIANT: the X-Hub-Signature-256 HMAC is verified BEFORE the
 * body is parsed and BEFORE any event branch runs, so no handler logic or
 * DB side effect is reachable on an unauthenticated request. This closes
 * the defect where `installation` / `installation_repositories` events
 * triggered org provisioning (real DB writes) with no signature check —
 * only the pull_request path was verified.
 *
 * GitHub signs EVERY delivery (ping, installation, pull_request, ...) when
 * a webhook secret is configured, so there is no legitimate unsigned event
 * type to exempt. The only bypass is the explicit dev-mode flag
 * (ALLOW_UNSIGNED_WEBHOOKS=true outside production), which webhook-server
 * enforces at startup.
 *
 * SCAN TRIGGER: only pull_request deliveries that carry code the last scan
 * has not seen reach the handler (pr-action-filter.ts). The rest are
 * acknowledged with 200 "ignored" and a reason, after the signature check
 * and before any token, diff fetch, budget read or scan, and leave nothing
 * on the pull request.
 */
import * as Sentry from "@sentry/node";

import { logger } from "../lib/logger";
import { decidePullRequestScan } from "../integrations/github/pr-action-filter";
import { verifyGitHubWebhookSignature256 } from "../integrations/github/webhook-signature";

export interface WebhookRouteResponse {
  status: number;
  body: unknown;
}

export interface WebhookRouteDeps {
  /** Production impl: provisionOrgForInstallation (orgs.service). */
  provisionOrg: (
    installationId: string,
    sourceEvent: string,
  ) => Promise<{ orgId: string; created: boolean }>;
  /**
   * Production impl: handlePullRequestWebhook + summarizeWebhookResult.
   * The handler re-verifies the signature internally with the same
   * constant-time comparison — redundant after this gate, kept as
   * defense in depth and for callers that invoke it directly.
   */
  handlePullRequest: (args: {
    rawBody: Buffer;
    payload: unknown;
    signatureHeader: string | null;
  }) => Promise<unknown>;
}

export interface WebhookRouteOptions {
  rawBody: Buffer;
  eventHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
  webhookSecret: string;
  /** Dev-only escape hatch; webhook-server refuses it in production. */
  skipSignatureVerification: boolean;
  deps: WebhookRouteDeps;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

export async function routeGitHubWebhook(
  opts: WebhookRouteOptions,
): Promise<WebhookRouteResponse> {
  const signatureHeader = firstHeader(opts.signatureHeader) ?? null;

  // Gate every event type up front. A missing header is rejected the same
  // as a wrong one (verifyGitHubWebhookSignature256 returns false for
  // null/empty). The comparison itself is constant-time and length-checked
  // (webhook-signature.ts, unchanged).
  if (!opts.skipSignatureVerification) {
    const valid = verifyGitHubWebhookSignature256(
      opts.rawBody,
      signatureHeader,
      opts.webhookSecret,
    );
    if (!valid) {
      logger.warn(
        { hasSignatureHeader: signatureHeader !== null },
        "webhook rejected: missing or invalid signature",
      );
      return {
        status: 401,
        body: { error: "invalid or missing webhook signature" },
      };
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(opts.rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "Invalid JSON body" } };
  }

  const eventStr = firstHeader(opts.eventHeader) ?? "";

  if (
    eventStr === "installation" ||
    eventStr === "installation_repositories"
  ) {
    const action = (payload as { action?: unknown } | null)?.action;
    const instId = (
      payload as { installation?: { id?: unknown } } | null
    )?.installation?.id;
    logger.info({ action, installationId: instId }, "installation event");

    if (
      eventStr === "installation" &&
      action === "created" &&
      instId !== undefined &&
      instId !== null
    ) {
      try {
        const result = await opts.deps.provisionOrg(String(instId), eventStr);
        return {
          status: 200,
          body: {
            status: "installation_acknowledged",
            action,
            installationId: instId,
            orgId: result.orgId,
            orgCreated: result.created,
          },
        };
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
        return {
          status: 503,
          body: { error: "org provisioning failed; will retry" },
        };
      }
    }

    return {
      status: 200,
      body: {
        status: "installation_acknowledged",
        action,
        installationId: instId,
      },
    };
  }

  if (eventStr !== "pull_request") {
    return { status: 200, body: { status: "ignored" } };
  }

  const decision = decidePullRequestScan(payload);
  if (!decision.scan) {
    const pr = payload as {
      installation?: { id?: unknown };
      repository?: { full_name?: unknown };
      pull_request?: { number?: unknown };
    } | null;
    const fields = {
      action: decision.action,
      reason: decision.reason,
      installationId: pr?.installation?.id,
      repository: pr?.repository?.full_name,
      pullNumber: pr?.pull_request?.number,
    };
    // An action GitHub does not document (or a payload without one) is
    // refused like the rest, but surfaced: it may be new, and it may carry
    // code this filter does not yet know about.
    if (
      decision.reason === "action_unrecognized" ||
      decision.reason === "action_missing"
    ) {
      logger.warn(fields, "pull_request delivery not scanned: unrecognized action");
    } else {
      logger.info(fields, "pull_request delivery not scanned");
    }
    return {
      status: 200,
      body: {
        status: "ignored",
        reason: decision.reason,
        action: decision.action,
      },
    };
  }

  const result = await opts.deps.handlePullRequest({
    rawBody: opts.rawBody,
    payload,
    signatureHeader,
  });
  return { status: 200, body: result };
}
