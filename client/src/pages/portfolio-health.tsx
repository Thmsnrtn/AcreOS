import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertTriangle, AlertCircle, Info, CheckCircle2, RefreshCw, X, Loader2, ShieldCheck
} from "lucide-react";

interface PortfolioAlert {
  id: number;
  type: string;
  alertType: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  status: string;
  relatedEntityType?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800", badge: "destructive" as const },
  warning: { icon: AlertTriangle, color: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800", badge: "outline" as const },
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800", badge: "secondary" as const },
};

function AlertCard({ alert, onDismiss }: { alert: PortfolioAlert; onDismiss: (id: number) => void }) {
  const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  const entityCount = alert.metadata
    ? (alert.metadata.noteIds?.length ?? alert.metadata.leadIds?.length ?? alert.metadata.dealIds?.length ?? alert.metadata.propertyIds?.length ?? 0)
    : 0;

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${config.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${config.color}`} />
          <div>
            <p className="font-medium text-sm">{alert.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => onDismiss(alert.id)}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={config.badge} className="text-xs capitalize">{alert.severity}</Badge>
        {alert.relatedEntityType && (
          <Badge variant="outline" className="text-xs capitalize">{alert.relatedEntityType}</Badge>
        )}
        {entityCount > 0 && (
          <span className="text-xs text-muted-foreground">{entityCount} affected records</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(alert.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export default function PortfolioHealthPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ alerts: PortfolioAlert[] }>({
    queryKey: ["/api/portfolio-health/alerts"],
    queryFn: () => fetch("/api/portfolio-health/alerts").then(r => r.json()),
  });

  const runScan = useMutation({
    mutationFn: () => apiRequest("POST", "/api/portfolio-health/run"),
    onSuccess: (data: any) => {
      toast({
        title: "Health scan complete",
        description: `${data.alertsGenerated ?? 0} active alerts found.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/portfolio-health/alerts"] });
    },
    onError: () => toast({ title: "Scan failed", variant: "destructive" }),
  });

  const dismissAlert = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/portfolio-health/alerts/${id}`),
    onSuccess: () => {
      toast({ title: "Alert dismissed" });
      qc.invalidateQueries({ queryKey: ["/api/portfolio-health/alerts"] });
    },
    onError: () => toast({ title: "Failed to dismiss", variant: "destructive" }),
  });

  const alerts = data?.alerts ?? [];
  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const infoCount = alerts.filter(a => a.severity === "info").length;

  return (
    <PageShell>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-portfolio-health-title">
            Portfolio Health
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Proactive alerts for notes, leads, deals, and properties.
          </p>
        </div>
        <Button onClick={() => runScan.mutate()} disabled={runScan.isPending}>
          {runScan.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning...</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" />Run Health Scan</>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className={criticalCount > 0 ? "border-red-300 dark:border-red-700" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-600 mb-1">
              <AlertCircle className="w-4 h-4" />
              <span className="text-xs font-medium">Critical</span>
            </div>
            <p className="text-2xl font-bold">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card className={warningCount > 0 ? "border-yellow-300 dark:border-yellow-700" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-yellow-600 mb-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Warnings</span>
            </div>
            <p className="text-2xl font-bold">{warningCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-blue-600 mb-1">
              <Info className="w-4 h-4" />
              <span className="text-xs font-medium">Info</span>
            </div>
            <p className="text-2xl font-bold">{infoCount}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldCheck className="w-12 h-12 text-green-500" />
          <h3 className="font-semibold text-lg">Portfolio is Healthy</h3>
          <p className="text-muted-foreground text-sm max-w-md">
            No active alerts. Run a health scan to check for issues across your notes, leads, deals, and properties.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{alerts.length} Active Alert{alerts.length !== 1 ? "s" : ""}</h2>
          {alerts
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 };
              return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
            })
            .map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onDismiss={(id) => dismissAlert.mutate(id)}
              />
            ))}
        </div>
      )}
    </PageShell>
  );
}
