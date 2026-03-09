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
          <TabsTrigger value="calendar">Compliance Calendar</TabsTrigger>
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

        {/* ── COMPLIANCE CALENDAR ── */}
        <TabsContent value="calendar" className="mt-4">
          <ComplianceCalendar />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Compliance Calendar Component ───────────────────────────────────────────

const COMPLIANCE_DEADLINES = [
  { month: 1, day: 31, title: "1099-MISC Filing", description: "Report payments to contractors and sellers (paper filing)", category: "Federal Tax", severity: "high" },
  { month: 3, day: 15, title: "S-Corp Tax Return", description: "Form 1120-S due (or extension)", category: "Federal Tax", severity: "high" },
  { month: 4, day: 15, title: "Individual Tax Return", description: "Form 1040 due (or extension)", category: "Federal Tax", severity: "critical" },
  { month: 4, day: 15, title: "Q1 Estimated Tax", description: "First quarter estimated tax payment", category: "Federal Tax", severity: "high" },
  { month: 6, day: 15, title: "Q2 Estimated Tax", description: "Second quarter estimated tax payment", category: "Federal Tax", severity: "high" },
  { month: 7, day: 31, title: "FBAR Filing", description: "Foreign Bank Account Report (if applicable)", category: "Compliance", severity: "medium" },
  { month: 9, day: 15, title: "Q3 Estimated Tax", description: "Third quarter estimated tax payment", category: "Federal Tax", severity: "high" },
  { month: 9, day: 15, title: "Extended Tax Returns", description: "Extended S-Corp and Partnership returns due", category: "Federal Tax", severity: "high" },
  { month: 10, day: 15, title: "Extended Individual Returns", description: "Extended Form 1040 due", category: "Federal Tax", severity: "high" },
  { month: 12, day: 31, title: "QOZ Investment Deadline", description: "Invest gains in Qualified Opportunity Zone by year-end", category: "Tax Strategy", severity: "critical" },
  { month: 12, day: 31, title: "Year-End Harvesting", description: "Last day for tax loss harvesting and timing strategies", category: "Tax Strategy", severity: "high" },
  // RESPA / Real Estate Compliance
  { month: 1, day: 1, title: "Annual RESPA Review", description: "Review settlement procedures and disclosure compliance", category: "RESPA", severity: "medium" },
  // TCPA
  { month: 6, day: 1, title: "TCPA List Hygiene", description: "Scrub marketing lists against DNC registry (renew annually)", category: "TCPA", severity: "high" },
  { month: 12, day: 1, title: "TCPA List Hygiene", description: "Second annual DNC registry scrub", category: "TCPA", severity: "high" },
  // Dodd-Frank
  { month: 3, day: 31, title: "Dodd-Frank Property Count Review", description: "Verify seller-financing count vs. 3-property exemption limit", category: "Dodd-Frank", severity: "medium" },
];

const CATEGORY_COLORS: Record<string, string> = {
  "Federal Tax": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Tax Strategy": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "RESPA": "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "TCPA": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Dodd-Frank": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "Compliance": "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ComplianceCalendar() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const upcomingDeadlines = COMPLIANCE_DEADLINES.filter(d => {
    if (d.month > currentMonth) return true;
    if (d.month === currentMonth && d.day >= currentDay) return true;
    return false;
  }).sort((a, b) => {
    if (a.month !== b.month) return a.month - b.month;
    return a.day - b.day;
  });

  const pastDeadlines = COMPLIANCE_DEADLINES.filter(d =>
    d.month < currentMonth || (d.month === currentMonth && d.day < currentDay)
  );

  const daysUntil = (month: number, day: number) => {
    const target = new Date(now.getFullYear(), month - 1, day);
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86400000);
    return diff;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-500" />
            Upcoming Compliance Deadlines
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {upcomingDeadlines.map((d, i) => {
              const days = daysUntil(d.month, d.day);
              const isUrgent = days <= 14;
              return (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${isUrgent ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10" : "border-border"}`}>
                  <div className="text-center min-w-[48px]">
                    <p className="text-xs text-muted-foreground">{MONTH_NAMES[d.month - 1]}</p>
                    <p className="text-lg font-bold">{d.day}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{d.title}</span>
                      <Badge className={`text-xs py-0 ${CATEGORY_COLORS[d.category] || ""}`}>{d.category}</Badge>
                      {d.severity === "critical" && <Badge variant="destructive" className="text-xs py-0">Critical</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{d.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-medium ${isUrgent ? "text-amber-600" : "text-muted-foreground"}`}>
                      {days === 0 ? "Today!" : `${days}d`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Past Deadlines (This Year)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {pastDeadlines.map((d, i) => (
              <div key={i} className="flex items-center gap-3 opacity-60">
                <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <span className="text-sm">{MONTH_NAMES[d.month - 1]} {d.day} — {d.title}</span>
                <Badge className={`text-xs py-0 ml-auto ${CATEGORY_COLORS[d.category] || ""}`}>{d.category}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
