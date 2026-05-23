// ASSUMED-PATH: app/routes/api.webhook.github.ts
// Phase E — Remix v2 webhook-unverified positive.
// GitHub webhook handler at `app/routes/api.webhook.github.ts` —
// reads x-github-event header AND request body, dispatches on event
// type, performs db.workflowRun.create — with NO signature
// verification at all. The handler reads a signature-like header
// (x-hub-signature-256) but never compares it against an HMAC of
// the body. Classic missing-verification shape.
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { db } from "~/lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const event = request.headers.get("x-github-event");
  const _signature = request.headers.get("x-hub-signature-256"); // read but never verified
  const payload = await request.json();

  if (event === "workflow_run") {
    await db.workflowRun.create({
      data: {
        id: payload.workflow_run.id,
        status: payload.workflow_run.status,
        repo: payload.repository.full_name,
      },
    });
  }
  return json({ ok: true });
};
