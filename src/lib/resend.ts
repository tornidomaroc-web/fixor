/**
 * Backend Resend client (5E-4).
 *
 * Mirrors apps/dashboard/src/lib/resend.ts in shape but logs through
 * pino + redacts to fit our backend conventions. Used by the
 * first-scan-email flow today; future backend-side billing emails
 * (e.g. the 80% scan-limit nudge — Phase 5D close-out follow-up)
 * will share this client.
 *
 * `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are optional. While unset,
 * the helper returns `{ ok: true, provider: "stub" }` and logs at
 * info level so the operator can verify the call site fires —
 * trades "no email" for "no Paddle-style retries", which is what
 * we want for a fire-and-forget post-scan notification.
 */
import { logger } from "./logger";

export interface BillingEmail {
  to: string | null | undefined;
  subject: string;
  text: string;
}

export type SendResult =
  | { ok: true; provider: "resend" | "stub"; id?: string }
  | { ok: false; reason: string };

const RESEND_BASE = "https://api.resend.com";

export async function sendBillingEmail(
  email: BillingEmail,
): Promise<SendResult> {
  if (!email.to) {
    return { ok: true, provider: "stub" };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    logger.info(
      { to: email.to, subject: email.subject },
      "[resend stub] would send (RESEND_API_KEY or RESEND_FROM_EMAIL not configured)",
    );
    return { ok: true, provider: "stub" };
  }

  try {
    const res = await fetch(`${RESEND_BASE}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
    });
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) detail = `${res.status}: ${body.message}`;
      } catch {
        // ignore
      }
      return { ok: false, reason: `resend_api_${detail}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, provider: "resend", id: json.id };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "resend_unknown",
    };
  }
}
