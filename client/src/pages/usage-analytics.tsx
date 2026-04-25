import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { BarChart3, TrendingUp, DollarSign, Activity } from "lucide-react";

const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const ACTION_LABELS: Record<string, string> = {
  email_sent: "Emails",
  sms_sent: "SMS",
  ai_chat: "AI chat",
  ai_image: "AI images",
  pdf_generated: "PDFs",
  comps_query: "Comps",
  direct_mail: "Direct mail",
};

const ACTION_COLORS: Record<string, string> = {
  email_sent: "bg-blue-500",
  sms_sent: "bg-green-500",
  ai_chat: "bg-purple-500",
  ai_image: "bg-pink-500",
  pdf_generated: "bg-orange-500",
  comps_query: "bg-cyan-500",
  direct_mail: "bg-amber-500",
};

export default function UsageAnalyticsPage() {
  useDocumentTitle("Usage analytics");
  const [period, setPeriod] = useState("30d");

  const { data, isLoading } = useQuery<{
    period: string;
    series: { date: string; actions: Record<string, { count: number; costCents: number }> }[];
    totals: Record<string, { count: number; costCents: number }>;
    totalCostCents: number;
    recordCount: number;
  }>({
    queryKey: ["/api/usage/analytics", period],
    queryFn: async () => {
      const res = await fetch(`/api/usage/analytics?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch usage analytics");
      return res.json();
    },
    staleTime: 1000 * 60 * 2,
  });

  const totalActions = data ? Object.values(data.totals).reduce((sum, t) => sum + t.count, 0) : 0;
  const topAction = data ? Object.entries(data.totals).sort(([, a], [, b]) => b.count - a.count)[0] : null;

  // Find max daily total for scaling bars
  const maxDaily = data?.series.reduce((max, day) => {
    const dayTotal = Object.values(day.actions).reduce((s, a) => s + a.count, 0);
    return Math.max(max, dayTotal);
  }, 0) || 1;

  return (
    <PageShell>
      {/* Period selector */}
      <div role="group" aria-label="Select time period" className="flex gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={period === p.value ? "default" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.value)}
            aria-pressed={period === p.value}
            className="min-h-9"
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Summary cards */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-primary" aria-hidden="true" />
              <div>
                <dt className="text-sm text-muted-foreground">Total actions</dt>
                <dd className="text-2xl font-bold tabular-nums">{isLoading ? "—" : totalActions.toLocaleString()}</dd>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-primary" aria-hidden="true" />
              <div>
                <dt className="text-sm text-muted-foreground">Total cost</dt>
                <dd className="text-2xl font-bold tabular-nums">
                  {isLoading ? "—" : usd((data?.totalCostCents || 0) / 100)}
                </dd>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-5 h-5 text-primary" aria-hidden="true" />
              <div>
                <dt className="text-sm text-muted-foreground">Top action</dt>
                <dd className="text-2xl font-bold">
                  {isLoading ? "—" : ACTION_LABELS[topAction?.[0] || ""] || topAction?.[0] || "None"}
                </dd>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-primary" aria-hidden="true" />
              <div>
                <dt className="text-sm text-muted-foreground">Active days</dt>
                <dd className="text-2xl font-bold tabular-nums">{isLoading ? "—" : data?.series.length || 0}</dd>
              </div>
            </div>
          </CardContent>
        </Card>
      </dl>

      {/* Usage chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily usage</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground" role="status" aria-live="polite">
              Tallying daily usage…
            </div>
          ) : !data?.series.length ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">No usage data for this period.</div>
          ) : (
            <ul className="space-y-1" aria-label="Daily usage breakdown">
              {data.series.slice(-30).map((day) => {
                const dayTotal = Object.values(day.actions).reduce((s, a) => s + a.count, 0);
                return (
                  <li key={day.date} className="flex items-center gap-2 text-xs">
                    <span className="w-16 text-muted-foreground shrink-0 tabular-nums">
                      {new Date(day.date + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <div
                      className="flex-1 flex h-5 rounded overflow-hidden bg-muted/30"
                      role="img"
                      aria-label={`${day.date}: ${dayTotal} total actions`}
                    >
                      {Object.entries(day.actions).map(([action, { count }]) => (
                        <div
                          key={action}
                          className={`${ACTION_COLORS[action] || "bg-gray-400"} transition-all`}
                          style={{ width: `${(count / maxDaily) * 100}%` }}
                          title={`${ACTION_LABELS[action] || action}: ${count}`}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                    <span className="w-8 text-right text-muted-foreground tabular-nums">{dayTotal}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Breakdown by action type */}
      <Card>
        <CardHeader>
          <CardTitle>Breakdown by type</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground" role="status" aria-live="polite">Grouping usage by type…</div>
          ) : Object.keys(data?.totals || {}).length === 0 ? (
            <div className="text-muted-foreground text-center py-4">No usage data for this period.</div>
          ) : (
            <ul className="space-y-3" aria-label="Usage by action type">
              {Object.entries(data?.totals || {})
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([action, { count, costCents }]) => (
                  <li key={action} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${ACTION_COLORS[action] || "bg-gray-400"}`} aria-hidden="true" />
                      <span className="font-medium">{ACTION_LABELS[action] || action}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge variant="outline">
                        <span className="tabular-nums">{count.toLocaleString()}</span> action{count === 1 ? "" : "s"}
                      </Badge>
                      <span className="text-sm text-muted-foreground w-16 text-right tabular-nums">{usd(costCents / 100)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
