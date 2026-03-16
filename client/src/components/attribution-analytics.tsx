/**
 * T98 — Attribution Analytics Component
 *
 * Renders campaign/channel ROI attribution:
 *   - By campaign: conversions, revenue, cost, ROI
 *   - By channel: email vs sms vs mail vs direct
 *   - Touch number analysis: which touch converts?
 *   - Date range picker
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { TrendingUp, DollarSign, Target, Mail, Loader2 } from "lucide-react";

interface AttributionRow {
  campaignId: number | null;
  campaignName: string;
  channel: string;
  touchNumber: number | null;
  conversions: number;
  totalLeads: number;
  conversionRate: number;
  avgTouchesToConvert: number | null;
  totalRevenue: number;
  totalCost: number;
  roi: number;
  avgDaysToConvert: number | null;
}

interface AttributionReport {
  dateRange: { from: string; to: string };
  byCampaign: AttributionRow[];
  byChannel: AttributionRow[];
  byTouchNumber: { touchNumber: number; conversions: number; pct: number }[];
  summary: {
    totalConversions: number;
    totalRevenue: number;
    bestCampaign: string | null;
    bestChannel: string | null;
    avgTouchesToConvert: number | null;
  };
}

const CHANNEL_COLORS: Record<string, string> = {
  email: "#60a5fa",
  sms: "#f59e0b",
  mail: "#22c55e",
  direct: "#a78bfa",
  unknown: "#94a3b8",
};

const DATE_RANGES = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
];

function fmt$(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function roiColor(roi: number) {
  if (roi > 2) return "text-green-600";
  if (roi > 0) return "text-yellow-600";
  return "text-red-500";
}

export function AttributionAnalytics() {
  const [rangeDays, setRangeDays] = useState(90);

  const from = new Date(Date.now() - rangeDays * 86400000).toISOString().split("T")[0];
  const to = new Date().toISOString().split("T")[0];

  const { data, isLoading, error } = useQuery<AttributionReport>({
    queryKey: ["/api/analytics/attribution", from, to],
    queryFn: () =>
      fetch(`/api/analytics/attribution?from=${from}&to=${to}`, { credentials: "include" }).then(r => r.json()),
  });

  const channelPieData = data?.byChannel.map(c => ({
    name: c.channel,
    value: c.conversions,
  })) ?? [];

  const touchChartData = data?.byTouchNumber.slice(0, 10).map(t => ({
    name: `Touch ${t.touchNumber}`,
    Conversions: t.conversions,
    Pct: Math.round(t.pct * 100),
  })) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" /> Attribution & ROI
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which campaigns, channels, and touch numbers convert leads?
          </p>
        </div>
        <div className="flex gap-1">
          {DATE_RANGES.map(r => (
            <Button
              key={r.label}
              variant={rangeDays === r.days ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setRangeDays(r.days)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Unable to load attribution data.
          </CardContent>
        </Card>
      ) : !data ? null : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Conversions", value: data.summary.totalConversions, icon: Target },
              { label: "Revenue Attributed", value: fmt$(data.summary.totalRevenue), icon: DollarSign },
              { label: "Best Campaign", value: data.summary.bestCampaign ?? "—", icon: TrendingUp },
              { label: "Best Channel", value: data.summary.bestChannel ?? "—", icon: Mail },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="pt-3 pb-3 flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="text-sm font-semibold truncate max-w-[110px]">{String(value)}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Channel Pie */}
            {channelPieData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Conversions by Channel</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={channelPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                        {channelPieData.map((entry) => (
                          <Cell key={entry.name} fill={CHANNEL_COLORS[entry.name] ?? CHANNEL_COLORS.unknown} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Touch Number Bar */}
            {touchChartData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Conversion by Touch Number</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={touchChartData} margin={{ top: 0, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="Conversions" fill="#60a5fa" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Campaign Table */}
          {data.byCampaign.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Campaign ROI</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2 font-medium text-xs text-muted-foreground">Campaign</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Channel</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Conversions</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Revenue</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Cost</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">ROI</th>
                        <th className="text-right px-4 py-2 font-medium text-xs text-muted-foreground">Avg Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCampaign.slice(0, 15).map((row, i) => (
                        <tr key={i} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 font-medium max-w-[160px] truncate">{row.campaignName}</td>
                          <td className="px-4 py-2 text-right">
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ color: CHANNEL_COLORS[row.channel] }}
                            >
                              {row.channel}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right">{row.conversions}</td>
                          <td className="px-4 py-2 text-right text-green-600 font-medium">{fmt$(row.totalRevenue)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground">{fmt$(row.totalCost)}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${roiColor(row.roi)}`}>
                            {row.totalCost > 0 ? `${(row.roi * 100).toFixed(0)}%` : "—"}
                          </td>
                          <td className="px-4 py-2 text-right text-muted-foreground">
                            {row.avgDaysToConvert != null ? `${Math.round(row.avgDaysToConvert)}d` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {!data.byCampaign.length && !data.byChannel.length && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No conversion data in this date range. Run campaigns and track conversions to see attribution.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
