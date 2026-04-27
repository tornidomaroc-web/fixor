import { cn } from "@/lib/utils";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function SpendBar({
  spendUsd,
  capUsd,
}: {
  spendUsd: number;
  capUsd: number;
}) {
  const pct =
    capUsd <= 0 ? 0 : Math.min(100, Math.max(0, (spendUsd / capUsd) * 100));
  // Color-code by spend pressure: green < 60, amber 60-89, red 90+.
  const fill =
    pct >= 90
      ? "bg-red-500"
      : pct >= 60
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{formatUsd(spendUsd)} this month</span>
        <span>cap {formatUsd(capUsd)}</span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
