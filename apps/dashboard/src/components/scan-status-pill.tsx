import { cn } from "@/lib/utils";

// Maps the values the backend writes to scan_runs.status onto a small
// palette. Unknown statuses fall through to a neutral pill so we don't
// crash if the backend introduces a new state before the dashboard is
// updated.
const STATUS_STYLES: Record<string, string> = {
  completed:
    "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-900",
  succeeded:
    "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-900",
  running:
    "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-900",
  pending:
    "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-900",
  failed:
    "bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-100 dark:border-red-900",
  errored:
    "bg-red-100 text-red-900 border-red-200 dark:bg-red-950 dark:text-red-100 dark:border-red-900",
  skipped:
    "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-900",
};

const NEUTRAL = "bg-muted text-muted-foreground border-border";

export function ScanStatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status.toLowerCase()] ?? NEUTRAL;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        style,
      )}
    >
      {status}
    </span>
  );
}
