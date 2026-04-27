/**
 * Server-only helpers for talking to the Paddle Billing API.
 *
 * Hand-rolled rather than using @paddle/paddle-node-sdk because the
 * surface we need (one POST /transactions call) doesn't justify the
 * dependency. If we add subscription cancellation, customer-portal
 * URLs, or invoice fetching later, swapping in the SDK is a one-file
 * change.
 *
 * Env contract (set in 5D-1):
 *   - PADDLE_API_KEY            server-side bearer (apikey_*)
 *   - NEXT_PUBLIC_PADDLE_ENVIRONMENT  "sandbox" | "production"
 *   - PADDLE_PRICE_INDIE/PRO/TEAM     one Paddle price id per paid tier
 */
import "server-only";

export type PaddleEnvironment = "sandbox" | "production";

const PADDLE_BASES: Record<PaddleEnvironment, string> = {
  sandbox: "https://sandbox-api.paddle.com",
  production: "https://api.paddle.com",
};

function readEnvironment(): PaddleEnvironment {
  const raw =
    process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT?.trim().toLowerCase() ??
    "sandbox";
  return raw === "production" ? "production" : "sandbox";
}

function readApiKey(): string {
  const k = process.env.PADDLE_API_KEY?.trim();
  if (!k) {
    throw new Error(
      "PADDLE_API_KEY is not set on the dashboard runtime. 5D-1 added the placeholder; set it in Vercel before checkout traffic hits this endpoint.",
    );
  }
  return k;
}

export interface CreateTransactionInput {
  /** Paddle price id (`pri_*`). */
  priceId: string;
  /** Org UUID — Paddle echoes this back via custom_data on every
   *  webhook event so 5D-3 can match the transaction to our org row. */
  orgId: string;
  /** Where Paddle should send the customer after a successful
   *  payment. The cancel path is the same URL — Paddle's hosted
   *  checkout reuses it. */
  returnUrl: string;
  /** Optional — if the org already has a paddle_customer_id (set by
   *  5D-3 after the first successful checkout), we pass it so the
   *  customer doesn't have to re-enter their email. */
  paddleCustomerId?: string | null;
}

export interface CreateTransactionResult {
  transactionId: string;
  /** Hosted-checkout URL — opaque from Paddle, the client redirects
   *  the browser straight here. */
  checkoutUrl: string;
}

/**
 * Create a one-time-payable transaction tied to a recurring price.
 * Paddle's hosted checkout takes over from there: collects payment,
 * fires `transaction.completed` + `subscription.created` webhooks,
 * and bounces the user back to `returnUrl`.
 */
export async function createCheckoutTransaction(
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  const env = readEnvironment();
  const base = PADDLE_BASES[env];
  const apiKey = readApiKey();

  // Paddle quietly rejects custom_data values that aren't strings, so
  // keep this object flat + stringy. The webhook handler in 5D-3 will
  // read custom_data.org_id as the correlation key.
  const body: Record<string, unknown> = {
    items: [{ price_id: input.priceId, quantity: 1 }],
    custom_data: { org_id: input.orgId },
    checkout: { url: input.returnUrl },
  };
  if (input.paddleCustomerId) {
    body.customer_id = input.paddleCustomerId;
  }

  const res = await fetch(`${base}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Paddle pins API behavior to a date — using the schema this
      // helper was written against keeps responses stable.
      "Paddle-Version": "1",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `paddle_api_${res.status}`;
    try {
      const errBody = (await res.json()) as {
        error?: { detail?: string; type?: string };
      };
      if (errBody.error?.detail) {
        message = `paddle: ${errBody.error.detail}`;
      } else if (errBody.error?.type) {
        message = `paddle: ${errBody.error.type}`;
      }
    } catch {
      // Body wasn't JSON — keep the generic status-code message.
    }
    throw new Error(message);
  }

  const json = (await res.json()) as {
    data?: {
      id?: string;
      checkout?: { url?: string };
    };
  };
  const id = json.data?.id;
  const url = json.data?.checkout?.url;
  if (!id || !url) {
    throw new Error("paddle: response missing transaction id or checkout url");
  }
  return { transactionId: id, checkoutUrl: url };
}

export interface SubscriptionManagementUrls {
  updatePaymentMethod: string;
  cancel: string;
}

/**
 * Pull a subscription's hosted-portal URLs (5D-5).
 *
 * Paddle returns these on every GET /subscriptions/{id} so we don't
 * store them — fetching at click time means we always hand the
 * customer the freshest signed URL, even if Paddle rotates them
 * server-side. The trade is one extra round-trip on click vs.
 * stale-URL risk; for an indie shop the round-trip wins.
 */
export async function getSubscriptionManagementUrls(
  subscriptionId: string,
): Promise<SubscriptionManagementUrls> {
  if (!subscriptionId) {
    throw new Error("paddle: missing subscription id");
  }
  const env = readEnvironment();
  const base = PADDLE_BASES[env];
  const apiKey = readApiKey();

  const res = await fetch(
    `${base}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Paddle-Version": "1",
      },
    },
  );

  if (!res.ok) {
    let message = `paddle_api_${res.status}`;
    try {
      const errBody = (await res.json()) as {
        error?: { detail?: string; type?: string };
      };
      if (errBody.error?.detail) message = `paddle: ${errBody.error.detail}`;
      else if (errBody.error?.type) message = `paddle: ${errBody.error.type}`;
    } catch {
      // keep generic
    }
    throw new Error(message);
  }

  const json = (await res.json()) as {
    data?: {
      management_urls?: {
        update_payment_method?: string;
        cancel?: string;
      };
    };
  };
  const update = json.data?.management_urls?.update_payment_method;
  const cancel = json.data?.management_urls?.cancel;
  if (!update || !cancel) {
    throw new Error(
      "paddle: subscription response missing management_urls — Paddle only returns these for active subscriptions",
    );
  }
  return { updatePaymentMethod: update, cancel };
}
