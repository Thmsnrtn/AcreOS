import { Sidebar } from "@/components/layout-sidebar";
import { StatCard } from "@/components/stat-card";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useNotes } from "@/hooks/use-notes";
import { Users, Map, Banknote, TrendingUp, Activity } from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

export default function Dashboard() {
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: notes = [] } = useNotes();

  const totalRevenue = notes.reduce((acc, note) => acc + Number(note.monthlyPayment), 0);
  const activeNotes = notes.filter(n => n.status === "active").length;
  const underContract = properties.filter(p => p.status === "under_contract").length;

  // Chart Data Preparation
  const statusData = [
    { name: 'Available', value: properties.filter(p => p.status === 'available').length, color: '#3b82f6' },
    { name: 'Sold', value: properties.filter(p => p.status === 'sold').length, color: '#10b981' },
    { name: 'Contract', value: properties.filter(p => p.status === 'under_contract').length, color: '#f59e0b' },
  ];

  const leadStatusData = [
    { name: 'New', value: leads.filter(l => l.status === 'new').length },
    { name: 'Contacting', value: leads.filter(l => l.status === 'contacting').length },
    { name: 'Negotiation', value: leads.filter(l => l.status === 'negotiation').length },
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

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
              <p className="text-slate-500 mt-2">Overview of your land empire performance.</p>
            </div>
            <div className="flex gap-2 text-sm text-slate-500">
              <span className="flex items-center gap-1"><Activity className="w-4 h-4" /> System Online</span>
            </div>
          </div>

          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            <motion.div variants={item}>
              <StatCard 
                title="Total Leads" 
                value={leads.length} 
                icon={Users} 
                trend="+12% from last month"
                color="blue"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Properties" 
                value={properties.length} 
                icon={Map} 
                trend={`${underContract} under contract`}
                color="purple"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Active Notes" 
                value={activeNotes} 
                icon={Banknote} 
                color="emerald"
              />
            </motion.div>
            <motion.div variants={item}>
              <StatCard 
                title="Monthly Cashflow" 
                value={`$${totalRevenue.toLocaleString()}`} 
                icon={TrendingUp} 
                trend="Projected Income"
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
              <div className="flex justify-center gap-6 mt-4">
                {statusData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-sm font-medium text-slate-600">{entry.name}</span>
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
