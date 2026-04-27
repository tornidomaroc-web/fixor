"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

interface Props {
  orgId: string;
  /** When false the org has no active Paddle subscription (free tier
   *  or post-downgrade) — the buttons render inert with copy that
   *  explains why. */
  hasSubscription: boolean;
}

type Kind = "update_payment" | "cancel";

/**
 * Pair of buttons that POST to /api/billing/portal and follow the
 * returned URL. We fetch on click rather than caching the URL on the
 * page so the customer always lands on a fresh Paddle-signed link.
 */
export function ManageSubscriptionButtons({ orgId, hasSubscription }: Props) {
  const [pending, startTransition] = useTransition();
  const [pendingKind, setPendingKind] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(kind: Kind) {
    setError(null);
    setPendingKind(kind);
    startTransition(async () => {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, kind }),
      });
      if (!res.ok) {
        let msg = `portal failed (${res.status})`;
        try {
          const body = (await res.json()) as {
            error?: string;
            details?: string[];
          };
          if (body.details && body.details[0]) msg = body.details[0];
          else if (body.error) msg = body.error;
        } catch {
          // keep default
        }
        setError(msg);
        setPendingKind(null);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        setError("no portal url returned");
        setPendingKind(null);
        return;
      }
      window.location.assign(body.url);
    });
  }

  if (!hasSubscription) {
    return (
      <button
        type="button"
        disabled
        title="No active Paddle subscription — upgrade first to manage payment / cancel."
        className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-not-allowed"
      >
        Manage subscription
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => open("update_payment")}
          disabled={pending}
          className={cn(
            "rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60",
          )}
        >
          {pending && pendingKind === "update_payment"
            ? "Opening…"
            : "Update payment"}
        </button>
        <button
          type="button"
          onClick={() => open("cancel")}
          disabled={pending}
          className={cn(
            "rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60",
          )}
        >
          {pending && pendingKind === "cancel" ? "Opening…" : "Cancel"}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
