import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { 
  DollarSign, 
  TrendingUp, 
  Percent, 
  FileText, 
  AlertTriangle, 
  Clock, 
  CheckCircle,
  BarChart3,
  Calendar,
  Bell,
  Shield,
  AlertCircle,
  Info,
  X,
  Scan,
  MapPin,
  Gavel,
  Leaf,
  Building,
  Receipt
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

interface PortfolioSummary {
  totalNotes: number;
  activeNotes: number;
  totalPortfolioValue: number;
  totalMonthlyPayment: number;
  totalOriginalPrincipal: number;
  averageInterestRate: number;
  statusBreakdown: { status: string; count: number; value: number }[];
}

interface DelinquencyData {
  delinquencyRate: number;
  atRiskAmount: number;
  totalDelinquentNotes: number;
  agingBuckets: {
    current: { count: number; value: number };
    days30: { count: number; value: number };
    days60: { count: number; value: number };
    days90Plus: { count: number; value: number };
  };
  totalPrincipalCollected: number;
  totalInterestCollected: number;
  monthlyBreakdown: { month: string; principal: number; interest: number }[];
}

interface ProjectionsData {
  totalInvested: number;
  totalCollected: number;
  totalInterestEarned: number;
  annualYield: number;
  cashOnCashReturn: number;
  projectedIncome: { month: string; expectedPayments: number; principal: number; interest: number }[];
  amortizationSummary: {
    totalExpectedInterest: number;
    totalPaymentsRemaining: number;
    activeNotes: number;
  };
}

interface PortfolioAlert {
  id: number;
  organizationId: number;
  propertyId: number | null;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  recommendedAction?: string;
  metadata?: Record<string, any>;
  status: string;
  createdAt: string;
  property?: {
    id: number;
    parcelNumber?: string;
    county?: string;
    state?: string;
  };
}

interface ComplianceRule {
  id: number;
  state: string;
  county?: string;
  ruleType: string;
  ruleName: string;
  ruleDescription?: string;
  isActive: boolean;
}

interface ComplianceCheck {
  id: number;
  propertyId: number;
  ruleId: number;
  status: string;
  checkDescription?: string;
  findings?: {
    isCompliant: boolean;
    issues?: string[];
    requiredActions?: string[];
  };
}

const ALERT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tax_due: Receipt,
  market_change: TrendingUp,
  competitor_activity: Building,
  maintenance: AlertTriangle,
  document_expiring: FileText,
  compliance: Shield,
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-acr-neg-soft dark:bg-acr-neg-soft", text: "text-acr-neg-soft-ink dark:text-acr-neg-soft-ink", border: "border-acr-neg/30 dark:border-acr-neg/30" },
  high: { bg: "bg-acr-warn-soft dark:bg-acr-warn-soft", text: "text-acr-warn-soft-ink dark:text-acr-warn-soft-ink", border: "border-acr-warn/30 dark:border-acr-warn/30" },
  medium: { bg: "bg-acr-warn-soft dark:bg-acr-warn-soft", text: "text-acr-warn-soft-ink dark:text-acr-warn-soft-ink", border: "border-acr-warn/30 dark:border-acr-warn/30" },
  low: { bg: "bg-acr-brand-soft", text: "text-acr-brand-soft-ink", border: "border-acr-brand/30" },
};

// Theme-respondent status colors. CSS variables resolve at render so charts
// re-tint when the user switches themes.
const STATUS_COLORS: Record<string, string> = {
  active: "var(--acr-pos)",
  paid_off: "var(--acr-brand)",
  defaulted: "var(--acr-neg)",
  pending: "var(--acr-warn)",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paid_off: "Paid off",
  defaulted: "Defaulted",
  pending: "Pending",
};

