import { Sidebar } from "@/components/layout-sidebar";
import { StatCard } from "@/components/stat-card";
import { useOrganization, useDashboardStats } from "@/hooks/use-organization";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { Users, Map, Banknote, TrendingUp, Activity, Building2, Crown } from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OnboardingModal } from "@/components/onboarding-modal";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";

export default function Dashboard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();

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

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <OnboardingModal />
      <main className="flex-1 md:ml-[17rem] p-6 md:p-8 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground" data-testid="text-dashboard-title">
                Dashboard
              </h1>
              <p className="text-muted-foreground mt-2">Overview of your land investment performance.</p>
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

          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
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

          <GettingStartedChecklist />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
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
                          {statusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
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

            <motion.div 
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
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
          </div>
        </div>
      </main>
    </div>
  );
}
