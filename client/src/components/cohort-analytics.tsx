/**
 * T97 — Cohort Analysis Component
 *
 * Renders lead cohort conversion funnels segmented by:
 *   source | state | county | campaign | import_month | import_quarter
 *
 * Shows: contacted rate, offer rate, closed rate, avg days to close
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { GitBranch, TrendingUp, Users, Clock } from "lucide-react";

type CohortSegment = "source" | "state" | "county" | "campaign" | "import_month" | "import_quarter";

interface CohortRow {
  segment: string;
  totalLeads: number;
  contacted: number;
  offerSent: number;
  underContract: number;
  closed: number;
  contactedRate: number;
  offerRate: number;
  closedRate: number;
  avgDaysToClose: number | null;
}

interface CohortReport {
  segmentBy: CohortSegment;
  cohorts: CohortRow[];
  totalLeads: number;
  overallClosedRate: number;
}

const SEGMENT_OPTIONS: { value: CohortSegment; label: string }[] = [
  { value: "source", label: "Lead Source" },
  { value: "state", label: "State" },
  { value: "county", label: "County" },
  { value: "campaign", label: "Campaign" },
  { value: "import_month", label: "Import Month" },
  { value: "import_quarter", label: "Import Quarter" },
];

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function colorForRate(rate: number): string {
  if (rate >= 0.15) return "text-green-600";
  if (rate >= 0.08) return "text-yellow-600";
  return "text-red-500";
}

export function CohortAnalytics() {
  const [segment, setSegment] = useState<CohortSegment>("source");

  const { data, isLoading, error } = useQuery<CohortReport>({
    queryKey: ["/api/analytics/cohorts", segment],
    queryFn: () =>
      fetch(`/api/analytics/cohorts?segmentBy=${segment}`, { credentials: "include" }).then(r => r.json()),
  });

  const chartData = data?.cohorts
    .filter(c => c.totalLeads >= 3)
    .slice(0, 12)
    .map(c => ({
      name: c.segment.length > 14 ? c.segment.slice(0, 13) + "…" : c.segment,
      fullName: c.segment,
      Contacted: Math.round(c.contactedRate * 100),
      "Offer Sent": Math.round(c.offerRate * 100),
      Closed: Math.round(c.closedRate * 100),
    })) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4" /> Cohort Conversion Analysis
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track lead cohorts through the funnel from import to close.
          </p>
        </div>
        <Select value={segment} onValueChange={(v) => setSegment(v as CohortSegment)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENT_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Unable to load cohort data.
          </CardContent>
        </Card>
      ) : !data?.cohorts.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No cohort data available yet. Import leads to see conversion funnels.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Leads", value: data.totalLeads.toLocaleString(), icon: Users },
              { label: "Cohorts", value: data.cohorts.length, icon: GitBranch },
              {
                label: "Overall Close Rate",
                value: pct(data.overallClosedRate),
                icon: TrendingUp,
              },
              {
                label: "Best Segment",
                value: data.cohorts.sort((a, b) => b.closedRate - a.closedRate)[0]?.segment ?? "—",
                icon: TrendingUp,
              },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="pt-3 pb-3 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-sm font-semibold truncate max-w-[100px]">{String(value)}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Bar Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Conversion Rates by {SEGMENT_OPTIONS.find(o => o.value === segment)?.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                    <Tooltip
                      formatter={(v: number) => `${v}%`}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Contacted" fill="#60a5fa" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Offer Sent" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Closed" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Detail Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cohort Detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Segment</th>
                      <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Leads</th>
                      <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Contacted</th>
                      <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Offer %</th>
                      <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Close %</th>
                      <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Avg Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.slice(0, 20).map((row) => (
                      <tr key={row.segment} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-medium max-w-[160px] truncate">{row.segment}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{row.totalLeads}</td>
                        <td className="px-4 py-2 text-right">{pct(row.contactedRate)}</td>
                        <td className="px-4 py-2 text-right">{pct(row.offerRate)}</td>
                        <td className={`px-4 py-2 text-right font-semibold ${colorForRate(row.closedRate)}`}>
                          {pct(row.closedRate)}
                        </td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {row.avgDaysToClose != null ? `${Math.round(row.avgDaysToClose)}d` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
