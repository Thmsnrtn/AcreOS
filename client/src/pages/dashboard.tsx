import { useState, useMemo } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { useLeads, useAgingLeads, type AgingLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { Users, Map, Banknote, TrendingUp, Activity, Building2, Crown, AlertTriangle, Clock, Flame, Sun, Snowflake } from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { ActivityFeed } from "@/components/activity-feed";
import { DashboardSettings, loadSettings, type DashboardWidgetSettings } from "@/components/dashboard-settings";
import { Link } from "wouter";

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

export default function Dashboard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: agingLeads = [], isLoading: agingLoading } = useAgingLeads();

  const [widgetSettings, setWidgetSettings] = useState<DashboardWidgetSettings>(() => 
    loadSettings(organization)
  );

  useMemo(() => {
    if (organization) {
      setWidgetSettings(loadSettings(organization));
    }
  }, [organization]);

  const isLoading = orgLoading || statsLoading;

  const pipelineValue = properties
    .filter(p => p.status === "under_contract" || p.status === "listed")
    .reduce((acc, p) => acc + Number(p.listPrice || 0), 0);

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
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Active Notes" 
                value={isLoading ? "-" : stats?.activeNotes ?? 0} 
                icon={Banknote} 
                color="sage"
                data-testid="stat-active-notes"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Monthly Cashflow" 
                value={isLoading ? "-" : `$${(stats?.monthlyRevenue ?? 0).toLocaleString()}`} 
                icon={TrendingUp} 
                trend="Projected Income"
                data-testid="stat-monthly-cashflow"
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
              />
            </motion.div>
          </motion.div>
        );

      case "checklist":
        return <GettingStartedChecklist key={widgetId} />;

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

      default:
        return null;
    }
  };

  const chartsVisible = isWidgetVisible("inventoryChart") || isWidgetVisible("leadPipelineChart");
  const visibleCharts = widgetSettings.order.filter(id => 
    (id === "inventoryChart" || id === "leadPipelineChart") && isWidgetVisible(id)
  );

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <OnboardingWizard />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-3xl font-bold text-foreground" data-testid="text-dashboard-title">
                  Dashboard
                </h1>
                <p className="text-muted-foreground mt-2">Overview of your land investment performance.</p>
              </div>
              <DashboardSettings settings={widgetSettings} onSettingsChange={setWidgetSettings} />
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
        </div>
      </main>
    </div>
  );
}
