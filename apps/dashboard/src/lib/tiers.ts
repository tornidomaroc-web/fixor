/**
 * Pricing tiers — single source of truth for the dashboard.
 *
 * Mirrors the "Locked decisions" pricing table in
 * docs/INDIE-SAAS-ROADMAP.md. Phase 5D-2 will reuse these `id` values
 * when mapping a tier choice to a `PADDLE_PRICE_*` env var, so the
 * shape here is intentionally close to "what the checkout call needs".
 *
 * Caps refer to the Anthropic budget cap, not the customer price —
 * that mapping is decided in 5D-4 and can drift independently from the
 * customer-facing scan limits below.
 */
export type TierId = "free" | "indie" | "pro" | "team";

export interface Tier {
  id: TierId;
  label: string;
  /** USD per month, billed by Paddle. 0 for free. */
  priceUsd: number;
  /** Anthropic budget cap (USD/month) — what `orgs.monthly_cap_usd`
   *  is set to when this tier is provisioned. */
  monthlyCapUsd: number;
  /** Customer-facing scans/month limit (independent of the cap). */
  scansPerMonth: number;
  /** Name of the env var that holds this tier's Paddle price id —
   *  e.g. `PADDLE_PRICE_INDIE`. `null` for the free tier (no Paddle
   *  product needed). 5D-2's checkout call reads `process.env[name]`. */
  paddlePriceEnv: string | null;
  /** One-line marketing copy. Kept short — the table is dense. */
  highlight: string;
  /** Bullet points rendered under the price. */
  features: readonly string[];
}

export const TIERS: readonly Tier[] = [
  {
    id: "free",
    label: "Free",
    priceUsd: 0,
    monthlyCapUsd: 5,
    scansPerMonth: 5,
    paddlePriceEnv: null,
    highlight: "Try Fixor on a public repo",
    features: [
      "5 scans / month",
      "Public repos only",
      "All 4 detectors",
    ],
  },
  {
    id: "indie",
    label: "Indie",
    priceUsd: 29,
    monthlyCapUsd: 30,
    scansPerMonth: 100,
    paddlePriceEnv: "PADDLE_PRICE_INDIE",
    highlight: "One private repo, weekend-side-project pricing",
    features: [
      "100 scans / month",
      "1 private repo + unlimited public",
      "All 4 detectors",
    ],
  },
  {
    id: "pro",
    label: "Pro",
    priceUsd: 79,
    monthlyCapUsd: 80,
    scansPerMonth: 500,
    paddlePriceEnv: "PADDLE_PRICE_PRO",
    highlight: "Small teams shipping security daily",
    features: [
      "500 scans / month",
      "5 private repos + unlimited public",
      "All detectors + Slack / Jira",
    ],
  },
  {
    id: "team",
    label: "Team",
    priceUsd: 199,
    monthlyCapUsd: 200,
    scansPerMonth: 2000,
    paddlePriceEnv: "PADDLE_PRICE_TEAM",
    highlight: "Unlimited repos, priority support",
    features: [
      "2,000 scans / month",
      "Unlimited repos",
      "All detectors + priority support",
    ],
  },
];

export function getTier(id: string): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}
