"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * - `ready`   — user has 0 installations and hasn't been to GitHub yet
   * - `waiting` — just came back from GitHub (`?installed=1`); poll for
   *               the installation to appear
   * - `error`   — Clerk has no GitHub token, or GitHub API rejected us
   */
  state: "ready" | "waiting" | "error";
  /** Distinguishes the two error variants so we can give different copy. */
  reason?: "no_token" | "error";
  installUrl: string;
}

const POLL_MS = 3_000;
const MAX_WAIT_SEC = 30;

/**
 * Phase-5E-3 onboarding wizard.
 *
 * Three states render different UIs from one component so the parent
 * server page (page.tsx) only branches on "should the wizard show at
 * all?" — not on which phase to render.
 *
 * The waiting phase auto-refreshes every 3 seconds. router.refresh()
 * re-runs the parent server component, which calls
 * listFixorInstallations() again; once GitHub reports the new install
 * AND the backend webhook has provisioned the org row, the wizard
 * unmounts and the org list takes over. After 30s with no install
 * appearing we stop polling and show a manual refresh button — at
 * that point the GitHub App's Setup URL probably isn't pointing here,
 * or the backend webhook isn't reaching Railway.
 */
export function InstallWizard({ state, reason, installUrl }: Props) {
  const router = useRouter();
  const [secondsWaited, setSecondsWaited] = useState(0);

  useEffect(() => {
    if (state !== "waiting") return;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setSecondsWaited(elapsed);
      if (elapsed >= MAX_WAIT_SEC) {
        clearInterval(interval);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [state, router]);

  if (state === "error") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6">
        <p className="font-medium">Couldn&apos;t load your GitHub installations</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {reason === "no_token"
            ? "Clerk has no GitHub token for your session. Sign out and back in with GitHub to retry."
            : "GitHub didn't respond. Try again in a moment; if it persists, check the dashboard logs."}
        </p>
      </div>
    );
  }

  if (state === "waiting") {
    const stuck = secondsWaited >= MAX_WAIT_SEC;
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          {!stuck ? <Spinner /> : null}
          <p className="font-medium">
            {!stuck ? "Finishing setup…" : "Still waiting"}
          </p>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          {!stuck
            ? `Waiting for GitHub to confirm the install (${secondsWaited}s). The page refreshes every few seconds — leave it open.`
            : `It's been over ${MAX_WAIT_SEC}s. The install webhook hasn't reached us yet. Try refreshing manually; if that doesn't work, the GitHub App's Setup URL or the backend webhook may not be wired to this dashboard.`}
        </p>
        {stuck ? (
          <button
            type="button"
            onClick={() => router.refresh()}
            className="mt-4 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
          >
            Refresh manually
          </button>
        ) : null}
      </div>
    );
  }

  // state === "ready"
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h3 className="text-base font-semibold tracking-tight">
        Install Fixor on GitHub
      </h3>
      <p className="text-muted-foreground mt-2 text-sm">
        Pick a user or organization and the repos you want Fixor to
        review. We&apos;ll redirect you back here once GitHub finishes.
      </p>
      <ol className="text-muted-foreground mt-4 flex flex-col gap-2 text-sm">
        <li>
          <span className="text-foreground font-medium">1.</span> Click
          the install button below — opens GitHub&apos;s install screen.
        </li>
        <li>
          <span className="text-foreground font-medium">2.</span> Choose
          all repos, or pick specific ones. Public repos are free; the
          first private repo needs the Indie tier.
        </li>
        <li>
          <span className="text-foreground font-medium">3.</span> GitHub
          sends you back here. Open a PR on a watched repo and Fixor
          scans within ~30 seconds.
        </li>
      </ol>
      <a
        href={installUrl}
        className="mt-5 inline-flex items-center rounded-md border border-foreground bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        Install Fixor on GitHub
      </a>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2",
        "border-foreground/30 border-t-foreground",
      )}
    />
  );
}
