import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { PullToRefresh } from "@/components/mobile";
import { useLeads, useAgingLeads, type AgingLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { usePlaybooks } from "@/hooks/use-playbooks";
import { Users, Map, Banknote, TrendingUp, Activity, Building2, Crown, AlertTriangle, Clock, Flame, Sun, Snowflake, Sparkles, BookOpen, Target, X } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { QueryErrorState } from "@/components/query-error-state";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, FunnelChart, Funnel, LabelList } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingProgress } from "@/components/onboarding";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { ActivityFeed } from "@/components/activity-feed";
import { DashboardSettings, loadSettings, type DashboardWidgetSettings } from "@/components/dashboard-settings";
import { AnomalyAlerts, PredictiveInsights, NextBestActions, TasksDueWidget } from "@/components/dashboard";
import { PlaybookCard } from "@/components/playbooks/PlaybookCard";
import { Link, Redirect } from "wouter";
import { WorkspaceManager } from "@/components/workspace/WorkspaceManager";
import { DailyDealFeed } from "@/components/deal-feed/daily-deal-feed";
import { usd, dollarsCompact } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";

function getUrgencyStyle(urgency: string) {
  switch (urgency) {
    case 'urgent':
      return 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg';
    case 'warning':
      return 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn';
    default:
      return 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent';
  }
}

function getStageIcon(stage: string) {
  switch (stage) {
    case 'hot':
      return <Flame className="w-3 h-3" />;
    case 'warm':
      return <Sun className="w-3 h-3" />;
    default:
      return <Snowflake className="w-3 h-3" />;
  }
}

interface DashboardIntelligence {
  anomalies: Array<{
    id: string;
    type: "positive" | "negative" | "neutral";
    message: string;
    metric: string;
    currentValue: number;
    previousValue: number;
    percentChange: number;
  }>;
  predictions: Array<{
    id: string;
    type: "deals" | "revenue" | "leads";
    title: string;
    message: string;
    currentValue: number;
    projectedValue: number;
    timeframe: string;
    trendData?: { name: string; value: number }[];
  }>;
  actions: Array<{
    id: string;
    type: "follow_up" | "review_offer" | "schedule_call" | "send_mail" | "close_deal";
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    entityType: "lead" | "deal" | "property";
    entityId: number;
    dueInfo?: string;
    actionLabel: string;
    actionUrl: string;
  }>;
  generatedAt: string;
}

