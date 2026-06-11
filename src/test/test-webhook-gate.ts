/**
 * Webhook authentication-gate regression test (deterministic, no LLM, no DB).
 *
 * Guards the invariant added after the 2026-06-11 audit P1: EVERY event type
 * on POST /webhook is HMAC-verified BEFORE any handler logic or DB side
 * effect. The original defect: `installation` / `installation_repositories`
 * events triggered provisionOrgForInstallation (real DB writes) with no
 * signature check; only the pull_request path was verified.
 *
 * Drives routeGitHubWebhook directly with spy deps, so "no DB write" is
 * asserted as "the provisioning dependency was never invoked".
 *
 * Run via: npm run test:webhook-gate
 */

import { createHmac } from "node:crypto";

import { routeGitHubWebhook } from "../server/github-webhook-route";
import type { WebhookRouteDeps } from "../server/github-webhook-route";

const SECRET = "test-webhook-secret";

function sign(rawBody: Buffer, secret: string = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

interface SpyDeps extends WebhookRouteDeps {
  provisionCalls: Array<{ installationId: string; sourceEvent: string }>;
  prCalls: number;
}

function makeSpyDeps(): SpyDeps {
  const deps: SpyDeps = {
    provisionCalls: [],
    prCalls: 0,
    provisionOrg: async (installationId, sourceEvent) => {
      deps.provisionCalls.push({ installationId, sourceEvent });
      return { orgId: "org-test", created: true };
    },
    handlePullRequest: async () => {
      deps.prCalls++;
      return { ok: false, error: "stub handler reached" };
    },
  };
  return deps;
}

const INSTALLATION_CREATED = Buffer.from(
  JSON.stringify({ action: "created", installation: { id: 12345 } }),
);
const INSTALLATION_DELETED = Buffer.from(
  JSON.stringify({ action: "deleted", installation: { id: 12345 } }),
);
const PR_PAYLOAD = Buffer.from(
  JSON.stringify({ action: "opened", number: 1 }),
);
const PING_PAYLOAD = Buffer.from(JSON.stringify({ zen: "Keep it simple." }));

async function main(): Promise<void> {
  let failures = 0;
  const check = (cond: boolean, label: string): void => {
    process.stdout.write(`    ${cond ? "PASS" : "FAIL"}  ${label}\n`);
    if (!cond) failures++;
  };

  // (a) Forged installation events are rejected with no DB write.
  {
    const deps = makeSpyDeps();
    const noSig = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: undefined,
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      noSig.status === 401 && deps.provisionCalls.length === 0,
      "installation created, MISSING signature -> 401, provisionOrg never called",
    );

    const badSig = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: sign(INSTALLATION_CREATED, "wrong-secret"),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      badSig.status === 401 && deps.provisionCalls.length === 0,
      "installation created, INVALID signature -> 401, provisionOrg never called",
    );

    const garbage = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: "sha256=not-hex-at-all",
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      garbage.status === 401 && deps.provisionCalls.length === 0,
      "installation created, MALFORMED signature -> 401, provisionOrg never called",
    );
  }

  // Forged pull_request and unknown events are rejected before any handler.
  {
    const deps = makeSpyDeps();
    const pr = await routeGitHubWebhook({
      rawBody: PR_PAYLOAD,
      eventHeader: "pull_request",
      signatureHeader: sign(PR_PAYLOAD, "wrong-secret"),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      pr.status === 401 && deps.prCalls === 0,
      "pull_request, INVALID signature -> 401, PR handler never called",
    );

    const ping = await routeGitHubWebhook({
      rawBody: PING_PAYLOAD,
      eventHeader: "ping",
      signatureHeader: undefined,
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      ping.status === 401,
      "unknown event (ping), MISSING signature -> 401 (gate covers ALL event types)",
    );
  }

  // Signature is checked BEFORE JSON parsing: unsigned junk gets 401 (not
  // 400), signed junk gets 400.
  {
    const junk = Buffer.from("{not json");
    const deps = makeSpyDeps();
    const unsignedJunk = await routeGitHubWebhook({
      rawBody: junk,
      eventHeader: "installation",
      signatureHeader: undefined,
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      unsignedJunk.status === 401,
      "malformed JSON, missing signature -> 401 (signature checked before parse)",
    );

    const signedJunk = await routeGitHubWebhook({
      rawBody: junk,
      eventHeader: "installation",
      signatureHeader: sign(junk),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      signedJunk.status === 400 && deps.provisionCalls.length === 0,
      "malformed JSON, VALID signature -> 400 invalid JSON",
    );
  }

  // (b) Correctly-signed events of each handled type still pass through.
  {
    const deps = makeSpyDeps();
    const created = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: sign(INSTALLATION_CREATED),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    const createdBody = created.body as {
      status?: string;
      orgId?: string;
    };
    check(
      created.status === 200 &&
        createdBody.status === "installation_acknowledged" &&
        createdBody.orgId === "org-test" &&
        deps.provisionCalls.length === 1 &&
        deps.provisionCalls[0]!.installationId === "12345" &&
        deps.provisionCalls[0]!.sourceEvent === "installation",
      "installation created, VALID signature -> 200, provisionOrg called once with id 12345",
    );

    const deleted = await routeGitHubWebhook({
      rawBody: INSTALLATION_DELETED,
      eventHeader: "installation",
      signatureHeader: sign(INSTALLATION_DELETED),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      deleted.status === 200 &&
        (deleted.body as { status?: string }).status ===
          "installation_acknowledged" &&
        deps.provisionCalls.length === 1,
      "installation deleted, VALID signature -> 200 acknowledged, no provisioning",
    );

    const pr = await routeGitHubWebhook({
      rawBody: PR_PAYLOAD,
      eventHeader: "pull_request",
      signatureHeader: sign(PR_PAYLOAD),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      pr.status === 200 && deps.prCalls === 1,
      "pull_request, VALID signature -> 200, PR handler called",
    );

    const ping = await routeGitHubWebhook({
      rawBody: PING_PAYLOAD,
      eventHeader: "ping",
      signatureHeader: sign(PING_PAYLOAD),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      ping.status === 200 &&
        (ping.body as { status?: string }).status === "ignored",
      "unknown event (ping), VALID signature -> 200 ignored",
    );
  }

  // Provisioning failure still maps to 503 (GitHub retries) — behavior
  // preserved from the pre-extraction handler.
  {
    const deps = makeSpyDeps();
    deps.provisionOrg = async () => {
      throw new Error("db down");
    };
    const r = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: sign(INSTALLATION_CREATED),
      webhookSecret: SECRET,
      skipSignatureVerification: false,
      deps,
    });
    check(
      r.status === 503,
      "installation created, VALID signature, provisioning throws -> 503 (GitHub retry)",
    );
  }

  // Dev-mode escape hatch (ALLOW_UNSIGNED_WEBHOOKS outside production)
  // still works: unsigned events pass when skipSignatureVerification=true.
  {
    const deps = makeSpyDeps();
    const r = await routeGitHubWebhook({
      rawBody: INSTALLATION_CREATED,
      eventHeader: "installation",
      signatureHeader: undefined,
      webhookSecret: "",
      skipSignatureVerification: true,
      deps,
    });
    check(
      r.status === 200 && deps.provisionCalls.length === 1,
      "dev mode (skipSignatureVerification), missing signature -> passes through",
    );
  }

  process.stdout.write(
    `\n[webhook-gate] ${failures === 0 ? "PASS" : `FAIL (${failures})`}\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`[webhook-gate] ERROR: ${(err as Error).message}\n`);
  process.exit(1);
});
