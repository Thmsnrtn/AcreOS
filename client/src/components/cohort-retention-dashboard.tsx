import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Users, DollarSign, TrendingUp, BarChart3, Calendar } from "lucide-react";

interface RetentionPoint {
  week: number;
  active: number;
  rate: number;
}

interface CohortData {
  label: string;
  cohortDate: string;
  signups: number;
  retention: RetentionPoint[];
  revenue: number;
  closedDeals: number;
  totalLeads: number;
  contacted: number;
  converted: number;
  contactRate: number;
  conversionRate: number;
}

interface CohortDashboardResponse {
  granularity: string;
  weeksBack: number;
  cohorts: CohortData[];
  generatedAt: string;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function getRetentionColor(rate: number): string {
  if (rate >= 0.5) return "bg-acr-pos text-white";
  if (rate >= 0.3) return "bg-acr-pos text-white";
  if (rate >= 0.2) return "bg-acr-pos text-white";
  if (rate >= 0.1) return "bg-acr-pos text-acr-pos";
  if (rate > 0) return "bg-acr-pos-soft text-acr-pos";
  return "bg-muted text-muted-foreground";
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function CohortRetentionDashboard() {
  const [granularity, setGranularity] = useState<"week" | "month">("week");
  const [weeksBack, setWeeksBack] = useState(12);

  const { data, isLoading, error, refetch } = useQuery<CohortDashboardResponse>({
    queryKey: ["/api/analytics/cohort-dashboard", granularity, weeksBack],
    queryFn: () =>
      fetch(`/api/analytics/cohort-dashboard?granularity=${granularity}&weeksBack=${weeksBack}`, {
        credentials: "include",
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch cohort data");
        return r.json();
      }),
  });

  if (error) {
    return (
      <QueryErrorState
        error={error as Error}
        onRetry={() => refetch()}
        title="Failed to load cohort retention data"
        testId="error-state-cohort-retention"
      />
    );
  }

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const cohorts = data?.cohorts ?? [];

  if (cohorts.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        headline="No cohort data yet"
        subtitle="Cohort retention data will appear here once you have leads created over multiple weeks."
        // TODO(cta): cohort analytics — data is system-generated, no direct user action
        cta={{ label: "", _noOp: true }}
      />
    );
  }

  // Compute summary stats
  const totalSignups = cohorts.reduce((s, c) => s + c.signups, 0);
  const totalRevenue = cohorts.reduce((s, c) => s + c.revenue, 0);
  const totalConverted = cohorts.reduce((s, c) => s + c.converted, 0);
  const avgConversionRate = totalSignups > 0 ? totalConverted / totalSignups : 0;
  const avgRevenuePerLead = totalSignups > 0 ? totalRevenue / totalSignups : 0;

  // Determine max weeks across all cohorts for retention table columns
  const maxWeeks = Math.min(
    8,
    cohorts.reduce((max, c) => {
      const cMax = c.retention.reduce((m, r) => Math.max(m, r.week), 0);
      return Math.max(max, cMax);
    }, 0)
  );
  const weekColumns = Array.from({ length: maxWeeks + 1 }, (_, i) => i);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Controls */}
      <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-3">
        <Select value={granularity} onValueChange={(v) => setGranularity(v as "week" | "month")}>
          <SelectTrigger className="w-[140px]" aria-label="Select granularity">
            <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Weekly</SelectItem>
            <SelectItem value="month">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(weeksBack)} onValueChange={(v) => setWeeksBack(Number(v))}>
          <SelectTrigger className="w-[140px]" aria-label="Select lookback period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="8">Last 8 {granularity === "month" ? "months" : "weeks"}</SelectItem>
            <SelectItem value="12">Last 12 {granularity === "month" ? "months" : "weeks"}</SelectItem>
            <SelectItem value="24">Last 24 {granularity === "month" ? "months" : "weeks"}</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Summary Cards */}
      <motion.ul variants={staggerItem} aria-label="Cohort retention summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0 m-0">
        <li>
          <Card aria-label={`Total signups: ${totalSignups.toLocaleString()} across ${cohorts.length} cohorts`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total signups</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" aria-hidden="true">{totalSignups.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground m-0" aria-hidden="true">
                Across <span className="tabular-nums">{cohorts.length}</span> cohorts
              </p>
            </CardContent>
          </Card>
        </li>
        <li>
          <Card aria-label={`Total revenue: ${formatCurrency(totalRevenue)} from closed deals`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" aria-hidden="true">{formatCurrency(totalRevenue)}</div>
              <p className="text-xs text-muted-foreground m-0" aria-hidden="true">
                From closed deals
              </p>
            </CardContent>
          </Card>
        </li>
        <li>
          <Card aria-label={`Average conversion rate: ${pct(avgConversionRate)}, leads to closed deals`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg conversion rate</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" aria-hidden="true">{pct(avgConversionRate)}</div>
              <p className="text-xs text-muted-foreground m-0" aria-hidden="true">
                Leads to closed deals
              </p>
            </CardContent>
          </Card>
        </li>
        <li>
          <Card aria-label={`Revenue per lead: ${formatCurrency(avgRevenuePerLead)} average across all cohorts`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Revenue per lead</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums" aria-hidden="true">{formatCurrency(avgRevenuePerLead)}</div>
              <p className="text-xs text-muted-foreground m-0" aria-hidden="true">
                Average across all cohorts
              </p>
            </CardContent>
          </Card>
        </li>
      </motion.ul>

      {/* Retention Heatmap Table */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" aria-hidden="true" />
              Retention curves
            </CardTitle>
            <CardDescription>
              Percentage of each cohort still active (created deals) after N weeks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table aria-label="Retention rates by cohort and week">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">Cohort</TableHead>
                    <TableHead className="text-right min-w-[60px]">Size</TableHead>
                    {weekColumns.map((w) => (
                      <TableHead key={w} className="text-center min-w-[60px]">
                        Wk <span className="tabular-nums">{w}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((cohort) => {
                    const retentionMap = new Map(
                      cohort.retention.map((r) => [r.week, r])
                    );
                    return (
                      <TableRow key={cohort.cohortDate}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {cohort.label}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="tabular-nums" aria-label={`${cohort.signups} signups`}>{cohort.signups}</Badge>
                        </TableCell>
                        {weekColumns.map((w) => {
                          const point = retentionMap.get(w);
                          const rate = point?.rate ?? 0;
                          return (
                            <TableCell key={w} className="text-center p-1" aria-label={point ? `Week ${w}: ${pct(rate)} retained` : `Week ${w}: no data`}>
                              {point ? (
                                <span
                                  aria-hidden="true"
                                  className={`inline-block px-2 py-1 rounded text-xs font-medium tabular-nums ${getRetentionColor(rate)}`}
                                >
                                  {pct(rate)}
                                </span>
                              ) : (
                                <span aria-hidden="true" className="text-muted-foreground text-xs">-</span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Revenue & Conversion by Cohort */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" aria-hidden="true" />
              Revenue and conversion by cohort
            </CardTitle>
            <CardDescription>
              Revenue, deals closed, and conversion rates per signup cohort
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table aria-label="Revenue and conversion by cohort">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Contacted</TableHead>
                    <TableHead className="text-right">Contact rate</TableHead>
                    <TableHead className="text-right">Converted</TableHead>
                    <TableHead className="text-right">Conv. rate</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Rev/lead</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((cohort) => (
                    <TableRow key={cohort.cohortDate}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {cohort.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{cohort.totalLeads}</TableCell>
                      <TableCell className="text-right tabular-nums">{cohort.contacted}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`tabular-nums ${
                            cohort.contactRate >= 0.5
                              ? "text-acr-pos"
                              : cohort.contactRate >= 0.3
                                ? "text-acr-warn"
                                : "text-acr-neg"
                          }`}
                        >
                          {pct(cohort.contactRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{cohort.converted}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`tabular-nums ${
                            cohort.conversionRate >= 0.1
                              ? "text-acr-pos"
                              : cohort.conversionRate >= 0.05
                                ? "text-acr-warn"
                                : "text-acr-neg"
                          }`}
                        >
                          {pct(cohort.conversionRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(cohort.revenue)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cohort.totalLeads > 0
                          ? formatCurrency(cohort.revenue / cohort.totalLeads)
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
