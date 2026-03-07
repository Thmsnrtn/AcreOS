import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Shield, AlertTriangle, CheckCircle, XCircle, Clock, FileText } from "lucide-react";

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-blue-100 text-blue-800",
  };
  return <Badge className={map[severity] ?? "bg-gray-100 text-gray-600"}>{severity}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "resolved") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "acknowledged") return <Clock className="w-4 h-4 text-yellow-500" />;
  return <AlertTriangle className="w-4 h-4 text-red-500" />;
}

export default function CompliancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: dashboardData, isLoading } = useQuery({
    queryKey: ["/api/compliance/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/compliance/dashboard", { credentials: "include" });
      return res.json();
    },
  });

  const { data: alertsData } = useQuery({
    queryKey: ["/api/compliance/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/compliance/alerts", { credentials: "include" });
      return res.json();
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: number) => {
      const res = await fetch(`/api/compliance/alerts/${alertId}/acknowledge`, {
        method: "PATCH", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["/api/compliance"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ alertId, resolution }: { alertId: number; resolution: string }) => {
      const res = await fetch(`/api/compliance/alerts/${alertId}/resolve`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/compliance"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const dashboard = dashboardData?.dashboard;
  const alerts = alertsData?.alerts ?? [];

  if (isLoading) {
    return <div className="p-6"><div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />)}</div></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-7 h-7 text-primary" /> Compliance AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Automated regulatory monitoring, disclosure generation, and RESPA/TCPA compliance tracking
        </p>
      </div>

      {/* Status Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-muted-foreground">Compliance Score</p>
                <Shield className={`w-4 h-4 ${(dashboard.complianceScore ?? 0) >= 80 ? "text-green-500" : "text-yellow-500"}`} />
              </div>
              <p className="text-2xl font-bold">{dashboard.complianceScore ?? "—"}/100</p>
              <Progress value={dashboard.complianceScore ?? 0} className="h-1 mt-1" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-muted-foreground">Open Alerts</p>
                <AlertTriangle className={`w-4 h-4 ${(dashboard.openAlerts ?? 0) > 0 ? "text-red-500" : "text-green-500"}`} />
              </div>
              <p className={`text-2xl font-bold ${(dashboard.openAlerts ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
                {dashboard.openAlerts ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-1">Properties Monitored</p>
              <p className="text-2xl font-bold">{dashboard.propertiesMonitored ?? 0}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground mb-1">Resolved (30d)</p>
              <p className="text-2xl font-bold text-green-600">{dashboard.resolvedLast30Days ?? 0}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="rules">Active Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
                <p className="font-medium">All clear — no compliance alerts</p>
                <p className="text-sm text-muted-foreground mt-1">AcreOS is actively monitoring your portfolio for regulatory changes.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert: any) => (
                <Card key={alert.id} className={alert.severity === "critical" ? "border-red-200" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <StatusIcon status={alert.status} />
                        <span className="font-medium">{alert.title}</span>
                        <SeverityBadge severity={alert.severity} />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{alert.description}</p>
                    {alert.requiredAction && (
                      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 rounded p-2 mb-3">
                        <p className="text-xs font-medium text-orange-700">Required action: {alert.requiredAction}</p>
                      </div>
                    )}
                    {alert.status === "open" && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline"
                          onClick={() => acknowledgeMutation.mutate(alert.id)}
                          disabled={acknowledgeMutation.isPending}>
                          <Clock className="w-3 h-3 mr-1" /> Acknowledge
                        </Button>
                        <Button size="sm"
                          onClick={() => resolveMutation.mutate({ alertId: alert.id, resolution: "Manually resolved" })}
                          disabled={resolveMutation.isPending}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Mark Resolved
                        </Button>
                      </div>
                    )}
                    {alert.status === "acknowledged" && (
                      <Button size="sm"
                        onClick={() => resolveMutation.mutate({ alertId: alert.id, resolution: "Resolved after acknowledgement" })}
                        disabled={resolveMutation.isPending}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Mark Resolved
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          {dashboard?.activeRules?.length > 0 ? (
            <div className="space-y-3">
              {dashboard.activeRules.map((rule: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{rule.name}</span>
                      <Badge variant="secondary">{rule.jurisdiction ?? "Federal"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{rule.description}</p>
                    {rule.effectiveDate && (
                      <p className="text-xs text-muted-foreground mt-1">Effective: {new Date(rule.effectiveDate).toLocaleDateString()}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">No active compliance rules loaded.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
