import { PageShell } from "@/components/page-shell";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  DollarSign,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  BarChart3,
  Target,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Briefcase,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InfoTooltip } from "@/components/info-tooltip";

interface ExecutiveMetricsRaw {
  mrr?: number;
  arr?: number;
  mrrChange?: number;
  activeOrgs?: number;
  totalOrgs?: number;
  newOrgsLast30?: number;
  tierBreakdown?: Record<string, number>;
  totalLeads?: number;
  totalProperties?: number;
  totalDeals?: number;
  totalNotes?: number;
  newLeadsLast7?: number;
  newDealsLast7?: number;
  recentSignups?: Array<unknown>;
  // Legacy/optional fields
  activeOrganizations?: number;
  totalOrganizations?: number;
  newOrgsLast30Days?: number;
  churnRate?: number;
  churnedOrgsLast30Days?: number;
  arpu?: number;
  platformUsage?: {
    totalLeads?: number;
    totalProperties?: number;
    totalDeals?: number;
  };
  nps?: {
    score?: number;
    average?: number;
    responseCount?: number;
    promoters?: number;
    passives?: number;
    detractors?: number;
  };
}

interface ExecutiveMetrics {
  mrr: number;
  activeOrganizations: number;
  totalOrganizations: number;
  newOrgsLast30Days: number;
  churnRate: number;
  churnedOrgsLast30Days: number;
  arpu: number;
  tierBreakdown: Record<string, number>;
  platformUsage: {
    totalLeads: number;
    totalProperties: number;
    totalDeals: number;
  };
  nps: {
    score: number;
    average: number;
    responseCount: number;
    promoters: number;
    passives: number;
    detractors: number;
  };
}

function normalizeMetrics(raw: ExecutiveMetricsRaw): ExecutiveMetrics {
  const totalOrgs = raw.totalOrganizations ?? raw.totalOrgs ?? 0;
  const activeOrgs = raw.activeOrganizations ?? raw.activeOrgs ?? 0;
  const arpu = raw.arpu ?? (activeOrgs > 0 ? (raw.mrr ?? 0) / activeOrgs : 0);
  return {
    mrr: raw.mrr ?? 0,
    activeOrganizations: activeOrgs,
    totalOrganizations: totalOrgs,
    newOrgsLast30Days: raw.newOrgsLast30Days ?? raw.newOrgsLast30 ?? 0,
    churnRate: raw.churnRate ?? 0,
    churnedOrgsLast30Days: raw.churnedOrgsLast30Days ?? 0,
    arpu,
    tierBreakdown: raw.tierBreakdown ?? {},
    platformUsage: {
      totalLeads: raw.platformUsage?.totalLeads ?? raw.totalLeads ?? 0,
      totalProperties: raw.platformUsage?.totalProperties ?? raw.totalProperties ?? 0,
      totalDeals: raw.platformUsage?.totalDeals ?? raw.totalDeals ?? 0,
    },
    nps: {
      score: raw.nps?.score ?? 0,
      average: raw.nps?.average ?? 0,
      responseCount: raw.nps?.responseCount ?? 0,
      promoters: raw.nps?.promoters ?? 0,
      passives: raw.nps?.passives ?? 0,
      detractors: raw.nps?.detractors ?? 0,
    },
  };
}

function useExecutiveDashboard() {
  return useQuery<ExecutiveMetrics>({
    queryKey: ["/api/founder/executive-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/founder/executive-dashboard", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch executive dashboard");
      const raw = (await res.json()) as ExecutiveMetricsRaw;
      return normalizeMetrics(raw);
    },
    staleTime: 1000 * 60 * 2,
  });
}

function MetricSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-20 mb-1" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function npsTier(score: number): "excellent" | "good" | "needs improvement" | "critical" {
  if (score >= 50) return "excellent";
  if (score >= 30) return "good";
  if (score >= 0) return "needs improvement";
  return "critical";
}