// P1 money-precision: canonical usd() preserves cents; portfolio dashboards
// hide cents on display via { noCents: true } since these are aggregate roll-ups.
function formatCurrency(value: number): string {
  return usd(value, { noCents: true });
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

// `embedded` — mounted inside the /money door's Portfolio tab (money.tsx),
// which already renders the app shell. See PageShellProps.embedded (T0-9).
export default function PortfolioPage({ embedded = false }: { embedded?: boolean }) {
  useDocumentTitle("Portfolio analytics");
  // Parent page (money.tsx) owns the H1 when embedded.
  const HeadingTag = embedded ? ("h2" as const) : ("h1" as const);
  const [pendingDismiss, setPendingDismiss] = useState<PortfolioAlert | null>(null);
  const { data: summary, isLoading: summaryLoading, isError: summaryError, error: summaryErrorObj, isFetching: summaryFetching, refetch: refetchSummary } = useQuery<PortfolioSummary>({
    queryKey: ["/api/finance/portfolio-summary"],
    queryFn: async () => {
      const res = await fetch("/api/finance/portfolio-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio summary");
      return res.json();
    },
  });

  const { data: delinquency, isLoading: delinquencyLoading, isError: delinquencyError, error: delinquencyErrorObj, isFetching: delinquencyFetching, refetch: refetchDelinquency } = useQuery<DelinquencyData>({
    queryKey: ["/api/finance/delinquency"],
    queryFn: async () => {
      const res = await fetch("/api/finance/delinquency", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delinquency data");
      return res.json();
    },
  });

  const { data: projections, isLoading: projectionsLoading, isError: projectionsError, error: projectionsErrorObj, isFetching: projectionsFetching, refetch: refetchProjections } = useQuery<ProjectionsData>({
    queryKey: ["/api/finance/projections"],
    queryFn: async () => {
      const res = await fetch("/api/finance/projections", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projections");
      return res.json();
    },
  });

  const { data: alerts, isLoading: alertsLoading, isError: alertsError, error: alertsErrorObj, isFetching: alertsFetching, refetch: refetchAlerts } = useQuery<PortfolioAlert[]>({
    queryKey: ["/api/ai/portfolio/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/ai/portfolio/alerts?status=active", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
  });

  const { data: complianceRules, isLoading: rulesLoading, isError: rulesError, error: rulesErrorObj, isFetching: rulesFetching, refetch: refetchRules } = useQuery<ComplianceRule[]>({
    queryKey: ["/api/ai/compliance/rules"],
    queryFn: async () => {
      const res = await fetch("/api/ai/compliance/rules", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch compliance rules");
      return res.json();
    },
  });

  const { toast } = useToast();

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/portfolio/scan", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/portfolio/alerts"] });
      const count = data.alertsGenerated || 0;
      toast({
        title: "Portfolio scan complete",
        description: `${count} new alert${count === 1 ? "" : "s"} generated.`,
      });
    },
    onError: () => {
      toast({
        title: "Couldn't scan portfolio",
        description: "Existing alerts are unchanged. Try again or check the system status.",
        variant: "destructive",
      });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await apiRequest("PATCH", `/api/ai/portfolio/alerts/${alertId}`, { action: "dismiss" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/portfolio/alerts"] });
      toast({
        title: "Alert dismissed",
        description: "It will no longer appear in your active alerts.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't dismiss alert",
        description: "The alert is still active. Try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = summaryLoading || delinquencyLoading || projectionsLoading;
  // The summary, delinquency, and projections queries collectively drive the
  // KPI cards and every financial chart on this page. If any of them fail,
  // surface one recoverable error in place of the financial sections rather
  // than rendering empty/zeroed cards that look like real data.
  const financialsError = summaryError || delinquencyError || projectionsError;
  const financialsErrorObj = (summaryErrorObj || delinquencyErrorObj || projectionsErrorObj) as Error | null;
  const financialsFetching = summaryFetching || delinquencyFetching || projectionsFetching;
  const refetchFinancials = () => {
    refetchSummary();
    refetchDelinquency();
    refetchProjections();
  };

  const activeAlerts = alerts?.filter(a => a.status === "active") || [];
  const criticalAlerts = activeAlerts.filter(a => a.severity === "critical").length;
  const highAlerts = activeAlerts.filter(a => a.severity === "high").length;
  const mediumAlerts = activeAlerts.filter(a => a.severity === "medium" || a.severity === "warning").length;
  const lowAlerts = activeAlerts.filter(a => a.severity === "low" || a.severity === "info").length;

  const pieChartData = summary?.statusBreakdown
    .filter(s => s.count > 0)
    .map(s => ({
      name: STATUS_LABELS[s.status] || s.status,
      value: s.count,
      color: STATUS_COLORS[s.status] || "var(--muted-foreground)",
    })) || [];

  const agingChartData = delinquency ? [
    { bucket: "Current", count: delinquency.agingBuckets.current.count, value: delinquency.agingBuckets.current.value },
    { bucket: "30 Days", count: delinquency.agingBuckets.days30.count, value: delinquency.agingBuckets.days30.value },
    { bucket: "60 Days", count: delinquency.agingBuckets.days60.count, value: delinquency.agingBuckets.days60.value },
    { bucket: "90+ Days", count: delinquency.agingBuckets.days90Plus.count, value: delinquency.agingBuckets.days90Plus.value },
  ] : [];

  return (
    <PageShell label="Portfolio" embedded={embedded}>
        
          <div>
            {/* §1.3: page H1 — dual class + Tailwind utility. */}
            <HeadingTag className="acr-cc-greeting text-hero" data-testid="text-portfolio-title">Portfolio analytics</HeadingTag>
            <p className="text-muted-foreground">Performance metrics and projections for your note portfolio — at a glance.</p>
          </div>

          <section aria-labelledby="portfolio-overview-heading">
            <h2 id="portfolio-overview-heading" className="acr-section-h2 text-section-h2 mb-4">Portfolio overview</h2>
            {financialsError ? (
              <QueryErrorState
                error={financialsErrorObj}
                onRetry={refetchFinancials}
                isRetrying={financialsFetching}
                title="Couldn't load portfolio analytics"
                description="Your notes and payment records are unchanged. Retry to load the financial overview, charts, and projections."
                testId="portfolio-financials-error"
              />
            ) : (
            <dl className="grid grid-cols-1 md:grid-cols-4 gap-4 m-0">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-pos/10">
                      <DollarSign className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Total portfolio value</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums m-0" data-testid="text-total-portfolio-value">
                          {formatCurrency(summary?.totalPortfolioValue || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-pos-soft">
                      <TrendingUp className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Monthly cash flow</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums text-acr-pos m-0" data-testid="text-monthly-cashflow">
                          {formatCurrency(summary?.totalMonthlyPayment || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-brand-soft">
                      <Percent className="w-5 h-5 text-acr-brand" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Avg interest rate</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums m-0" data-testid="text-avg-interest-rate">
                          {formatPercent(summary?.averageInterestRate || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <FileText className="w-5 h-5 text-primary" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Active notes</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums m-0" data-testid="text-active-notes-count">
                          {summary?.activeNotes || 0}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </dl>
            )}
          </section>

          <section data-testid="section-portfolio-alerts">
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    <CardTitle className="acr-section-h2 text-section-h2">Portfolio alerts</CardTitle>
                    {!alertsLoading && activeAlerts.length > 0 && (
                      <Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft dark:text-acr-neg-soft-ink" aria-live="polite" aria-label={`${activeAlerts.length} active alert${activeAlerts.length === 1 ? "" : "s"}`}>
                        <span className="tabular-nums">{activeAlerts.length}</span> active
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => scanMutation.mutate()}
                    disabled={scanMutation.isPending}
                    data-testid="button-scan-portfolio"
                    aria-label="Scan portfolio for new alerts"
                  >
                    <Scan className="w-4 h-4 mr-2" aria-hidden="true" />
                    {scanMutation.isPending ? "Scanning…" : "Scan portfolio"}
                  </Button>
                </div>
                <CardDescription>Active alerts and issues requiring attention across your portfolio.</CardDescription>
              </CardHeader>
              <CardContent>
                {alertsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : alertsError ? (
                  <QueryErrorState
                    error={alertsErrorObj as Error}
                    onRetry={() => refetchAlerts()}
                    isRetrying={alertsFetching}
                    compact
                    title="Couldn't load alerts"
                    description="Your portfolio alerts couldn't be loaded. Try again."
                    testId="portfolio-alerts-error"
                  />
                ) : activeAlerts.length === 0 ? (
                  /* Canonical EmptyState — celebratory tone for a healthy zero state. */
                  // TODO(cta): "View dismissed alerts" filter could go here when dismissal history ships.
                  <EmptyState
                    icon={CheckCircle}
                    headline="No active alerts"
                    subtitle="Your portfolio is looking healthy. Run a portfolio scan above to check for new issues."
                    tone="celebratory"
                    cta={{ label: "", _noOp: true }}
                    actionIcon={null}
                  />
                ) : (
                  <div className="space-y-3">
                    <ul className="flex flex-wrap gap-2 mb-4 list-none p-0 m-0" aria-label="Alerts by severity">
                      {criticalAlerts > 0 && (
                        <li><Badge className="bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft dark:text-acr-neg-soft-ink" aria-label={`${criticalAlerts} critical alert${criticalAlerts === 1 ? "" : "s"}`}>
                          <AlertCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                          <span className="tabular-nums">{criticalAlerts}</span> critical
                        </Badge></li>
                      )}
                      {highAlerts > 0 && (
                        <li><Badge className="bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink" aria-label={`${highAlerts} high-severity alert${highAlerts === 1 ? "" : "s"}`}>
                          <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />
                          <span className="tabular-nums">{highAlerts}</span> high
                        </Badge></li>
                      )}
                      {mediumAlerts > 0 && (
                        <li><Badge className="bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink" aria-label={`${mediumAlerts} medium-severity alert${mediumAlerts === 1 ? "" : "s"}`}>
                          <Info className="w-3 h-3 mr-1" aria-hidden="true" />
                          <span className="tabular-nums">{mediumAlerts}</span> medium
                        </Badge></li>
                      )}
                      {lowAlerts > 0 && (
                        <li><Badge className="bg-acr-brand-soft text-acr-brand-soft-ink" aria-label={`${lowAlerts} low-severity alert${lowAlerts === 1 ? "" : "s"}`}>
                          <Info className="w-3 h-3 mr-1" aria-hidden="true" />
                          <span className="tabular-nums">{lowAlerts}</span> low
                        </Badge></li>
                      )}
                    </ul>
                    <ul className="space-y-3 list-none p-0 m-0" aria-label="Active portfolio alerts">
                      {activeAlerts.slice(0, 5).map((alert) => {
                        const AlertIcon = ALERT_TYPE_ICONS[alert.alertType] || AlertTriangle;
                        const severityStyle = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.medium;
                        return (
                          <li
                            key={alert.id}
                            className={`p-4 rounded-card border ${severityStyle.bg} ${severityStyle.border}`}
                            data-testid={`alert-item-${alert.id}`}
                            role={alert.severity === "critical" ? "alert" : undefined}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <div className={`p-2 rounded-card ${severityStyle.bg}`}>
                                  <AlertIcon className={`w-4 h-4 ${severityStyle.text}`} aria-hidden="true" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className={`font-medium ${severityStyle.text}`}>{alert.title}</h4>
                                    <Badge variant="outline" className={`text-xs ${severityStyle.text} ${severityStyle.border}`} aria-label={`Severity: ${alert.severity}`}>
                                      {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                                  {alert.property && (
                                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                                      <MapPin className="w-3 h-3" aria-hidden="true" />
                                      <span>{alert.property.county}, {alert.property.state}</span>
                                      {alert.property.parcelNumber && (
                                        <span className="ml-1">({alert.property.parcelNumber})</span>
                                      )}
                                    </div>
                                  )}
                                  {alert.recommendedAction && (
                                    <div className="mt-2 p-2 rounded bg-muted/50">
                                      <p className="text-xs font-medium">Recommended action:</p>
                                      <p className="text-xs text-muted-foreground">{alert.recommendedAction}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setPendingDismiss(alert)}
                                disabled={dismissMutation.isPending}
                                aria-label={`Dismiss ${alert.severity} alert: ${alert.title}`}
                                data-testid={`button-dismiss-alert-${alert.id}`}
                              >
                                <X className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {activeAlerts.length > 5 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">
                        And <span className="tabular-nums">{activeAlerts.length - 5}</span> more alert{activeAlerts.length - 5 === 1 ? "" : "s"}…
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section data-testid="section-compliance-dashboard">
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="acr-section-h2 text-section-h2">Compliance dashboard</CardTitle>
                </div>
                <CardDescription>Overview of compliance rules and property compliance status.</CardDescription>
              </CardHeader>
              <CardContent>
                {rulesLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="status" aria-label="Loading compliance rules">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : rulesError ? (
                  <QueryErrorState
                    error={rulesErrorObj as Error}
                    onRetry={() => refetchRules()}
                    isRetrying={rulesFetching}
                    compact
                    title="Couldn't load compliance rules"
                    description="The compliance dashboard couldn't load. Try again."
                    testId="portfolio-compliance-error"
                  />
                ) : (
                  <>
                    <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 m-0">
                      <div className="p-4 rounded-card bg-muted/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Gavel className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                          <dt className="text-sm text-muted-foreground">Total rules</dt>
                        </div>
                        <dd className="text-2xl font-bold tabular-nums m-0" data-testid="text-total-rules">
                          {complianceRules?.length || 0}
                        </dd>
                      </div>
                      <div className="p-4 rounded-card bg-acr-pos-soft dark:bg-acr-pos-soft">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                          <dt className="text-sm text-muted-foreground">Active rules</dt>
                        </div>
                        <dd className="text-2xl font-bold tabular-nums text-acr-pos m-0" data-testid="text-active-rules">
                          {complianceRules?.filter(r => r.isActive).length || 0}
                        </dd>
                      </div>
                      <div className="p-4 rounded-card bg-acr-brand-soft">
                        <div className="flex items-center gap-2 mb-2">
                          <Leaf className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                          <dt className="text-sm text-muted-foreground">Rule types</dt>
                        </div>
                        <dd className="text-2xl font-bold tabular-nums text-acr-brand m-0" data-testid="text-rule-types">
                          {new Set(complianceRules?.map(r => r.ruleType)).size || 0}
                        </dd>
                      </div>
                    </dl>
                    {complianceRules && complianceRules.length > 0 ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium mb-3">Rule-types breakdown</h4>
                        <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                          {Array.from(new Set(complianceRules.map(r => r.ruleType))).map(type => {
                            const count = complianceRules.filter(r => r.ruleType === type).length;
                            return (
                              <li key={type}>
                                <Badge variant="secondary" data-testid={`badge-rule-type-${type}`} aria-label={`${type.charAt(0).toUpperCase() + type.slice(1)}: ${count} rule${count === 1 ? "" : "s"}`}>
                                  {type.charAt(0).toUpperCase() + type.slice(1)}: <span className="tabular-nums ml-1">{count}</span>
                                </Badge>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground" role="status">
                        <Shield className="w-10 h-10 mb-2 opacity-50" aria-hidden="true" />
                        <p className="text-sm">No compliance rules configured yet.</p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="acr-section-h2 text-section-h2">Portfolio by status</CardTitle>
                </div>
                <CardDescription>Sorted by count, largest first.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-64 flex items-center justify-center" role="status" aria-label="Loading status chart">
                    <div className="w-full space-y-2 px-2">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-5 w-1/3" />
                    </div>
                  </div>
                ) : pieChartData.length > 0 ? (
                  <div
                    className="h-64"
                    data-testid="chart-status-pie"
                    role="img"
                    aria-label={`Notes by status, sorted by count descending: ${[...pieChartData].sort((a,b) => b.value - a.value).map(d => `${d.name} ${d.value}`).join(", ")}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[...pieChartData].sort((a, b) => b.value - a.value)}
                        layout="vertical"
                        margin={{ top: 4, right: 36, bottom: 4, left: 8 }}
                        accessibilityLayer
                      >
                        <XAxis
                          type="number"
                          hide
                          domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.1)]}
                        />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={96}
                          tick={{ fontSize: 12, fill: 'var(--acr-ink-2)' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          cursor={{ fill: 'var(--acr-line-soft)' }}
                          formatter={(value: any) => [value, 'Notes']}
                        />
                        <Bar
                          dataKey="value"
                          fill="var(--acr-brand)"
                          radius={[0, 2, 2, 0]}
                          label={{
                            position: 'right',
                            fill: 'var(--acr-ink-2)',
                            fontSize: 12,
                            className: 'tabular-nums',
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground" role="status">
                    No notes to display.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="acr-section-h2 text-section-h2">Delinquency metrics</CardTitle>
                </div>
                <CardDescription>Payment status and risk analysis.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4" role="status" aria-label="Loading delinquency data">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <dl className="grid grid-cols-2 gap-4 m-0">
                      <div className="p-4 rounded-card bg-muted/50">
                        <dt className="text-sm text-muted-foreground">Delinquency rate</dt>
                        <dd className="text-2xl font-bold font-mono tabular-nums m-0" data-testid="text-delinquency-rate">
                          {formatPercent(delinquency?.delinquencyRate || 0)}
                        </dd>
                      </div>
                      <div className="p-4 rounded-card bg-muted/50">
                        <dt className="text-sm text-muted-foreground">At-risk amount</dt>
                        <dd className="text-2xl font-bold tabular-nums text-acr-neg m-0" data-testid="text-at-risk-amount">
                          {formatCurrency(delinquency?.atRiskAmount || 0)}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <p className="text-sm font-medium mb-2">Aging buckets</p>
                      <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Notes by aging bucket">
                        <li><Badge variant="secondary" className="bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft dark:text-acr-pos-soft-ink" aria-label={`Current: ${delinquency?.agingBuckets.current.count || 0}`}>
                          <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                          Current: <span className="tabular-nums ml-1">{delinquency?.agingBuckets.current.count || 0}</span>
                        </Badge></li>
                        <li><Badge variant="secondary" className="bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink" aria-label={`30 days late: ${delinquency?.agingBuckets.days30.count || 0}`}>
                          <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                          30 days: <span className="tabular-nums ml-1">{delinquency?.agingBuckets.days30.count || 0}</span>
                        </Badge></li>
                        <li><Badge variant="secondary" className="bg-acr-warn-soft text-acr-warn-soft-ink dark:bg-acr-warn-soft dark:text-acr-warn-soft-ink" aria-label={`60 days late: ${delinquency?.agingBuckets.days60.count || 0}`}>
                          <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                          60 days: <span className="tabular-nums ml-1">{delinquency?.agingBuckets.days60.count || 0}</span>
                        </Badge></li>
                        <li><Badge variant="secondary" className="bg-acr-neg-soft text-acr-neg-soft-ink dark:bg-acr-neg-soft dark:text-acr-neg-soft-ink" aria-label={`90+ days late: ${delinquency?.agingBuckets.days90Plus.count || 0}`}>
                          <AlertTriangle className="w-3 h-3 mr-1" aria-hidden="true" />
                          90+ days: <span className="tabular-nums ml-1">{delinquency?.agingBuckets.days90Plus.count || 0}</span>
                        </Badge></li>
                      </ul>
                    </div>
                    <div
                      data-testid="chart-aging-buckets"
                      className="h-40"
                      role="img"
                      aria-label={`Aging buckets bar chart: ${agingChartData.map(d => `${d.bucket} ${formatCurrency(d.value)}`).join(", ")}`}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={agingChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={((value: number) => formatCurrency(value)) as any} />
                          <Bar dataKey="value" fill="var(--acr-brand)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <section aria-labelledby="principal-interest-heading">
            <h2 id="principal-interest-heading" className="acr-section-h2 text-section-h2 mb-4">Principal vs interest breakdown</h2>
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="acr-section-h2 text-section-h2">Monthly collections (last 12 months)</CardTitle>
                </div>
                <CardDescription>Breakdown of principal and interest payments received.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div
                    className="h-64"
                    data-testid="chart-principal-interest"
                    role="img"
                    aria-label={`Monthly collections bar chart: ${(delinquency?.monthlyBreakdown || []).slice(-3).map(m => `${m.month} principal ${formatCurrency(m.principal)} interest ${formatCurrency(m.interest)}`).join("; ")}${(delinquency?.monthlyBreakdown?.length || 0) > 3 ? "; more months in chart" : ""}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={delinquency?.monthlyBreakdown || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={((value: number) => formatCurrency(value)) as any} />
                        <Legend />
                        <Bar dataKey="principal" name="Principal" stackId="a" fill="var(--acr-brand)" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="interest" name="Interest" stackId="a" fill="var(--acr-pos)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <dl className="flex justify-center gap-8 mt-4 text-sm m-0">
                  <div>
                    <dt className="text-muted-foreground inline">Total principal collected: </dt>
                    <dd className="font-mono font-semibold tabular-nums inline m-0" data-testid="text-total-principal-collected">
                      {formatCurrency(delinquency?.totalPrincipalCollected || 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground inline">Total interest collected: </dt>
                    <dd className="font-mono font-semibold tabular-nums text-acr-pos inline m-0" data-testid="text-total-interest-collected">
                      {formatCurrency(delinquency?.totalInterestCollected || 0)}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="cash-on-cash-heading">
            <h2 id="cash-on-cash-heading" className="acr-section-h2 text-section-h2 mb-4">Cash-on-cash & ROI</h2>
            <dl className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 m-0">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-brand-soft">
                      <DollarSign className="w-5 h-5 text-acr-brand" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Total invested</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums m-0" data-testid="text-total-invested">
                          {formatCurrency(projections?.totalInvested || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-pos/10">
                      <TrendingUp className="w-5 h-5 text-acr-pos" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Total collected</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold font-mono tabular-nums text-acr-pos m-0" data-testid="text-total-collected">
                          {formatCurrency(projections?.totalCollected || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-brand-soft">
                      <Percent className="w-5 h-5 text-acr-brand" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Annual yield</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold tabular-nums m-0" data-testid="text-annual-yield">
                          {formatPercent(projections?.annualYield || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-acr-warn/10">
                      <TrendingUp className="w-5 h-5 text-acr-warn" aria-hidden="true" />
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Cash-on-cash return</dt>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <dd className="text-2xl font-bold tabular-nums m-0" data-testid="text-cash-on-cash">
                          {formatPercent(projections?.cashOnCashReturn || 0)}
                        </dd>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </dl>
          </section>

          <section aria-labelledby="projected-income-heading">
            <h2 id="projected-income-heading" className="acr-section-h2 text-section-h2 mb-4">Projected income (next 12 months)</h2>
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="acr-section-h2 text-section-h2">Income projections</CardTitle>
                </div>
                <CardDescription>Expected principal and interest payments based on current active notes.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div
                    className="h-64"
                    data-testid="chart-projected-income"
                    role="img"
                    aria-label={`Projected income area chart: ${(projections?.projectedIncome || []).slice(0, 3).map(m => `${m.month} principal ${formatCurrency(m.principal)} interest ${formatCurrency(m.interest)}`).join("; ")}${(projections?.projectedIncome?.length || 0) > 3 ? "; more months in chart" : ""}`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={projections?.projectedIncome || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={((value: number) => formatCurrency(value)) as any} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="principal"
                          name="Principal"
                          stackId="1"
                          stroke="var(--acr-brand)"
                          fill="var(--acr-brand)"
                          fillOpacity={0.6}
                        />
                        <Area
                          type="monotone"
                          dataKey="interest"
                          name="Interest"
                          stackId="1"
                          stroke="var(--acr-pos)"
                          fill="var(--acr-pos)"
                          fillOpacity={0.6}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="amortization-summary-heading">
            <h2 id="amortization-summary-heading" className="acr-section-h2 text-section-h2 mb-4">Amortization summary</h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 m-0">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <dt className="text-sm text-muted-foreground">Active notes</dt>
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mt-1" />
                  ) : (
                    <dd className="text-2xl font-bold tabular-nums m-0" data-testid="text-amort-active-notes">
                      {projections?.amortizationSummary.activeNotes || 0}
                    </dd>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <dt className="text-sm text-muted-foreground">Payments remaining</dt>
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mt-1" />
                  ) : (
                    <dd className="text-2xl font-bold tabular-nums m-0" data-testid="text-payments-remaining">
                      {projections?.amortizationSummary.totalPaymentsRemaining || 0}
                    </dd>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <dt className="text-sm text-muted-foreground">Expected interest remaining</dt>
                  {isLoading ? (
                    <Skeleton className="h-8 w-24 mt-1" />
                  ) : (
                    <dd className="text-2xl font-bold font-mono tabular-nums text-acr-pos m-0" data-testid="text-expected-interest">
                      {formatCurrency(projections?.amortizationSummary.totalExpectedInterest || 0)}
                    </dd>
                  )}
                </CardContent>
              </Card>
            </dl>
          </section>

          <ConfirmDialog
            open={!!pendingDismiss}
            onOpenChange={(open) => { if (!open) setPendingDismiss(null); }}
            title={`Dismiss ${pendingDismiss?.severity || ""} alert?`}
            description={pendingDismiss ? `"${pendingDismiss.title}" will be removed from your active alerts. The underlying issue isn't resolved by dismissing — it just stops appearing here.` : ""}
            confirmLabel="Dismiss alert"
            onConfirm={() => {
              if (pendingDismiss) dismissMutation.mutate(pendingDismiss.id);
              setPendingDismiss(null);
            }}
          />
    </PageShell>
  );
}
