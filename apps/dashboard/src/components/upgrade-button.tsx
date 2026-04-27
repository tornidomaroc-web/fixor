"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { TierId } from "@/lib/tiers";

interface Props {
  orgId: string;
  tier: TierId;
  label: string;
  isCurrent: boolean;
  /** When true, the button is rendered but inert with a static
   *  "Current plan" label. Used for the row that matches the org's
   *  active tier. */
  disabled?: boolean;
  className?: string;
}

/**
 * Posts to /api/billing/checkout and follows the returned URL.
 *
 * We do NOT pop a confirmation modal — the next page IS Paddle's
 * checkout overlay, which already shows price + cadence + a cancel
 * button. Adding our own confirmation would be redundant.
 */
export function UpgradeButton({
  orgId,
  tier,
  label,
  isCurrent,
  disabled,
  className,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, tier }),
      });
      if (!res.ok) {
        let msg = `checkout failed (${res.status})`;
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
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        setError("no checkout url returned");
        return;
      }
      // Redirect rather than overlay — Paddle's hosted checkout is a
      // full page and survives back-button without a stuck overlay.
      window.location.assign(body.url);
    });
  }

  if (disabled || isCurrent) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          "rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground cursor-not-allowed",
          className,
        )}
      >
        {isCurrent ? "Current plan" : label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={cn(
          "rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60",
          className,
        )}
      >
        {pending ? "Opening checkout…" : label}
      </button>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
