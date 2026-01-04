import { Sidebar } from "@/components/layout-sidebar";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Calendar
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

  const isLoading = summaryLoading || delinquencyLoading || projectionsLoading;

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
