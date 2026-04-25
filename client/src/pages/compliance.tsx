import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Shield, AlertTriangle, CheckCircle, Clock, FileText } from "lucide-react";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-blue-100 text-blue-800",
  };
  const label = SEVERITY_LABEL[severity] ?? severity;
  return (
    <Badge className={map[severity] ?? "bg-gray-100 text-gray-600"} aria-label={`Severity: ${label}`}>
      {label}
    </Badge>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "resolved") return <CheckCircle className="w-4 h-4 text-green-500" aria-label="Resolved" />;
  if (status === "acknowledged") return <Clock className="w-4 h-4 text-yellow-500" aria-label="Acknowledged" />;
  return <AlertTriangle className="w-4 h-4 text-red-500" aria-label="Open" />;
}

export default function CompliancePage() {
  useDocumentTitle("Compliance");
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
    onError: (e: any) =>
      toast({
        title: "Couldn't acknowledge alert",
        description: `${e.message}. The alert is still open — try again.`,
        variant: "destructive",
      }),
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
    onError: (e: any) =>
      toast({
        title: "Couldn't resolve alert",
        description: `${e.message}. The alert is unchanged — try again, or acknowledge it for now and revisit later.`,
        variant: "destructive",
      }),
  });

  const dashboard = dashboardData?.dashboard;
  const alerts = alertsData?.alerts ?? [];

  if (isLoading) {
    return (
      <div className="p-6" role="status" aria-live="polite">
        <span className="sr-only">Loading compliance dashboard…</span>
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted/50 rounded-lg animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <RequiredDisclaimer type="legal" />
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="w-7 h-7 text-primary" aria-hidden="true" /> Compliance AI
        </h1>
        <p className="text-muted-foreground mt-1">
          Automated regulatory monitoring, disclosure generation, and RESPA/TCPA compliance tracking.
        </p>
      </div>

      {dashboard && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <dt className="text-sm text-muted-foreground">Compliance score</dt>
                <Shield className={`w-4 h-4 ${(dashboard.complianceScore ?? 0) >= 80 ? "text-green-500" : "text-yellow-500"}`} aria-hidden="true" />
              </div>
              <dd className="text-2xl font-bold tabular-nums">{dashboard.complianceScore ?? "—"}/100</dd>
              <Progress
                value={dashboard.complianceScore ?? 0}
                className="h-1 mt-1"
                aria-label={`Compliance score ${dashboard.complianceScore ?? 0} of 100`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <dt className="text-sm text-muted-foreground">Open alerts</dt>
                <AlertTriangle className={`w-4 h-4 ${(dashboard.openAlerts ?? 0) > 0 ? "text-red-500" : "text-green-500"}`} aria-hidden="true" />
              </div>
              <dd className={`text-2xl font-bold tabular-nums ${(dashboard.openAlerts ?? 0) > 0 ? "text-red-600" : "text-green-600"}`}>
                {dashboard.openAlerts ?? 0}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-sm text-muted-foreground mb-1">Properties monitored</dt>
              <dd className="text-2xl font-bold tabular-nums">{dashboard.propertiesMonitored ?? 0}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-sm text-muted-foreground mb-1">Resolved (30d)</dt>
              <dd className="text-2xl font-bold text-green-600 tabular-nums">{dashboard.resolvedLast30Days ?? 0}</dd>
            </CardContent>
          </Card>
        </dl>
      )}

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="rules">Active rules</TabsTrigger>
          <TabsTrigger value="calendar">Compliance calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="mt-4">
          {alerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center" role="status">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" aria-hidden="true" />
                <p className="font-medium">All clear — no compliance alerts.</p>
                <p className="text-sm text-muted-foreground mt-1">AcreOS is actively monitoring your portfolio for regulatory changes.</p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="Compliance alerts">
              {alerts.map((alert: any) => (
                <li key={alert.id}>
                  <Card
                    className={alert.severity === "critical" ? "border-red-200" : ""}
                    role={alert.severity === "critical" && alert.status === "open" ? "alert" : undefined}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2 gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusIcon status={alert.status} />
                          <span className="font-medium">{alert.title}</span>
                          <SeverityBadge severity={alert.severity} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
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
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                            aria-label={`Acknowledge alert: ${alert.title}`}
                          >
                            <Clock className="w-3 h-3 mr-1" aria-hidden="true" /> Acknowledge
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => resolveMutation.mutate({ alertId: alert.id, resolution: "Manually resolved" })}
                            disabled={resolveMutation.isPending}
                            aria-label={`Mark alert resolved: ${alert.title}`}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" /> Mark resolved
                          </Button>
                        </div>
                      )}
                      {alert.status === "acknowledged" && (
                        <Button
                          size="sm"
                          onClick={() => resolveMutation.mutate({ alertId: alert.id, resolution: "Resolved after acknowledgement" })}
                          disabled={resolveMutation.isPending}
                          aria-label={`Mark alert resolved: ${alert.title}`}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" /> Mark resolved
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          {dashboard?.activeRules?.length > 0 ? (
            <ul className="space-y-3" aria-label="Active compliance rules">
              {dashboard.activeRules.map((rule: any, i: number) => (
                <li key={i}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                        <span className="font-medium">{rule.name}</span>
                        <Badge variant="secondary">{rule.jurisdiction ?? "Federal"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{rule.description}</p>
                      {rule.effectiveDate && (
                        <p className="text-xs text-muted-foreground mt-1 tabular-nums">Effective: {new Date(rule.effectiveDate).toLocaleDateString()}</p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
                <p className="text-muted-foreground">No active compliance rules loaded.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <ComplianceCalendar />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const COMPLIANCE_DEADLINES = [
  { month: 1, day: 31, title: "1099-MISC filing", description: "Report payments to contractors and sellers (paper filing).", category: "Federal Tax", severity: "high" },
  { month: 3, day: 15, title: "S-Corp tax return", description: "Form 1120-S due (or extension).", category: "Federal Tax", severity: "high" },
  { month: 4, day: 15, title: "Individual tax return", description: "Form 1040 due (or extension).", category: "Federal Tax", severity: "critical" },
  { month: 4, day: 15, title: "Q1 estimated tax", description: "First quarter estimated tax payment.", category: "Federal Tax", severity: "high" },
  { month: 6, day: 15, title: "Q2 estimated tax", description: "Second quarter estimated tax payment.", category: "Federal Tax", severity: "high" },
  { month: 7, day: 31, title: "FBAR filing", description: "Foreign Bank Account Report (if applicable).", category: "Compliance", severity: "medium" },
  { month: 9, day: 15, title: "Q3 estimated tax", description: "Third quarter estimated tax payment.", category: "Federal Tax", severity: "high" },
  { month: 9, day: 15, title: "Extended tax returns", description: "Extended S-Corp and Partnership returns due.", category: "Federal Tax", severity: "high" },
  { month: 10, day: 15, title: "Extended individual returns", description: "Extended Form 1040 due.", category: "Federal Tax", severity: "high" },
  { month: 12, day: 31, title: "QOZ investment deadline", description: "Invest gains in Qualified Opportunity Zone by year-end.", category: "Tax Strategy", severity: "critical" },
  { month: 12, day: 31, title: "Year-end harvesting", description: "Last day for tax loss harvesting and timing strategies.", category: "Tax Strategy", severity: "high" },
  { month: 1, day: 1, title: "Annual RESPA review", description: "Review settlement procedures and disclosure compliance.", category: "RESPA", severity: "medium" },
  { month: 6, day: 1, title: "TCPA list hygiene", description: "Scrub marketing lists against DNC registry (renew annually).", category: "TCPA", severity: "high" },
  { month: 12, day: 1, title: "TCPA list hygiene", description: "Second annual DNC registry scrub.", category: "TCPA", severity: "high" },
  { month: 3, day: 31, title: "Dodd-Frank property count review", description: "Verify seller-financing count vs. 3-property exemption limit.", category: "Dodd-Frank", severity: "medium" },
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
            <Clock className="h-4 w-4 text-amber-500" aria-hidden="true" />
            Upcoming compliance deadlines
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3" aria-label="Upcoming compliance deadlines, soonest first">
            {upcomingDeadlines.map((d, i) => {
              const days = daysUntil(d.month, d.day);
              const isUrgent = days <= 14;
              return (
                <li
                  key={i}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${isUrgent ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10" : "border-border"}`}
                  role={isUrgent ? "alert" : undefined}
                >
                  <div className="text-center min-w-[48px]">
                    <p className="text-xs text-muted-foreground">{MONTH_NAMES[d.month - 1]}</p>
                    <p className="text-lg font-bold tabular-nums">{d.day}</p>
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
                    <p className={`text-xs font-medium tabular-nums ${isUrgent ? "text-amber-600" : "text-muted-foreground"}`}>
                      {days === 0 ? "Today!" : `${days}d`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Past deadlines (this year)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" aria-label="Past deadlines this year">
            {pastDeadlines.map((d, i) => (
              <li key={i} className="flex items-center gap-3 opacity-60">
                <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" aria-label="Past" />
                <span className="text-sm tabular-nums">{MONTH_NAMES[d.month - 1]} {d.day}</span>
                <span className="text-sm">— {d.title}</span>
                <Badge className={`text-xs py-0 ml-auto ${CATEGORY_COLORS[d.category] || ""}`}>{d.category}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
