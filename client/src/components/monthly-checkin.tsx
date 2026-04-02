import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign, Users, AlertTriangle, Shield, Bot,
  Play, CheckCircle2, XCircle, Loader2, TrendingUp, TrendingDown,
} from "lucide-react";

interface MonthlyCheckinData {
  period: { start: string; end: string };
  revenue: {
    mrr: number;
    paidCustomers: number;
    totalCustomers: number;
    newSignupsThisMonth: number;
    newSignupsLastMonth: number;
    churnedThisMonth: number;
  };
  support: {
    totalTickets: number;
    escalated: number;
    aiResolved: number;
  };
  health: {
    overall: string;
    services: Array<{ name: string; status: string }>;
  };
  alerts: {
    total: number;
    byPriority: Record<string, number>;
  };
  dunning: {
    totalActive: number;
    totalAmountAtRiskCents: number;
    recoveredLast30Days: number;
  };
  autonomousDecisions: number;
  topFeatureRequests: Array<{ id: number; title: string; status: string }>;
}

export function MonthlyCheckin() {
  const { data, isLoading } = useQuery<MonthlyCheckinData>({
    queryKey: ["/api/founder/monthly-checkin"],
    refetchInterval: 5 * 60 * 1000,
  });

  const maintenanceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/run-maintenance");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div id="section-monthly" className="scroll-mt-16 space-y-4">
        <h2 className="text-xl font-semibold">Monthly Check-In</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const healthColor = data.health.overall === "healthy" ? "text-green-600" : data.health.overall === "degraded" ? "text-amber-500" : "text-red-500";
  const aiResolutionRate = data.support.totalTickets > 0
    ? Math.round((data.support.aiResolved / data.support.totalTickets) * 100)
    : 100;

  return (
    <div id="section-monthly" className="scroll-mt-16 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Monthly Check-In</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => maintenanceMutation.mutate()}
          disabled={maintenanceMutation.isPending}
          aria-label="Run monthly maintenance"
        >
          {maintenanceMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : maintenanceMutation.isSuccess ? (
            <CheckCircle2 className="w-4 h-4 mr-1 text-green-600" />
          ) : (
            <Play className="w-4 h-4 mr-1" />
          )}
          {maintenanceMutation.isPending ? "Running..." : maintenanceMutation.isSuccess ? "Done" : "Run Maintenance"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* MRR */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <DollarSign className="w-4 h-4" /> MRR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.revenue.mrr}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.revenue.paidCustomers} paid / {data.revenue.totalCustomers} total
            </p>
          </CardContent>
        </Card>

        {/* Signups & Churn */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Users className="w-4 h-4" /> Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="text-lg font-semibold">+{data.revenue.newSignupsThisMonth}</span>
              <span className="text-xs text-muted-foreground">new</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="text-lg font-semibold">-{data.revenue.churnedThisMonth}</span>
              <span className="text-xs text-muted-foreground">churned</span>
            </div>
          </CardContent>
        </Card>

        {/* Support */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Bot className="w-4 h-4" /> Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{aiResolutionRate}%</p>
            <p className="text-xs text-muted-foreground">
              AI resolved ({data.support.aiResolved}/{data.support.totalTickets})
            </p>
            {data.support.escalated > 0 && (
              <p className="text-xs text-amber-500 mt-1">{data.support.escalated} escalated</p>
            )}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Shield className="w-4 h-4" /> Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold capitalize ${healthColor}`}>{data.health.overall}</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {data.health.services.filter(s => s.status !== "healthy").map(s => (
                <Badge key={s.name} variant="outline" className="text-xs">
                  <XCircle className="w-3 h-3 mr-1 text-red-500" /> {s.name}
                </Badge>
              ))}
              {data.health.services.every(s => s.status === "healthy") && (
                <span className="text-xs text-green-600">All services operational</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Second row: Alerts, Dunning, Decisions, Feature Requests */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {Object.entries(data.alerts.byPriority).map(([p, c]) => (
                <div key={p} className="flex justify-between">
                  <span className={p === "P0" ? "text-red-500 font-bold" : p === "P1" ? "text-amber-500" : "text-muted-foreground"}>
                    {p}
                  </span>
                  <span className="font-mono">{c}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Dunning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{data.dunning.totalActive} active</p>
            <p className="text-xs text-muted-foreground">
              ${(data.dunning.totalAmountAtRiskCents / 100).toFixed(0)} at risk
            </p>
            <p className="text-xs text-green-600 mt-1">
              {data.dunning.recoveredLast30Days} recovered (30d)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Autonomous Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.autonomousDecisions}</p>
            <p className="text-xs text-muted-foreground">decisions this month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {data.topFeatureRequests.slice(0, 3).map(r => (
                <li key={r.id} className="text-xs truncate">{r.title}</li>
              ))}
              {data.topFeatureRequests.length === 0 && (
                <li className="text-xs text-muted-foreground">No requests</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
