import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  PieChart as PieChartIcon,
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
  PieChart,
  Pie,
  Cell,
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
  critical: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
  high: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-400", border: "border-orange-200 dark:border-orange-800" },
  medium: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-400", border: "border-yellow-200 dark:border-yellow-800" },
  low: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800" },
};

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  paid_off: "#3b82f6",
  defaulted: "#ef4444",
  pending: "#f59e0b",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paid_off: "Paid Off",
  defaulted: "Defaulted",
  pending: "Pending",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export default function PortfolioPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery<PortfolioSummary>({
    queryKey: ["/api/finance/portfolio-summary"],
    queryFn: async () => {
      const res = await fetch("/api/finance/portfolio-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolio summary");
      return res.json();
    },
  });

  const { data: delinquency, isLoading: delinquencyLoading } = useQuery<DelinquencyData>({
    queryKey: ["/api/finance/delinquency"],
    queryFn: async () => {
      const res = await fetch("/api/finance/delinquency", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch delinquency data");
      return res.json();
    },
  });

  const { data: projections, isLoading: projectionsLoading } = useQuery<ProjectionsData>({
    queryKey: ["/api/finance/projections"],
    queryFn: async () => {
      const res = await fetch("/api/finance/projections", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch projections");
      return res.json();
    },
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery<PortfolioAlert[]>({
    queryKey: ["/api/ai/portfolio/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/ai/portfolio/alerts?status=active", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
  });

  const { data: complianceRules, isLoading: rulesLoading } = useQuery<ComplianceRule[]>({
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
      toast({
        title: "Portfolio Scan Complete",
        description: `Scan complete. ${data.alertsGenerated || 0} new alerts generated.`,
      });
    },
    onError: () => {
      toast({
        title: "Scan Failed",
        description: "Failed to scan portfolio. Please try again.",
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
        title: "Alert Dismissed",
        description: "The alert has been dismissed.",
      });
    },
    onError: () => {
      toast({
        title: "Dismiss Failed",
        description: "Failed to dismiss alert. Please try again.",
        variant: "destructive",
      });
    },
  });

  const isLoading = summaryLoading || delinquencyLoading || projectionsLoading;

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
      color: STATUS_COLORS[s.status] || "#94a3b8",
    })) || [];

  const agingChartData = delinquency ? [
    { bucket: "Current", count: delinquency.agingBuckets.current.count, value: delinquency.agingBuckets.current.value },
    { bucket: "30 Days", count: delinquency.agingBuckets.days30.count, value: delinquency.agingBuckets.days30.value },
    { bucket: "60 Days", count: delinquency.agingBuckets.days60.count, value: delinquency.agingBuckets.days60.value },
    { bucket: "90+ Days", count: delinquency.agingBuckets.days90Plus.count, value: delinquency.agingBuckets.days90Plus.value },
  ] : [];

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-portfolio-title">Portfolio Analytics</h1>
            <p className="text-muted-foreground">Financial performance metrics and projections for your note portfolio.</p>
          </div>

          <section>
            <h2 className="text-xl font-semibold mb-4">Portfolio Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-emerald-500/10">
                      <DollarSign className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Portfolio Value</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold font-mono" data-testid="text-total-portfolio-value">
                          {formatCurrency(summary?.totalPortfolioValue || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-blue-500/10">
                      <TrendingUp className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Monthly Cash Flow</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-monthly-cashflow">
                          {formatCurrency(summary?.totalMonthlyPayment || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-purple-500/10">
                      <Percent className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Avg Interest Rate</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold" data-testid="text-avg-interest-rate">
                          {formatPercent(summary?.averageInterestRate || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-primary/10">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Active Notes</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-16" />
                      ) : (
                        <p className="text-2xl font-bold" data-testid="text-active-notes-count">
                          {summary?.activeNotes || 0}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <section data-testid="section-portfolio-alerts">
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-muted-foreground" />
                    <CardTitle>Portfolio Alerts</CardTitle>
                    {!alertsLoading && activeAlerts.length > 0 && (
                      <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        {activeAlerts.length} Active
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => scanMutation.mutate()}
                    disabled={scanMutation.isPending}
                    data-testid="button-scan-portfolio"
                  >
                    <Scan className="w-4 h-4 mr-2" />
                    {scanMutation.isPending ? "Scanning..." : "Scan Portfolio"}
                  </Button>
                </div>
                <CardDescription>Active alerts and issues requiring attention across your portfolio</CardDescription>
              </CardHeader>
              <CardContent>
                {alertsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : activeAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mb-3 text-emerald-500" />
                    <p className="text-lg font-medium">No Active Alerts</p>
                    <p className="text-sm">Your portfolio is looking healthy. Run a scan to check for new issues.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 mb-4">
                      {criticalAlerts > 0 && (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          {criticalAlerts} Critical
                        </Badge>
                      )}
                      {highAlerts > 0 && (
                        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {highAlerts} High
                        </Badge>
                      )}
                      {mediumAlerts > 0 && (
                        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          <Info className="w-3 h-3 mr-1" />
                          {mediumAlerts} Medium
                        </Badge>
                      )}
                      {lowAlerts > 0 && (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          <Info className="w-3 h-3 mr-1" />
                          {lowAlerts} Low
                        </Badge>
                      )}
                    </div>
                    {activeAlerts.slice(0, 5).map((alert) => {
                      const AlertIcon = ALERT_TYPE_ICONS[alert.alertType] || AlertTriangle;
                      const severityStyle = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.medium;
                      return (
                        <div
                          key={alert.id}
                          className={`p-4 rounded-lg border ${severityStyle.bg} ${severityStyle.border}`}
                          data-testid={`alert-item-${alert.id}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <div className={`p-2 rounded-lg ${severityStyle.bg}`}>
                                <AlertIcon className={`w-4 h-4 ${severityStyle.text}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className={`font-medium ${severityStyle.text}`}>{alert.title}</h4>
                                  <Badge variant="outline" className={`text-xs ${severityStyle.text} ${severityStyle.border}`}>
                                    {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                                {alert.property && (
                                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                                    <MapPin className="w-3 h-3" />
                                    <span>{alert.property.county}, {alert.property.state}</span>
                                    {alert.property.parcelNumber && (
                                      <span className="ml-1">({alert.property.parcelNumber})</span>
                                    )}
                                  </div>
                                )}
                                {alert.recommendedAction && (
                                  <div className="mt-2 p-2 rounded bg-muted/50">
                                    <p className="text-xs font-medium">Recommended Action:</p>
                                    <p className="text-xs text-muted-foreground">{alert.recommendedAction}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => dismissMutation.mutate(alert.id)}
                              disabled={dismissMutation.isPending}
                              data-testid={`button-dismiss-alert-${alert.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {activeAlerts.length > 5 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">
                        And {activeAlerts.length - 5} more alerts...
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
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Compliance Dashboard</CardTitle>
                </div>
                <CardDescription>Overview of compliance rules and property compliance status</CardDescription>
              </CardHeader>
              <CardContent>
                {rulesLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div className="p-4 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Gavel className="w-4 h-4 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Total Rules</p>
                        </div>
                        <p className="text-2xl font-bold" data-testid="text-total-rules">
                          {complianceRules?.length || 0}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="w-4 h-4 text-emerald-600" />
                          <p className="text-sm text-muted-foreground">Active Rules</p>
                        </div>
                        <p className="text-2xl font-bold text-emerald-600" data-testid="text-active-rules">
                          {complianceRules?.filter(r => r.isActive).length || 0}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                        <div className="flex items-center gap-2 mb-2">
                          <Leaf className="w-4 h-4 text-blue-600" />
                          <p className="text-sm text-muted-foreground">Rule Types</p>
                        </div>
                        <p className="text-2xl font-bold text-blue-600" data-testid="text-rule-types">
                          {new Set(complianceRules?.map(r => r.ruleType)).size || 0}
                        </p>
                      </div>
                    </div>
                    {complianceRules && complianceRules.length > 0 ? (
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium mb-3">Rule Types Breakdown</h4>
                        <div className="flex flex-wrap gap-2">
                          {Array.from(new Set(complianceRules.map(r => r.ruleType))).map(type => {
                            const count = complianceRules.filter(r => r.ruleType === type).length;
                            return (
                              <Badge key={type} variant="secondary" data-testid={`badge-rule-type-${type}`}>
                                {type.charAt(0).toUpperCase() + type.slice(1)}: {count}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                        <Shield className="w-10 h-10 mb-2 opacity-50" />
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
                  <PieChartIcon className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Portfolio by Status</CardTitle>
                </div>
                <CardDescription>Distribution of notes by current status</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <Skeleton className="h-48 w-48 rounded-full" />
                  </div>
                ) : pieChartData.length > 0 ? (
                  <div className="h-64" data-testid="chart-status-pie">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {pieChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [value, "Notes"]} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    No notes to display
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Delinquency Metrics</CardTitle>
                </div>
                <CardDescription>Payment status and risk analysis</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">Delinquency Rate</p>
                        <p className="text-2xl font-bold" data-testid="text-delinquency-rate">
                          {formatPercent(delinquency?.delinquencyRate || 0)}
                        </p>
                      </div>
                      <div className="p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">At-Risk Amount</p>
                        <p className="text-2xl font-bold text-red-600" data-testid="text-at-risk-amount">
                          {formatCurrency(delinquency?.atRiskAmount || 0)}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium mb-2">Aging Buckets</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Current: {delinquency?.agingBuckets.current.count || 0}
                        </Badge>
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                          <Clock className="w-3 h-3 mr-1" />
                          30 Days: {delinquency?.agingBuckets.days30.count || 0}
                        </Badge>
                        <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                          <Clock className="w-3 h-3 mr-1" />
                          60 Days: {delinquency?.agingBuckets.days60.count || 0}
                        </Badge>
                        <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          90+ Days: {delinquency?.agingBuckets.days90Plus.count || 0}
                        </Badge>
                      </div>
                    </div>
                    <div data-testid="chart-aging-buckets" className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={agingChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                          <Tooltip formatter={(value: number) => formatCurrency(value)} />
                          <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <section>
            <h2 className="text-xl font-semibold mb-4">Principal vs Interest Breakdown</h2>
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Monthly Collections (Last 12 Months)</CardTitle>
                </div>
                <CardDescription>Breakdown of principal and interest payments received</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="h-64" data-testid="chart-principal-interest">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={delinquency?.monthlyBreakdown || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Legend />
                        <Bar dataKey="principal" name="Principal" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="interest" name="Interest" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex justify-center gap-8 mt-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Total Principal Collected: </span>
                    <span className="font-mono font-semibold" data-testid="text-total-principal-collected">
                      {formatCurrency(delinquency?.totalPrincipalCollected || 0)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Interest Collected: </span>
                    <span className="font-mono font-semibold text-emerald-600" data-testid="text-total-interest-collected">
                      {formatCurrency(delinquency?.totalInterestCollected || 0)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">Cash-on-Cash & ROI</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-blue-500/10">
                      <DollarSign className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Invested</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold font-mono" data-testid="text-total-invested">
                          {formatCurrency(projections?.totalInvested || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-emerald-500/10">
                      <TrendingUp className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Total Collected</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-total-collected">
                          {formatCurrency(projections?.totalCollected || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-purple-500/10">
                      <Percent className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Annual Yield</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold" data-testid="text-annual-yield">
                          {formatPercent(projections?.annualYield || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-amber-500/10">
                      <TrendingUp className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Cash-on-Cash Return</p>
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold" data-testid="text-cash-on-cash">
                          {formatPercent(projections?.cashOnCashReturn || 0)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">Projected Income (Next 12 Months)</h2>
            <Card className="floating-window">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Income Projections</CardTitle>
                </div>
                <CardDescription>Expected principal and interest payments based on current active notes</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="h-64" data-testid="chart-projected-income">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={projections?.projectedIncome || []}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="principal" 
                          name="Principal" 
                          stackId="1" 
                          stroke="#3b82f6" 
                          fill="#3b82f6" 
                          fillOpacity={0.6} 
                        />
                        <Area 
                          type="monotone" 
                          dataKey="interest" 
                          name="Interest" 
                          stackId="1" 
                          stroke="#10b981" 
                          fill="#10b981" 
                          fillOpacity={0.6} 
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4">Amortization Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="glass-panel">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">Active Notes</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold" data-testid="text-amort-active-notes">
                      {projections?.amortizationSummary.activeNotes || 0}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">Payments Remaining</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold" data-testid="text-payments-remaining">
                      {projections?.amortizationSummary.totalPaymentsRemaining || 0}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">Expected Interest Remaining</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-24 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold font-mono text-emerald-600" data-testid="text-expected-interest">
                      {formatCurrency(projections?.amortizationSummary.totalExpectedInterest || 0)}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
