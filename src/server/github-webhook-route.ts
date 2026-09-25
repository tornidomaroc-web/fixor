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
 *
 * ACKNOWLEDGE, THEN SCAN: with `deps.acceptPullRequest` the route answers
 * 202 once the delivery's scan_runs row exists and runs the scan after the
 * response (`deps.runInBackground`). GitHub's 10 s delivery limit is met
 * by a row write; the scan takes as long as it takes.
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
  handlePullRequest: (args: PullRequestArgs) => Promise<unknown>;
  /**
   * Acknowledge-then-scan. When present it is used instead of
   * `handlePullRequest`: the delivery is accepted (row written) and
   * answered, and `run` is handed to `runInBackground`. Production impl:
   * acceptPullRequestDelivery.
   */
  acceptPullRequest?: (args: PullRequestArgs) => Promise<AcceptedForRoute>;
  /** Runs the scan after the response. Production impl: the in-flight tracker. */
  runInBackground?: (label: string, task: () => Promise<unknown>) => void;
}

export interface PullRequestArgs {
  rawBody: Buffer;
  payload: unknown;
  signatureHeader: string | null;
  /** `X-GitHub-Delivery`, when present and well-formed; else null. */
  deliveryId: string | null;
}

/** The subset of AcceptPullRequestDeliveryResult the route reads. */
export type AcceptedForRoute =
  | {
      accepted: true;
      scanRunId: string | null;
      recorded: boolean;
      data: unknown;
      run: () => Promise<unknown>;
    }
  | { accepted: false; result: unknown };

export interface WebhookRouteOptions {
  rawBody: Buffer;
  eventHeader: string | string[] | undefined;
  signatureHeader: string | string[] | undefined;
  /** `X-GitHub-Delivery`. Not covered by the HMAC, so it is format-checked. */
  deliveryHeader?: string | string[] | undefined;
  webhookSecret: string;
  /** Dev-only escape hatch; webhook-server refuses it in production. */
  skipSignatureVerification: boolean;
  deps: WebhookRouteDeps;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
}

/**
 * GitHub sends a GUID. Anything else is dropped to null (no de-duplication
 * for that delivery) rather than stored: the header is outside the signed
 * body, so it is never trusted beyond its shape.
 */
export function parseDeliveryId(
  v: string | string[] | undefined,
): string | null {
  const raw = firstHeader(v)?.trim();
  return raw && /^[0-9a-fA-F-]{8,64}$/.test(raw) ? raw.toLowerCase() : null;
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

  const args: PullRequestArgs = {
    rawBody: opts.rawBody,
    payload,
    signatureHeader,
    deliveryId: parseDeliveryId(opts.deliveryHeader),
  };

  if (opts.deps.acceptPullRequest) {
    const accepted = await opts.deps.acceptPullRequest(args);
    if (!accepted.accepted) return answerFor(accepted.result);
    // Answered before the scan: GitHub's 10 s limit is met by the row
    // write alone. The scan, the comment and the row's final state follow
    // in the background; a process that dies first leaves the row for the
    // sweeper (scan-run-sweeper.ts).
    const runInBackground =
      opts.deps.runInBackground ??
      ((label, task) => {
        void task().catch((err: unknown) => {
          logger.error({ err, label }, "background scan failed");
        });
      });
    runInBackground(`scan ${accepted.scanRunId ?? "unrecorded"}`, accepted.run);
    // With no row, nothing durable says this delivery arrived: 503 puts it
    // in the App's failed deliveries, where the owner can redeliver it once
    // the database is back. The run still posts the not-scanned notice.
    return {
      status: accepted.recorded ? 202 : 503,
      body: {
        status: accepted.recorded ? "accepted" : "not_recorded",
        scanRunId: accepted.scanRunId,
        data: accepted.data,
      },
    };
  }

  return answerFor(await opts.deps.handlePullRequest(args));
}

/**
 * A handler failure (a GitHub call refused, a payload that did not
 * validate, a delivery that cannot be priced) must not read as success:
 * GitHub records a non-2xx as a failed delivery, visible in the App's
 * Recent Deliveries. GitHub never retries on its own, so nothing runs
 * twice because of this status. A delivery already recorded is not a
 * failure: it was received once and deliberately not scanned again.
 */
function answerFor(result: unknown): WebhookRouteResponse {
  const r = result as { ok?: unknown; duplicateDelivery?: unknown } | null;
  const failed = r?.ok === false && r.duplicateDelivery !== true;
  return { status: failed ? 502 : 200, body: result };
}
