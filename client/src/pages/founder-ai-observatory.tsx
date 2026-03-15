// Founder AI Observatory — cross-org AI usage, cost, and intelligence analytics

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Bot, Activity, Plug, Building2, MessageSquare, TrendingUp,
} from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FounderAiObservatory() {
  const { data: telemetry = [], isLoading: loadingTelemetry } = useQuery({
    queryKey: ["/api/founder/ai/telemetry"],
    refetchInterval: 30_000,
  });

  const { data: stats, isLoading: loadingStats } = useQuery<{
    convPerOrg: { orgName: string; organizationId: number; convCount: number }[];
    connectorAdoption: { connectorId: string; orgCount: number }[];
    generatedAt: string;
  }>({
    queryKey: ["/api/founder/ai/stats"],
    refetchInterval: 60_000,
  });

  const totalConvs = (telemetry as any[]).length;
  const activeOrgs = new Set((telemetry as any[]).map((t: any) => t.organizationId)).size;
  const totalConnectors = stats?.connectorAdoption?.reduce((s, c) => s + c.orgCount, 0) ?? 0;

  // Role distribution from telemetry
  const roleDistrib = (telemetry as any[]).reduce<Record<string, number>>((acc, t: any) => {
    acc[t.agentRole] = (acc[t.agentRole] ?? 0) + 1;
    return acc;
  }, {});
  const roleData = Object.entries(roleDistrib).map(([name, value]) => ({ name, value }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Bot className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">AI Observatory</h1>
          <p className="text-xs text-muted-foreground">Cross-org AI usage, connector adoption, and intelligence metrics</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={MessageSquare} label="Recent Conversations" value={totalConvs} sub="last 50 captured" />
        <StatCard icon={Building2} label="Active Orgs (AI)" value={activeOrgs} />
        <StatCard icon={Plug} label="Connected Integrations" value={totalConnectors} />
        <StatCard icon={TrendingUp} label="Connector Types" value={stats?.connectorAdoption?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Conversations per org */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conversations per Org (all time)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingStats ? (
              <Skeleton className="h-48" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats?.convPerOrg?.slice(0, 10) ?? []} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="orgName" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="convCount" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Agent role distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Agent Role Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            {loadingTelemetry ? (
              <Skeleton className="h-48 w-full" />
            ) : roleData.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <>
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie data={roleData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" paddingAngle={2}>
                      {roleData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {roleData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs capitalize">{d.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Connector adoption */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Connector Adoption (across all orgs)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingStats ? (
            <Skeleton className="h-8" />
          ) : !stats?.connectorAdoption?.length ? (
            <p className="text-xs text-muted-foreground">No integrations connected yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.connectorAdoption.map(c => (
                <Badge key={c.connectorId} variant="secondary" className="text-xs gap-1.5">
                  <Plug className="w-2.5 h-2.5" />
                  {c.connectorId}
                  <span className="font-bold">{c.orgCount} org{c.orgCount !== 1 ? "s" : ""}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live conversation feed */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">Recent AI Conversations</CardTitle>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingTelemetry ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : (
            <div className="divide-y">
              {(telemetry as any[]).slice(0, 20).map((conv: any) => (
                <div key={conv.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/20">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{conv.title}</p>
                    <p className="text-[10px] text-muted-foreground">{conv.orgName}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-4 shrink-0">{conv.agentRole}</Badge>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(conv.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
