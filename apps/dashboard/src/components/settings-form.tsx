"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  DETECTOR_OPTIONS,
  SEVERITY_OPTIONS,
  type Severity,
} from "@/lib/detectors";
import type { OrgSettingsRow } from "@/lib/settings-data";

interface Props {
  orgId: string;
  initial: OrgSettingsRow;
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; changed: string[] }
  | { kind: "error"; messages: string[] };

export function SettingsForm({ orgId, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [severity, setSeverity] = useState<Severity>(initial.severityThreshold);
  // Globs are edited as one-per-line text — array<->text conversion lives
  // here so the API surface stays JSON-array (not newline-joined string).
  const [globsText, setGlobsText] = useState(initial.ignoredGlobs.join("\n"));
  const [allDetectors, setAllDetectors] = useState(
    initial.enabledDetectors === null,
  );
  const [enabledIds, setEnabledIds] = useState<string[]>(
    initial.enabledDetectors ?? DETECTOR_OPTIONS.map((d) => d.id),
  );
  const [slack, setSlack] = useState(initial.slackWebhookUrl ?? "");

  function buildPayload() {
    const ignoredGlobs = globsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      severityThreshold: severity,
      ignoredGlobs,
      enabledDetectors: allDetectors ? null : enabledIds,
      slackWebhookUrl: slack.trim() === "" ? null : slack.trim(),
    };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    startTransition(async () => {
      const res = await fetch(`/api/orgs/${orgId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (res.ok) {
        const data = (await res.json()) as { changed: string[] };
        setStatus({ kind: "saved", changed: data.changed ?? [] });
        // Refresh server data so subsequent renders reflect the saved row.
        router.refresh();
        return;
      }
      let messages: string[] = [`server returned ${res.status}`];
      try {
        const body = (await res.json()) as {
          error?: string;
          details?: string[];
        };
        if (Array.isArray(body.details) && body.details.length > 0) {
          messages = body.details;
        } else if (typeof body.error === "string") {
          messages = [body.error];
        }
      } catch {
        // keep default message
      }
      setStatus({ kind: "error", messages });
    });
  }

  function toggleDetector(id: string) {
    setEnabledIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <Section
        title="Severity threshold"
        hint="Findings below this level are dropped before they reach the PR comment."
      >
        <div className="flex flex-wrap gap-2">
          {SEVERITY_OPTIONS.map((s) => (
            <label
              key={s}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1 text-sm capitalize transition-colors",
                severity === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground hover:bg-muted/40",
              )}
            >
              <input
                type="radio"
                name="severity"
                value={s}
                checked={severity === s}
                onChange={() => setSeverity(s)}
                className="sr-only"
              />
              {s}
            </label>
          ))}
        </div>
      </Section>

      <Section
        title="Ignored paths"
        hint="One glob per line. Files whose path matches any glob are skipped. Example: vendor/**, **/*.test.ts"
      >
        <textarea
          value={globsText}
          onChange={(e) => setGlobsText(e.target.value)}
          rows={5}
          spellCheck={false}
          className="font-mono w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          placeholder="vendor/**&#10;**/*.test.ts"
        />
      </Section>

      <Section
        title="Detectors"
        hint='Choose "all" to run every detector Fixor adds in the future automatically, or pick a specific subset.'
      >
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="detectors-mode"
              checked={allDetectors}
              onChange={() => setAllDetectors(true)}
            />
            Run all detectors (default)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="detectors-mode"
              checked={!allDetectors}
              onChange={() => setAllDetectors(false)}
            />
            Only run selected detectors
          </label>
          {!allDetectors ? (
            <div className="ml-6 flex flex-col gap-2">
              {DETECTOR_OPTIONS.map((d) => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={enabledIds.includes(d.id)}
                    onChange={() => toggleDetector(d.id)}
                  />
                  <span>{d.label}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {d.id}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        title="Slack webhook URL"
        hint="Optional. Findings will be posted to this incoming webhook. https:// only — leave empty to disable."
      >
        <input
          type="url"
          value={slack}
          onChange={(e) => setSlack(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-foreground focus:outline-none"
        />
      </Section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>

        {status.kind === "saved" ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            {status.changed.length === 0
              ? "Saved (no changes)"
              : `Saved · updated ${status.changed.join(", ")}`}
          </span>
        ) : null}

        {status.kind === "error" ? (
          <ul className="text-sm text-red-600 dark:text-red-400">
            {status.messages.map((m, i) => (
              <li key={i}>· {m}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="mt-1">{children}</div>
    </section>
  );
}
