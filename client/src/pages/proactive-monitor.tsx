import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  RefreshCw,
  Shield,
  Loader2,
  Zap,
  Database,
  TrendingDown,
  Eye,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SystemAlert {
  id: number;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  resolvedAt?: string;
  createdAt: string;
  metadata?: any;
}

interface MonitorRunResult {
  success: boolean;
  activityAnomaly: { hasAnomaly: boolean; details?: any };
  integrityIssues: Array<{ type: string; table: string; count: number; description: string }>;
  anomalies: any;
  checkedAt: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-900/20", border: "border-red-200 dark:border-red-800", badge: "destructive" as const },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-800", badge: "secondary" as const },
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-200 dark:border-blue-800", badge: "outline" as const },
};

export default function ProactiveMonitorPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = useState<MonitorRunResult | null>(null);

  const { data, isLoading, refetch } = useQuery<{ alerts: SystemAlert[]; count: number }>({
    queryKey: ["/api/monitor/alerts"],
    queryFn: () => fetch("/api/monitor/alerts").then(r => r.json()),
    refetchInterval: 60000,
  });

  const runMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/monitor/run").then(r => r.json()),
    onSuccess: (result: MonitorRunResult) => {
      setLastRun(result);
      queryClient.invalidateQueries({ queryKey: ["/api/monitor/alerts"] });
      toast({ title: "Health checks complete", description: `Checked at ${new Date().toLocaleTimeString()}` });
    },
    onError: (err: any) =>
      toast({ title: "Health check failed", description: err.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: (alertId: number) =>
      apiRequest("POST", `/api/monitor/alerts/${alertId}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monitor/alerts"] });
      toast({ title: "Alert resolved" });
    },
  });

  const alerts = data?.alerts || [];
  const critical = alerts.filter(a => a.severity === "critical" && !a.resolvedAt);
  const warnings = alerts.filter(a => a.severity === "warning" && !a.resolvedAt);
  const resolved = alerts.filter(a => a.resolvedAt);

  const healthScore = critical.length === 0 && warnings.length === 0 ? 100
    : critical.length > 0 ? Math.max(0, 60 - critical.length * 10)
    : Math.max(60, 100 - warnings.length * 5);

  const healthGrade = healthScore >= 90 ? { label: "A", color: "text-emerald-600" }
    : healthScore >= 75 ? { label: "B", color: "text-blue-600" }
    : healthScore >= 60 ? { label: "C", color: "text-amber-600" }
    : { label: "F", color: "text-red-600" };

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Proactive Monitor</h1>
          <p className="text-muted-foreground text-sm mt-0.5">System health, anomaly detection, and data integrity checks</p>
        </div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Run Health Checks
        </Button>
      </div>
      {/* Health score + summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5 text-center">
            <p className={`text-4xl font-bold ${healthGrade.color}`}>{healthGrade.label}</p>
            <p className="text-sm text-muted-foreground mt-1">Health Score</p>
            <p className="text-xl font-semibold mt-0.5">{healthScore}/100</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{critical.length}</p>
                <p className="text-sm text-muted-foreground">Critical Alerts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{warnings.length}</p>
                <p className="text-sm text-muted-foreground">Warnings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-2xl font-bold">{resolved.length}</p>
                <p className="text-sm text-muted-foreground">Resolved</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last run results */}
      {lastRun && (
        <Card className="mb-6 border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" />
              Last Health Check — {format(new Date(lastRun.checkedAt), "HH:mm:ss")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`p-3 rounded-lg ${lastRun.activityAnomaly.hasAnomaly ? "bg-amber-50 dark:bg-amber-900/20" : "bg-emerald-50 dark:bg-emerald-900/20"}`}>
                <div className="flex items-center gap-2">
                  <TrendingDown className={`h-4 w-4 ${lastRun.activityAnomaly.hasAnomaly ? "text-amber-600" : "text-emerald-600"}`} />
                  <span className="text-sm font-medium">Activity</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {lastRun.activityAnomaly.hasAnomaly ? "Unusual activity drop detected" : "Activity levels normal"}
                </p>
              </div>
              <div className={`p-3 rounded-lg ${lastRun.integrityIssues.length > 0 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-emerald-50 dark:bg-emerald-900/20"}`}>
                <div className="flex items-center gap-2">
                  <Database className={`h-4 w-4 ${lastRun.integrityIssues.length > 0 ? "text-amber-600" : "text-emerald-600"}`} />
                  <span className="text-sm font-medium">Data Integrity</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {lastRun.integrityIssues.length > 0
                    ? `${lastRun.integrityIssues.length} issue(s) found`
                    : "No integrity issues"}
                </p>
              </div>
              <div className={`p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20`}>
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Anomalies</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Anomaly detection complete</p>
              </div>
            </div>
            {lastRun.integrityIssues.length > 0 && (
              <div className="mt-3 space-y-1">
                {lastRun.integrityIssues.map((issue, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300">
                    • {issue.description} ({issue.count} records in {issue.table})
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">All systems healthy</h3>
            <p className="text-muted-foreground">No alerts or anomalies detected. Run health checks to scan for new issues.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Active alerts first */}
          {alerts.filter(a => !a.resolvedAt).map(alert => {
            const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
            const Icon = cfg.icon;
            return (
              <Card key={alert.id} className={`border ${cfg.border}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`p-1.5 rounded-lg ${cfg.bg} flex-shrink-0`}>
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge variant={cfg.badge}>{alert.severity}</Badge>
                          <span className="font-medium text-sm">{alert.title}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolveMutation.mutate(alert.id)}
                      disabled={resolveMutation.isPending}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Resolve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Resolved alerts (collapsed) */}
          {resolved.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Resolved ({resolved.length})
              </p>
              <div className="space-y-2">
                {resolved.slice(0, 5).map(alert => (
                  <Card key={alert.id} className="opacity-60">
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                        <span className="text-sm font-medium truncate">{alert.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                          {alert.resolvedAt ? formatDistanceToNow(new Date(alert.resolvedAt), { addSuffix: true }) : ""}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
