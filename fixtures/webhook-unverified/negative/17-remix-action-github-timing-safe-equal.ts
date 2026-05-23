// ASSUMED-PATH: app/routes/api.webhook.github.ts
// Phase E — Remix v2 webhook-unverified negative.
// GitHub webhook handler at Remix v2 path using HMAC-SHA256 +
// crypto.timingSafeEqual against x-hub-signature-256. Gated per
// webhook prompt's GATED case (timing-safe primitive comparing
// computed HMAC against incoming signature header).
import { createHmac, timingSafeEqual } from "node:crypto";

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { db } from "~/lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const sig = request.headers.get("x-hub-signature-256");
  if (!sig?.startsWith("sha256=")) {
    return json({ error: "missing signature" }, { status: 400 });
  }
  const body = await request.text();
  const expected =
    "sha256=" +
    createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET!)
      .update(body)
      .digest("hex");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return json({ error: "invalid signature" }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  if (event === "workflow_run") {
    const payload = JSON.parse(body);
    await db.workflowRun.create({
      data: { id: payload.workflow_run.id, status: payload.workflow_run.status },
    });
  }
  return json({ ok: true });
};
