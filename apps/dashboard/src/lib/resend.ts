/**
 * Minimal Resend client used by the Paddle webhook (5D-3).
 *
 * `RESEND_API_KEY` may not be set yet — Resend setup itself is part
 * of 5D-6. When the key is missing, sendBillingEmail logs a structured
 * stub line and resolves successfully so the webhook handler can
 * still 200 to Paddle. That trades "no email" for "no retries" until
 * 5D-6 lands. The 5D-6 templates (welcome / payment-failed /
 * suspended) replace the plain bodies below.
 */
import "server-only";

export interface BillingEmail {
  /** Recipient email — usually pulled from the Paddle event's
   *  customer record. May be null when Paddle hasn't told us yet
   *  (e.g. cancel events sometimes lack the address); the helper
   *  no-ops on null without an error. */
  to: string | null | undefined;
  subject: string;
  text: string;
}

export type SendResult =
  | { ok: true; provider: "resend" | "stub"; id?: string }
  | { ok: false; reason: string };

const RESEND_BASE = "https://api.resend.com";

export async function sendBillingEmail(email: BillingEmail): Promise<SendResult> {
  if (!email.to) {
    return { ok: true, provider: "stub" };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    // Stub mode — log enough that an operator looking at Vercel
    // function logs can see what would have been sent. Switching
    // to real delivery is purely an env-var change.
    console.info(
      `[resend stub] would send to=${email.to} subject=${JSON.stringify(email.subject)}`,
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
