"use client";

import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FamilyPoint, WeeklyPoint } from "@/lib/trends-data";

interface Props {
  weekly: WeeklyPoint[];
  byFamily: FamilyPoint[];
  totalScans: number;
  weeks: number;
}

// Stable color order by detector id keeps the legend consistent across
// renders even when the family count changes between scans. Keys must
// mirror SHIPPING_DETECTOR_IDS in src/analysis-engine/detectors/registry.ts
// and the DETECTOR_OPTIONS list in src/lib/detectors.ts; if you add a
// detector there, add a color here too or the pie slice falls through
// to FALLBACK_COLOR.
const FAMILY_COLORS: Record<string, string> = {
  "auth-bypass-multi": "#ef4444", // red-500
  "admin-check-multi": "#f59e0b", // amber-500
  "idor-multi": "#3b82f6", // blue-500
  "env-exposure-multi": "#8b5cf6", // violet-500
  "secrets-exposure-multi": "#ec4899", // pink-500
  "webhook-unverified-multi": "#10b981", // emerald-500
};
const FALLBACK_COLOR = "#6b7280"; // gray-500 — surfaced when an unknown id appears

export function TrendsChart({
  weekly,
  byFamily,
  totalScans,
  weeks,
}: Props) {
  // No data → render a single quiet empty state covering both panels;
  // recharts itself renders the axes for an all-zero series, which is
  // visually noisy when nothing has been scanned yet.
  if (totalScans === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-sm">
        <p className="font-medium">No trend data yet</p>
        <p className="text-muted-foreground mt-1">
          Once Fixor scans a few PRs, this widget shows scans and findings
          per week and the breakdown by detector family. (No scans in the
          last {weeks} weeks.)
        </p>
      </div>
    );
  }

  const formatted = weekly.map((w) => ({ ...w, label: shortDate(w.weekStart) }));
  const familyForChart = byFamily.map((f) => ({
    ...f,
    color: FAMILY_COLORS[f.family] ?? FALLBACK_COLOR,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          Scans &amp; findings · last {weeks} weeks
        </p>
        <div className="mt-2 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={formatted}
              margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <XAxis
                dataKey="label"
                tick={{ fill: "currentColor", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "currentColor", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card, white)",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelClassName="text-foreground"
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                iconType="circle"
              />
              <Line
                type="monotone"
                dataKey="scans"
                name="Scans"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="findings"
                name="Findings"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          Findings by family
        </p>
        {familyForChart.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            No findings reported yet.
          </p>
        ) : (
          <div className="mt-2 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-card, white)",
                    border: "1px solid var(--color-border, #e5e7eb)",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  iconType="circle"
                  verticalAlign="bottom"
                />
                <Pie
                  data={familyForChart}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="40%"
                  outerRadius="75%"
                  paddingAngle={2}
                >
                  {familyForChart.map((f) => (
                    <Cell key={f.family} fill={f.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  // Parse the YYYY-MM-DD as a UTC date and render as M/D so the
  // x-axis stays compact even with 12 weeks of points.
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  return `${m}/${d}`;
}
