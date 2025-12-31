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
    { name: 'Available', value: properties.filter(p => p.status === 'available' || p.status === 'listed').length, color: '#3b82f6' },
    { name: 'Sold', value: properties.filter(p => p.status === 'sold').length, color: '#10b981' },
    { name: 'Contract', value: properties.filter(p => p.status === 'under_contract').length, color: '#f59e0b' },
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
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { translateY: 20, opacity: 0 },
    show: { translateY: 0, opacity: 1 }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "pro": return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "scale": return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "starter": return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      default: return "bg-slate-500/10 text-slate-500 border-slate-500/20";
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white" data-testid="text-dashboard-title">
                Dashboard
              </h1>
              <p className="text-slate-500 mt-2">Overview of your land empire performance.</p>
            </div>
            
            {isLoading ? (
              <Skeleton className="h-12 w-64" />
            ) : organization && (
              <Card className="border-none shadow-sm bg-white/50 dark:bg-slate-900/50 backdrop-blur">
                <CardContent className="flex items-center gap-3 p-3">
                  <Building2 className="w-5 h-5 text-slate-500" />
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
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            <motion.div variants={item}>
              <StatCard 
                title="Total Properties" 
                value={isLoading ? "-" : stats?.activeProperties ?? properties.length} 
                icon={Map} 
                trend={`${properties.filter(p => p.status === 'owned').length} owned`}
                color="purple"
                data-testid="stat-total-properties"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Active Notes" 
                value={isLoading ? "-" : stats?.activeNotes ?? 0} 
                icon={Banknote} 
                color="emerald"
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
                color="blue"
                data-testid="stat-pipeline-value"
              />
            </motion.div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white dark:bg-card p-6 rounded-2xl border shadow-sm"
            >
              <h3 className="text-lg font-bold mb-6">Inventory Status</h3>
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
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{entry.name}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-white dark:bg-card p-6 rounded-2xl border shadow-sm"
            >
              <h3 className="text-lg font-bold mb-6">Lead Pipeline</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leadStatusData}>
                    <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
                    <Tooltip 
                      cursor={{fill: 'transparent'}}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
