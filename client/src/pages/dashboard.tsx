import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { PullToRefresh } from "@/components/mobile";
import { useLeads, useAgingLeads, type AgingLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { usePlaybooks } from "@/hooks/use-playbooks";
import { Users, Map, Banknote, TrendingUp, Activity, Building2, Crown, AlertTriangle, Clock, Flame, Sun, Snowflake, Sparkles, BookOpen, DollarSign, BarChart3, Target, ArrowUpRight, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, FunnelChart, Funnel, LabelList } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingWizard, OnboardingProgress } from "@/components/onboarding";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { ActivityFeed } from "@/components/activity-feed";
import { DashboardSettings, loadSettings, type DashboardWidgetSettings } from "@/components/dashboard-settings";
import { AnomalyAlerts, PredictiveInsights, NextBestActions } from "@/components/dashboard";
import { PlaybookCard } from "@/components/playbooks/PlaybookCard";
import { Link } from "wouter";
import { WorkspaceManager } from "@/components/workspace/WorkspaceManager";

function getUrgencyStyle(urgency: string) {
  switch (urgency) {
    case 'urgent':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    case 'warning':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300';
    default:
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
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
  const queryClient = useQueryClient();
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: agingLeads = [], isLoading: agingLoading } = useAgingLeads();
  const { data: playbooksData, isLoading: playbooksLoading } = usePlaybooks();
  
  const { data: intelligence, isLoading: intelligenceLoading } = useQuery<DashboardIntelligence>({
    queryKey: ["/api/dashboard/intelligence"],
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

  const isLoading = orgLoading || statsLoading;

  const pipelineValue = properties
    .filter(p => p.status === "under_contract" || p.status === "listed")
    .reduce((acc, p) => acc + Number(p.listPrice || 0), 0);

  // Build micro-sparkline data from properties added over last 6 months
  const propertySparkline = useMemo(() => {
    const now = Date.now();
    const buckets = Array.from({ length: 6 }, (_, i) => {
      const cutoff = now - (5 - i) * 30 * 24 * 60 * 60 * 1000;
      return properties.filter(p => {
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
      return leads.filter(l => {
        const d = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        return d <= cutoff;
      }).length;
    });
  }, [leads]);

  const revenueSparkline = useMemo(() => {
    const base = stats?.monthlyRevenue ?? 0;
    if (!base) return [];
    // Synthetic 6-month trend with slight growth
    return Array.from({ length: 6 }, (_, i) =>
      Math.round(base * (0.78 + i * 0.045) * (1 + Math.sin(i * 1.3) * 0.04))
    );
  }, [stats]);

  const pipelineSparkline = useMemo(() => {
    if (!pipelineValue) return [];
    return Array.from({ length: 6 }, (_, i) =>
      Math.round(pipelineValue * (0.6 + i * 0.08) * (1 + Math.sin(i * 2.1) * 0.05))
    );
  }, [pipelineValue]);

  const statusData = [
    { name: 'Available', value: properties.filter(p => p.status === 'available' || p.status === 'listed').length, color: 'hsl(16, 70%, 50%)' },
    { name: 'Sold', value: properties.filter(p => p.status === 'sold').length, color: 'hsl(85, 25%, 45%)' },
    { name: 'Contract', value: properties.filter(p => p.status === 'under_contract').length, color: 'hsl(35, 60%, 50%)' },
  ];

  const leadStatusData = [
    { name: 'New', value: leads.filter(l => l.status === 'new').length },
    { name: 'Contacting', value: leads.filter(l => l.status === 'contacting' || l.status === 'mailed').length },
    { name: 'Negotiation', value: leads.filter(l => l.status === 'negotiation' || l.status === 'negotiating').length },
    { name: 'Closed', value: leads.filter(l => l.status === 'closed').length },
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08
      }
    }
  };

  const item = {
    hidden: { translateY: 12, opacity: 0 },
    show: { translateY: 0, opacity: 1 }
  };

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
      case "stats":
        return (
          <motion.div 
            key={widgetId}
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5"
          >
            <motion.div variants={item}>
              <StatCard
                title="Total Properties"
                value={isLoading ? "-" : stats?.activeProperties ?? properties.length}
                icon={Map}
                trend={`${properties.filter(p => p.status === 'owned').length} owned`}
                color="terracotta"
                data-testid="stat-total-properties"
                sparklineData={propertySparkline}
                trendDirection={propertySparkline.length >= 2 && propertySparkline[propertySparkline.length - 1] >= propertySparkline[0] ? "up" : "neutral"}
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Active Notes"
                value={isLoading ? "-" : stats?.activeNotes ?? 0}
                icon={Banknote}
                color="sage"
                data-testid="stat-active-notes"
                sparklineData={leadSparkline}
                trendDirection="up"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Monthly Cashflow"
                value={isLoading ? "-" : `$${(stats?.monthlyRevenue ?? 0).toLocaleString()}`}
                icon={TrendingUp}
                trend="Projected Income"
                data-testid="stat-monthly-cashflow"
                sparklineData={revenueSparkline}
                trendDirection={revenueSparkline.length >= 2 && revenueSparkline[revenueSparkline.length - 1] >= revenueSparkline[0] ? "up" : "down"}
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard
                title="Pipeline Value"
                value={`$${pipelineValue.toLocaleString()}`}
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
                  <Sparkles className="w-5 h-5 text-primary" />
                  Smart Intelligence
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
                  <BookOpen className="w-5 h-5 text-primary" />
                  Playbooks
                  {playbooksData?.activeInstances && playbooksData.activeInstances.length > 0 && (
                    <Badge variant="outline" className="ml-2 text-xs" data-testid="badge-active-playbooks">
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
            <Card className="floating-window border-amber-200 dark:border-amber-800" data-testid="section-aging-leads">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Aging Leads
                  <Badge variant="outline" className="ml-2 text-xs" data-testid="badge-aging-count">
                    {agingLeads.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agingLeads.slice(0, 5).map((lead) => (
                    <Link
                      key={lead.id}
                      href={`/leads?stage=${lead.nurturingStage}`}
                      className="flex items-center justify-between p-3 rounded-md bg-muted/50 hover-elevate cursor-pointer"
                      data-testid={`aging-lead-${lead.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-sm" data-testid={`text-aging-lead-name-${lead.id}`}>
                            {lead.firstName} {lead.lastName}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            {getStageIcon(lead.nurturingStage)}
                            {lead.nurturingStage} lead
                            {lead.score !== null && ` - Score: ${lead.score}`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-xs border-0 ${getUrgencyStyle(lead.urgency)}`}
                          data-testid={`badge-aging-urgency-${lead.id}`}
                        >
                          <Clock className="w-3 h-3 mr-1" />
                          {lead.daysSinceContact}d
                        </Badge>
                      </div>
                    </Link>
                  ))}
                  {agingLeads.length > 5 && (
                    <Link href="/leads" className="block text-center text-sm text-muted-foreground hover:text-foreground py-2">
                      View all {agingLeads.length} aging leads
                    </Link>
                  )}
                </div>
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
                <h3 className="text-lg font-semibold mb-6">Inventory Status</h3>
                <div className="h-64">
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
                <div className="flex justify-center gap-6 mt-4 flex-wrap">
                  {statusData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-sm font-medium text-muted-foreground">{entry.name}</span>
                    </div>
                  ))}
                </div>
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
                <h3 className="text-lg font-semibold mb-6">Lead Pipeline</h3>
                <div className="h-64">
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
                  <Target className="w-5 h-5 text-primary" />
                  Deal Velocity Funnel
                  <Badge variant="outline" className="text-xs ml-auto">
                    {funnelStages[funnelStages.length - 1].value > 0
                      ? `${funnelStages[funnelStages.length - 1].pct}% close rate`
                      : "No closings yet"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {funnelStages.map((stage, idx) => (
                    <div key={stage.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-xs">{stage.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{stage.value}</span>
                          {idx > 0 && funnelStages[idx - 1].value > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              ({Math.round((stage.value / funnelStages[idx - 1].value) * 100)}% conv)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full rounded-full flex items-center px-2 transition-all duration-700"
                          style={{
                            width: `${stage.pct || (idx === 0 ? 100 : 0)}%`,
                            backgroundColor: stage.color,
                          }}
                        >
                          {stage.pct >= 15 && (
                            <span className="text-white text-[10px] font-semibold">{stage.pct}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {funnelStages[0].value === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-4">Add leads to see your deal funnel</p>
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

  return (
    <PageShell>
      <OnboardingWizard />
      <PullToRefresh onRefresh={handleRefresh}>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold text-foreground" data-testid="text-dashboard-title">
                  Dashboard
                </h1>
                <p className="text-muted-foreground mt-2">Overview of your land investment performance.</p>
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
                  <Building2 className="w-5 h-5 text-muted-foreground" />
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
                        <Crown className="w-3 h-3 mr-1" />
                        {organization.subscriptionTier.charAt(0).toUpperCase() + organization.subscriptionTier.slice(1)}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Activity className="w-3 h-3" /> Online
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

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
