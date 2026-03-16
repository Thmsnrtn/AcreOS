import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Clock, Target, DollarSign, BarChart2 } from "lucide-react";

export default function TeamKPI() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/analytics/team-kpi"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/analytics/team-kpi");
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  // Placeholder KPI cards shown while real data loads or if API not ready
  const placeholderKPIs = [
    { label: "Deals Closed (30d)", value: "—", icon: Target, color: "text-green-600" },
    { label: "Avg Deal Cycle Time", value: "—", icon: Clock, color: "text-blue-600" },
    { label: "Leads Worked", value: "—", icon: Users, color: "text-purple-600" },
    { label: "Revenue Generated", value: "—", icon: DollarSign, color: "text-yellow-600" },
    { label: "Conversion Rate", value: "—", icon: TrendingUp, color: "text-teal-600" },
    { label: "Avg Offer Accepted %", value: "—", icon: BarChart2, color: "text-orange-600" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team Performance</h1>
        <p className="text-muted-foreground">Deal cycle times, conversion rates, and productivity metrics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {(data?.kpis || placeholderKPIs).map((kpi: any, i: number) => {
          const Icon = placeholderKPIs[i]?.icon || Target;
          return (
            <Card key={kpi.label || i}>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                    {kpi.change !== undefined && (
                      <p className={`text-xs mt-1 ${kpi.change >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {kpi.change >= 0 ? "+" : ""}{kpi.change}% vs last period
                      </p>
                    )}
                  </div>
                  <Icon className={`w-5 h-5 ${placeholderKPIs[i]?.color || "text-muted-foreground"}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!data && !isLoading && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground">
            <BarChart2 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium">Team KPI tracking coming soon</p>
            <p className="text-sm mt-1">Deal cycle time, team productivity, and conversion analytics will appear here as your team works deals.</p>
          </CardContent>
        </Card>
      )}

      {data?.teamMembers && (
        <Card>
          <CardHeader><CardTitle className="text-base">Team Member Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.teamMembers.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.role}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{member.dealsClosedThisMonth} deals</p>
                    <p className="text-xs text-muted-foreground">{member.avgCycleDays}d avg cycle</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
