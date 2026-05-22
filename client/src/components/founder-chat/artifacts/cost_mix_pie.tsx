/**
 * cost_mix_pie artifact — pie chart of cost mix by category.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { CostMixSlice } from "@shared/founder-chat/artifacts";

interface CostMixPieProps {
  data: CostMixSlice[];
  windowDays?: number;
}

const PALETTE = [
  "hsl(var(--acr-brand))",
  "hsl(var(--acr-accent))",
  "hsl(var(--acr-pos))",
  "hsl(var(--acr-warn))",
  "hsl(var(--acr-neg))",
  "hsl(var(--muted-foreground))",
];

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round((cents ?? 0) / 100));
}

export function CostMixPieArtifact({ data, windowDays }: CostMixPieProps) {
  const slices = (data ?? []).map((s) => ({ ...s, cents: Number(s.cents ?? 0) }));
  const total = slices.reduce((sum, s) => sum + s.cents, 0);

  return (
    <Card data-testid="artifact-cost-mix-pie">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-baseline gap-2">
          <span>Cost mix</span>
          {windowDays && (
            <span className="text-xs font-normal text-muted-foreground">
              last {windowDays}d
            </span>
          )}
          <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
            total {fmt(total)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="cents"
                  nameKey="category"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {slices.map((_, idx) => (
                    <Cell key={idx} fill={PALETTE[idx % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name, entry) => [
                    fmt(value),
                    (entry?.payload as { category?: string })?.category ?? "",
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs w-full">
            {slices.map((s, idx) => {
              const pct = total > 0 ? Math.round((s.cents / total) * 100) : 0;
              return (
                <li key={s.category} className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full inline-block shrink-0"
                    style={{ background: PALETTE[idx % PALETTE.length] }}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground truncate">{s.category}</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {fmt(s.cents)} <span className="text-muted-foreground">({pct}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export default CostMixPieArtifact;
