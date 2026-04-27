import { cn } from "@/lib/utils";

const TIER_STYLES: Record<string, string> = {
  free: "bg-muted text-muted-foreground border-border",
  indie: "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-900",
  pro: "bg-purple-100 text-purple-900 border-purple-200 dark:bg-purple-950 dark:text-purple-100 dark:border-purple-900",
  team: "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-900",
};

export function TierBadge({ tier }: { tier: string }) {
  const style = TIER_STYLES[tier] ?? TIER_STYLES.free;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        style,
      )}
    >
      {tier}
    </span>
  );
}