export default function ExecutiveDashboard() {
  useDocumentTitle("Executive dashboard");
  const { data: metrics, isLoading, isError, error, refetch } =
    useExecutiveDashboard();

  if (isError) {
    return (
      <PageShell label="Executive dashboard">
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  return (
    <PageShell label="Executive dashboard">
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" role="status" aria-live="polite">
          <span className="sr-only">Loading executive dashboard…</span>
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
      ) : !metrics ? (
        <EmptyState
          icon={BarChart3}
          headline="No metrics available"
          subtitle="Metrics will appear once the platform has active organizations."
          // TODO(cta): founder-only executive dashboard — metrics are system-aggregated; no direct user action
          cta={{ label: "", _noOp: true }}
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Revenue Metrics */}
          <section aria-labelledby="section-revenue">
            <h2 id="section-revenue" className="text-lg font-semibold mb-3 text-foreground">
              Revenue
            </h2>
            <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Monthly Revenue" explanation="The total recurring revenue from all paying customers this month">MRR</InfoTooltip></dt>
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {usd(metrics.mrr, { noCents: true })}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Monthly recurring revenue
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Revenue Per Customer" explanation="Average monthly revenue divided by number of active customers">ARPU</InfoTooltip></dt>
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {usd(metrics.arpu, { noCents: true })}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Average revenue per user, monthly
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Churn Rate" explanation="Percentage of customers who cancelled or downgraded in the last 30 days. Lower is better.">Churn rate</InfoTooltip></dt>
                    </CardTitle>
                    <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {metrics.churnRate}%
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{metrics.churnedOrgsLast30Days}</span> org{metrics.churnedOrgsLast30Days === 1 ? "" : "s"} churned in the last 30 days
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Tier breakdown</dt>
                    </CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd>
                      <ul className="flex flex-wrap gap-1.5" aria-label="Organizations by tier">
                        {Object.entries(metrics.tierBreakdown).map(
                          ([tier, tierCount]) => (
                            <li key={tier}>
                              <Badge
                                variant="secondary"
                                className="text-xs capitalize"
                                aria-label={`${tier} tier: ${tierCount} organization${tierCount === 1 ? "" : "s"}`}
                              >
                                {tier}: <span className="tabular-nums ml-1">{tierCount}</span>
                              </Badge>
                            </li>
                          )
                        )}
                      </ul>
                    </dd>
                  </CardContent>
                </Card>
              </motion.div>
            </dl>
          </section>

          {/* Organization Metrics */}
          <section aria-labelledby="section-orgs">
            <h2 id="section-orgs" className="text-lg font-semibold mb-3 text-foreground">
              Organizations
            </h2>
            <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Active organizations</dt>
                    </CardTitle>
                    <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {formatNumber(metrics.activeOrganizations)}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      of <span className="tabular-nums">{formatNumber(metrics.totalOrganizations)}</span> total
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>New (last 30 days)</dt>
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-acr-pos" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums" aria-label={`Plus ${formatNumber(metrics.newOrgsLast30Days)} new organizations`}>
                      +{formatNumber(metrics.newOrgsLast30Days)}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Organizations signed up in the last 30 days
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Growth rate</dt>
                    </CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {metrics.totalOrganizations > 0
                        ? Math.round(
                            (metrics.newOrgsLast30Days /
                              metrics.totalOrganizations) *
                              100
                          )
                        : 0}
                      %
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      30-day growth rate
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </dl>
          </section>

          {/* Platform Usage */}
          <section aria-labelledby="section-usage">
            <h2 id="section-usage" className="text-lg font-semibold mb-3 text-foreground">
              Platform usage
            </h2>
            <dl className="grid gap-4 md:grid-cols-3">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Total leads</dt>
                    </CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {formatNumber(metrics.platformUsage.totalLeads)}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Across all organizations
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Total properties</dt>
                    </CardTitle>
                    <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {formatNumber(metrics.platformUsage.totalProperties)}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Across all organizations
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt>Total deals</dt>
                    </CardTitle>
                    <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold tabular-nums">
                      {formatNumber(metrics.platformUsage.totalDeals)}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Across all organizations
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </dl>
          </section>

          {/* NPS */}
          <section aria-labelledby="section-nps">
            <h2 id="section-nps" className="text-lg font-semibold mb-3 text-foreground">
              Net promoter score
            </h2>
            <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Customer Satisfaction Score" explanation="Measures how likely customers are to recommend you. Ranges from -100 to 100. Above 50 is excellent.">NPS score</InfoTooltip></dt>
                    </CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd
                      className={`text-2xl font-bold tabular-nums ${
                        metrics.nps.score >= 50
                          ? "text-acr-pos"
                          : metrics.nps.score >= 0
                          ? "text-acr-warn"
                          : "text-acr-neg"
                      }`}
                      aria-label={`NPS score ${metrics.nps.score}, ${npsTier(metrics.nps.score)}`}
                    >
                      {metrics.nps.score}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">{metrics.nps.responseCount}</span> response{metrics.nps.responseCount === 1 ? "" : "s"} · <span className="tabular-nums">{metrics.nps.average}</span> raw average
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Promoters" explanation="Customers who love your product and would recommend it to others (scored 9-10).">Promoters</InfoTooltip></dt>
                    </CardTitle>
                    <ThumbsUp className="h-4 w-4 text-acr-pos" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold text-acr-pos tabular-nums">
                      {metrics.nps.promoters}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Score 9–10
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Passives" explanation="Customers who are satisfied but not enthusiastic. They might switch to a competitor (scored 7-8).">Passives</InfoTooltip></dt>
                    </CardTitle>
                    <Minus className="h-4 w-4 text-acr-warn" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold text-acr-warn tabular-nums">
                      {metrics.nps.passives}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Score 7–8
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <dt><InfoTooltip term="Detractors" explanation="Unhappy customers who may discourage others from using your product (scored 0-6).">Detractors</InfoTooltip></dt>
                    </CardTitle>
                    <ThumbsDown className="h-4 w-4 text-acr-neg" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <dd className="text-2xl font-bold text-acr-neg tabular-nums">
                      {metrics.nps.detractors}
                    </dd>
                    <p className="text-xs text-muted-foreground">
                      Score 0–6
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </dl>
          </section>
        </motion.div>
      )}
    </PageShell>
  );
}