export default function Dashboard() {
  useDocumentTitle("Dashboard — AcreOS");
  const queryClient = useQueryClient();
  const { data: organization, isLoading: orgLoading, error: orgError, refetch: refetchOrg } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: agingLeads = [], isLoading: agingLoading } = useAgingLeads();
  const { data: playbooksData, isLoading: playbooksLoading } = usePlaybooks();

  // Onboarding consolidation: the full wizard presents ONLY at the
  // canonical full-screen route (/onboarding-v2). If a not-yet-onboarded
  // user still lands here, we show a single compact "Finish setup" card
  // that links there — never the wizard embedded inline below the
  // dashboard content. Server is the source of truth via the same
  // boolean the /today OnboardingGate reads.
  const { data: onboardingNeed } = useQuery<{ needsOnboarding: boolean }>({
    queryKey: ["/api/me/needs-onboarding"],
    staleTime: 60_000,
  });
  const needsOnboarding = onboardingNeed?.needsOnboarding === true;

  const { data: intelligence, isLoading: intelligenceLoading } = useQuery<DashboardIntelligence>({
    queryKey: ["/api/dashboard/intelligence"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: sparklines } = useQuery<{
    months: string[];
    revenue: number[];
    pipeline: number[];
  }>({
    queryKey: ["/api/dashboard/sparklines?months=6"],
    staleTime: 5 * 60 * 1000,
  });

  const [widgetSettings, setWidgetSettings] = useState<DashboardWidgetSettings>(() => 
    loadSettings(organization)
  );

  // Pull-to-refresh handler - invalidates all dashboard-related queries
  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/intelligence"] }),
    ]);
  }, [queryClient]);

  useMemo(() => {
    if (organization) {
      setWidgetSettings(loadSettings(organization));
    }
  }, [organization]);

  const { data: campaignsData = [] } = useQuery<{ id: number }[]>({
    queryKey: ['/api/campaigns'],
  });
  const [tipDismissed, setTipDismissed] = useState(false);

  const isLoading = orgLoading || statsLoading;

  const pipelineValue = properties
    .filter((p: any) => p.status === "under_contract" || p.status === "listed")
    .reduce((acc: any, p: any) => acc + Number(p.listPrice || 0), 0);

  // Build micro-sparkline data from properties added over last 6 months
  const propertySparkline = useMemo(() => {
    const now = Date.now();
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const cutoff = now - (5 - i) * 30 * 24 * 60 * 60 * 1000;
      return properties.filter((p: any) => {
        const d = p.createdAt ? new Date(p.createdAt).getTime() : 0;
        return d <= cutoff;
      }).length;
    });
    return buckets;
  }, [properties]);

  const leadSparkline = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 6 }, (_, i) => {
      const cutoff = now - (5 - i) * 30 * 24 * 60 * 60 * 1000;
      return leads.filter((l: any) => {
        const d = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        return d <= cutoff;
      }).length;
    });
  }, [leads]);

  // Real monthly aggregates from /api/dashboard/sparklines.
  // No synthetic shape — if the org has no history we get zeros.
  const revenueSparkline = useMemo(() => sparklines?.revenue ?? [], [sparklines]);
  const pipelineSparkline = useMemo(() => sparklines?.pipeline ?? [], [sparklines]);

  const statusData = [
    { name: 'Available', value: properties.filter((p: any) => p.status === 'available' || p.status === 'listed').length, color: 'hsl(16, 70%, 50%)' },
    { name: 'Sold', value: properties.filter((p: any) => p.status === 'sold').length, color: 'hsl(85, 25%, 45%)' },
    { name: 'Contract', value: properties.filter((p: any) => p.status === 'under_contract').length, color: 'hsl(35, 60%, 50%)' },
  ];

  const leadStatusData = [
    { name: 'New', value: leads.filter((l: any) => l.status === 'new').length },
    { name: 'Contacting', value: leads.filter((l: any) => l.status === 'contacting' || l.status === 'mailed').length },
    { name: 'Negotiation', value: leads.filter((l: any) => l.status === 'negotiation' || l.status === 'negotiating').length },
    { name: 'Closed', value: leads.filter((l: any) => l.status === 'closed').length },
  ];

  const container = staggerContainer;
  const item = staggerItem;

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "pro": return "bg-primary/10 text-primary border-primary/20";
      case "scale": return "bg-accent/10 text-accent border-accent/20";
      case "starter": return "bg-primary/10 text-primary border-primary/20";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const isWidgetVisible = (widgetId: string) => widgetSettings.visibility[widgetId] ?? true;

  const renderWidget = (widgetId: string, index: number) => {
    if (!isWidgetVisible(widgetId)) return null;

    switch (widgetId) {
      case "dealFeed":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-primary" aria-hidden="true" />
                  Today's opportunities
                  <Button asChild variant="ghost" size="sm" className="ml-auto text-xs">
                    <Link href="/deal-feed">
                      View all <span className="ml-1" aria-hidden="true">→</span>
                    </Link>
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DailyDealFeed compact />
              </CardContent>
            </Card>
          </motion.div>
        );

      case "stats":
        return (
          <motion.div 
            key={widgetId}
            variants={container}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5"
          >
            <motion.div variants={item}>
              <StatCard
                title="Total properties"
                value={isLoading ? "—" : stats?.activeProperties ?? properties.length}
                icon={Map}
                trend={`${properties.filter((p: any) => p.status === 'owned').length} owned`}
                color="terracotta"
                data-testid="stat-total-properties"
                sparklineData={propertySparkline}
                trendDirection={propertySparkline.length >= 2 && propertySparkline[propertySparkline.length - 1] >= propertySparkline[0] ? "up" : "neutral"}
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Active notes"
                value={isLoading ? "—" : stats?.activeNotes ?? 0}
                icon={Banknote}
                color="sage"
                data-testid="stat-active-notes"
                sparklineData={leadSparkline}
                trendDirection="up"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Monthly cashflow"
                value={isLoading ? "—" : usd(stats?.monthlyRevenue ?? 0, { noCents: true })}
                icon={TrendingUp}
                trend="Projected income"
                data-testid="stat-monthly-cashflow"
                sparklineData={revenueSparkline}
                trendDirection={revenueSparkline.length >= 2 && revenueSparkline[revenueSparkline.length - 1] >= revenueSparkline[0] ? "up" : "down"}
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Pipeline value"
                value={usd(pipelineValue, { noCents: true })}
                icon={Users}
                trend={`${leads.length} leads`}
                color="sand"
                data-testid="stat-pipeline-value"
                sparklineData={pipelineSparkline}
                trendDirection={pipelineValue > 0 ? "up" : "neutral"}
              />
            </motion.div>
          </motion.div>
        );

      case "tasksDue":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <TasksDueWidget />
          </motion.div>
        );

      case "checklist":
        return (
          <div key={widgetId} className="space-y-4">
            <OnboardingProgress />
            <GettingStartedChecklist />
          </div>
        );

      case "intelligence":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
                  Smart intelligence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <AnomalyAlerts
                    anomalies={intelligence?.anomalies || []} 
                    isLoading={intelligenceLoading}
                  />
                  <PredictiveInsights 
                    predictions={intelligence?.predictions || []} 
                    isLoading={intelligenceLoading}
                  />
                  <NextBestActions 
                    actions={intelligence?.actions || []} 
                    isLoading={intelligenceLoading}
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );

      case "playbooks":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window" data-testid="section-playbooks">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BookOpen className="w-5 h-5 text-primary" aria-hidden="true" />
                  Playbooks
                  {playbooksData?.activeInstances && playbooksData.activeInstances.length > 0 && (
                    <Badge variant="outline" className="ml-2 text-xs tabular-nums" data-testid="badge-active-playbooks">
                      {playbooksData.activeInstances.length} active
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {playbooksLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-48 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {playbooksData?.templates.map(({ template, activeInstance }) => (
                      <PlaybookCard
                        key={template.id}
                        template={template}
                        activeInstance={activeInstance}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        );

      case "agingLeads":
        if (agingLeads.length === 0) return null;
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window border-acr-warn-soft dark:border-acr-warn-soft" data-testid="section-aging-leads">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
                  Aging leads
                  <Badge variant="outline" className="ml-2 text-xs tabular-nums" data-testid="badge-aging-count">
                    {agingLeads.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 list-none p-0 m-0" aria-label="Top aging leads">
                  {agingLeads.slice(0, 5).map((lead) => (
                    <li key={lead.id}>
                      <Link
                        href={`/leads?stage=${lead.nurturingStage}`}
                        className="flex items-center justify-between p-3 rounded-md bg-muted/50 hover-elevate cursor-pointer"
                        data-testid={`aging-lead-${lead.id}`}
                        aria-label={`${lead.firstName} ${lead.lastName}, ${lead.nurturingStage} lead, ${lead.daysSinceContact} days since contact`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-sm" data-testid={`text-aging-lead-name-${lead.id}`}>
                              {lead.firstName} {lead.lastName}
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 capitalize">
                              {getStageIcon(lead.nurturingStage)}
                              {lead.nurturingStage} lead
                              {lead.score !== null && <span className="normal-case tabular-nums"> — Score: {lead.score}</span>}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`text-xs border-0 tabular-nums ${getUrgencyStyle(lead.urgency)}`}
                            data-testid={`badge-aging-urgency-${lead.id}`}
                            aria-label={`Urgency: ${lead.urgency}, ${lead.daysSinceContact} days`}
                          >
                            <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                            {lead.daysSinceContact}d
                          </Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {agingLeads.length > 5 && (
                    <li className="block text-center text-sm py-2">
                      <Link href="/leads" className="text-muted-foreground hover:text-foreground">
                        View all <span className="tabular-nums">{agingLeads.length}</span> aging leads
                      </Link>
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        );

      case "activityFeed":
        return (
          <motion.div 
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <ActivityFeed maxHeight="350px" compact />
          </motion.div>
        );

      case "inventoryChart":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-6">Inventory status</h3>
                <div
                  className="h-64"
                  role="img"
                  aria-label={`Property inventory donut chart: ${statusData.map(d => `${d.name} ${d.value}`).join(", ")}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {statusData.map((entry, idx) => (
                          <Cell key={`cell-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex justify-center gap-6 mt-4 flex-wrap list-none p-0 m-0" aria-label="Inventory status legend">
                  {statusData.map((entry) => (
                    <li key={entry.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                      <span className="text-sm font-medium text-muted-foreground">
                        {entry.name}: <span className="tabular-nums">{entry.value}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        );

      case "leadPipelineChart":
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-6">Lead pipeline</h3>
                <div
                  className="h-64"
                  role="img"
                  aria-label={`Lead pipeline bar chart: ${leadStatusData.map(d => `${d.name} ${d.value}`).join(", ")}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadStatusData}>
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                      <Tooltip
                        cursor={{fill: 'transparent'}}
                        contentStyle={{
                          borderRadius: '12px',
                          border: 'none',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
                          background: 'hsl(var(--card))'
                        }}
                      />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );

      case "dealVelocityFunnel":
        const funnelStages = [
          { name: "Leads", value: leads.length, color: "hsl(var(--muted-foreground))", pct: 100 },
          { name: "Contacting", value: leads.filter((l: any) => ["mailed", "responded", "interested"].includes(l.status)).length, color: "hsl(35, 60%, 55%)", pct: 0 },
          { name: "Negotiating", value: leads.filter((l: any) => ["negotiating", "qualified"].includes(l.status)).length, color: "hsl(16, 70%, 50%)", pct: 0 },
          { name: "Accepted", value: leads.filter((l: any) => l.status === "accepted").length, color: "hsl(142, 71%, 45%)", pct: 0 },
          { name: "Closed", value: leads.filter((l: any) => l.status === "closed").length, color: "hsl(142, 71%, 35%)", pct: 0 },
        ].map((s, i, arr) => ({ ...s, pct: arr[0].value > 0 ? Math.round((s.value / arr[0].value) * 100) : 0 }));
        return (
          <motion.div
            key={widgetId}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * index }}
          >
            <Card className="floating-window">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-primary" aria-hidden="true" />
                  Deal velocity funnel
                  <Badge variant="outline" className="text-xs ml-auto tabular-nums">
                    {funnelStages[funnelStages.length - 1].value > 0
                      ? `${funnelStages[funnelStages.length - 1].pct}% close rate`
                      : "No closings yet"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ol className="space-y-2 list-none p-0 m-0" aria-label="Deal stages from leads to closed">
                  {funnelStages.map((stage, idx) => (
                    <li key={stage.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-xs">{stage.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular-nums">{stage.value}</span>
                          {idx > 0 && funnelStages[idx - 1].value > 0 && (
                            <span className="text-micro text-muted-foreground tabular-nums">
                              ({Math.round((stage.value / funnelStages[idx - 1].value) * 100)}% conv)
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className="w-full bg-muted rounded-full h-5 overflow-hidden"
                        role="progressbar"
                        aria-label={`${stage.name}: ${stage.value} leads (${stage.pct}% of top of funnel)`}
                        aria-valuenow={stage.pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-full flex items-center px-2 transition-all duration-700"
                          style={{
                            width: `${stage.pct || (idx === 0 ? 100 : 0)}%`,
                            backgroundColor: stage.color,
                          }}
                        >
                          {stage.pct >= 15 && (
                            <span className="text-white text-micro font-semibold tabular-nums" aria-hidden="true">{stage.pct}%</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                {funnelStages[0].value === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-4">Add leads to see your deal funnel.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        );

      default:
        return null;
    }
  };

  const chartsVisible = isWidgetVisible("inventoryChart") || isWidgetVisible("leadPipelineChart");
  const visibleCharts = widgetSettings.order.filter(id => 
    (id === "inventoryChart" || id === "leadPipelineChart") && isWidgetVisible(id)
  );

  if (orgError) {
    return (
      <PageShell label="Dashboard">
        <QueryErrorState
          error={orgError as Error}
          onRetry={() => refetchOrg()}
          title="Failed to load dashboard"
          testId="error-state-dashboard"
        />
      </PageShell>
    );
  }

  // A not-yet-onboarded user should never see the dashboard with the
  // wizard shoved inline below it (the old broken presentation). Route
  // them to the canonical full-screen wizard instead — this mirrors the
  // /today OnboardingGate so onboarding is a single full-screen
  // experience everywhere. Onboarded users fall straight through.
  if (needsOnboarding) {
    return <Redirect to="/onboarding-v2" />;
  }

  return (
    <PageShell label="Dashboard">
      <PullToRefresh onRefresh={handleRefresh}>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold text-foreground" data-testid="text-dashboard-title">
                  Dashboard
                </h1>
                <p className="text-muted-foreground mt-2">Overview of your land-investing performance.</p>
              </div>
              <div className="flex items-center gap-2">
                <WorkspaceManager />
                <DashboardSettings settings={widgetSettings} onSettingsChange={setWidgetSettings} />
              </div>
            </div>
            
            {isLoading ? (
              <Skeleton className="h-12 w-64" />
            ) : organization && (
              <Card className="glass-panel border-none">
                <CardContent className="flex items-center gap-3 p-3">
                  <Building2 className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium" data-testid="text-organization-name">
                      {organization.name}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getTierColor(organization.subscriptionTier)}`}
                        data-testid="badge-subscription-tier"
                      >
                        <Crown className="w-3 h-3 mr-1" aria-hidden="true" />
                        {organization.subscriptionTier.charAt(0).toUpperCase() + organization.subscriptionTier.slice(1)}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Activity className="w-3 h-3" aria-hidden="true" /> Online
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Contextual tip banner */}
          {!tipDismissed && !isLoading && (
            leads.length === 0 ? (
              <Card className="border-acr-accent dark:border-acr-accent bg-acr-accent dark:bg-acr-accent/40">
                <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-acr-accent shrink-0" aria-hidden="true" />
                    <p className="text-sm text-acr-accent dark:text-acr-accent">
                      Import your first leads to see pipeline stats here.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild size="sm" variant="outline" className="text-xs min-h-11 sm:min-h-9">
                      <Link href="/leads">Go to leads</Link>
                    </Button>
                    <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setTipDismissed(true)} aria-label="Dismiss tip">
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : campaignsData.length === 0 ? (
              <Card className="border-acr-accent dark:border-acr-accent bg-acr-accent dark:bg-acr-accent/40">
                <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-acr-accent shrink-0" aria-hidden="true" />
                    <p className="text-sm text-acr-accent dark:text-acr-accent">
                      Create your first campaign to start outreach.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild size="sm" variant="outline" className="text-xs min-h-11 sm:min-h-9">
                      <Link href="/campaigns">Go to campaigns</Link>
                    </Button>
                    <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setTipDismissed(true)} aria-label="Dismiss tip">
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null
          )}

          {widgetSettings.order.map((widgetId, index) => {
            if (widgetId === "inventoryChart" || widgetId === "leadPipelineChart") {
              return null;
            }
            return renderWidget(widgetId, index);
          })}

          {chartsVisible && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              {visibleCharts.map((widgetId, idx) => renderWidget(widgetId, widgetSettings.order.indexOf(widgetId)))}
            </div>
          )}
      </PullToRefresh>
    </PageShell>
  );
}
