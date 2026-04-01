import { PageShell } from "@/components/page-shell";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
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

function useExecutiveDashboard() {
  return useQuery<ExecutiveMetrics>({
    queryKey: ["/api/founder/executive-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/founder/executive-dashboard", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch executive dashboard");
      return res.json();
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function ExecutiveDashboard() {
  const { data: metrics, isLoading, isError, error, refetch } =
    useExecutiveDashboard();

  if (isError) {
    return (
      <PageShell title="Executive Dashboard" description="Revenue and growth metrics">
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          entityName="executive dashboard"
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Executive Dashboard"
      description="Founder-only revenue and growth metrics"
    >
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
      ) : !metrics ? (
        <EmptyState
          icon={BarChart3}
          title="No metrics available"
          description="Metrics will appear once the platform has active organizations."
        />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          {/* Revenue Metrics */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-foreground">
              Revenue
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Monthly Revenue" explanation="The total recurring revenue from all paying customers this month">MRR</InfoTooltip>
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(metrics.mrr)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Monthly Recurring Revenue
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Revenue Per Customer" explanation="Average monthly revenue divided by number of active customers">ARPU</InfoTooltip>
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(metrics.arpu)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Avg Revenue Per User
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Churn Rate" explanation="Percentage of customers who cancelled or downgraded in the last 30 days. Lower is better.">Churn Rate</InfoTooltip>
                    </CardTitle>
                    <TrendingDown className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {metrics.churnRate}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {metrics.churnedOrgsLast30Days} orgs churned (30d)
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Tier Breakdown
                    </CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(metrics.tierBreakdown).map(
                        ([tier, tierCount]) => (
                          <Badge key={tier} variant="secondary" className="text-xs">
                            {tier}: {tierCount}
                          </Badge>
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </div>

          {/* Organization Metrics */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-foreground">
              Organizations
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Active Organizations
                    </CardTitle>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(metrics.activeOrganizations)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      of {formatNumber(metrics.totalOrganizations)} total
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      New (30d)
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      +{formatNumber(metrics.newOrgsLast30Days)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      New organizations this month
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Growth Rate
                    </CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {metrics.totalOrganizations > 0
                        ? Math.round(
                            (metrics.newOrgsLast30Days /
                              metrics.totalOrganizations) *
                              100
                          )
                        : 0}
                      %
                    </div>
                    <p className="text-xs text-muted-foreground">
                      30-day growth rate
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </div>

          {/* Platform Usage */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-foreground">
              Platform Usage
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Total Leads
                    </CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(metrics.platformUsage.totalLeads)}
                    </div>
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
                      Total Properties
                    </CardTitle>
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(metrics.platformUsage.totalProperties)}
                    </div>
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
                      Total Deals
                    </CardTitle>
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatNumber(metrics.platformUsage.totalDeals)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Across all organizations
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </div>

          {/* NPS */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-foreground">
              Net Promoter Score
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Customer Satisfaction Score" explanation="Measures how likely customers are to recommend you. Ranges from -100 to 100. Above 50 is excellent.">NPS Score</InfoTooltip>
                    </CardTitle>
                    <Target className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold ${
                        metrics.nps.score >= 50
                          ? "text-emerald-600"
                          : metrics.nps.score >= 0
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {metrics.nps.score}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {metrics.nps.responseCount} responses (avg{" "}
                      {metrics.nps.average})
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Promoters" explanation="Customers who love your product and would recommend it to others (scored 9-10).">Promoters</InfoTooltip>
                    </CardTitle>
                    <ThumbsUp className="h-4 w-4 text-emerald-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-emerald-600">
                      {metrics.nps.promoters}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Score 9-10
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Passives" explanation="Customers who are satisfied but not enthusiastic. They might switch to a competitor (scored 7-8).">Passives</InfoTooltip>
                    </CardTitle>
                    <Minus className="h-4 w-4 text-amber-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-amber-600">
                      {metrics.nps.passives}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Score 7-8
                    </p>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div variants={staggerItem}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <InfoTooltip term="Detractors" explanation="Unhappy customers who may discourage others from using your product (scored 0-6).">Detractors</InfoTooltip>
                    </CardTitle>
                    <ThumbsDown className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">
                      {metrics.nps.detractors}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Score 0-6
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </PageShell>
  );
}
