import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  AlertTriangle, AlertCircle, Info, RefreshCw, X, Loader2, ShieldCheck
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
  critical: { icon: AlertCircle, color: "text-acr-neg", bg: "bg-acr-neg-soft dark:bg-acr-neg-soft/20 border-acr-neg-soft dark:border-acr-neg-soft", badge: "destructive" as const },
  warning: { icon: AlertTriangle, color: "text-acr-warn", bg: "bg-acr-warn-soft dark:bg-acr-warn-soft/20 border-acr-warn-soft dark:border-acr-warn-soft", badge: "outline" as const },
  info: { icon: Info, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/20 border-acr-accent dark:border-acr-accent", badge: "secondary" as const },
};

function AlertCard({ alert, onDismiss }: { alert: PortfolioAlert; onDismiss: (id: number) => void }) {
  const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
  const Icon = config.icon;
  const entityCount = alert.metadata
    ? (alert.metadata.noteIds?.length ?? alert.metadata.leadIds?.length ?? alert.metadata.dealIds?.length ?? alert.metadata.propertyIds?.length ?? 0)
    : 0;

  return (
    <div
      className={`border rounded-lg p-4 space-y-2 ${config.bg}`}
      role={alert.severity === "critical" ? "alert" : "status"}
      aria-live={alert.severity === "critical" ? "assertive" : "polite"}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${config.color}`} aria-hidden="true" />
          <div>
            <p className="font-medium text-sm">{alert.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 min-h-9 min-w-9 shrink-0"
          onClick={() => onDismiss(alert.id)}
          aria-label={`Dismiss alert: ${alert.title}`}
        >
          <X className="w-3 h-3" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={config.badge} className="text-xs capitalize">{alert.severity}</Badge>
        {alert.relatedEntityType && (
          <Badge variant="outline" className="text-xs capitalize">{alert.relatedEntityType}</Badge>
        )}
        {entityCount > 0 && (
          <span className="text-xs text-muted-foreground">
            <span className="tabular-nums">{entityCount}</span> affected record{entityCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {new Date(alert.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export default function PortfolioHealthPage() {
  useDocumentTitle("Portfolio health");
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
        title: "Health scan complete.",
        description: `${data.alertsGenerated ?? 0} active alert${data.alertsGenerated === 1 ? "" : "s"} found.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/portfolio-health/alerts"] });
    },
    onError: () =>
      toast({
        title: "Couldn't run health scan",
        description: "Your existing alerts are unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const dismissAlert = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/portfolio-health/alerts/${id}`),
    onSuccess: () => {
      toast({ title: "Alert dismissed." });
      qc.invalidateQueries({ queryKey: ["/api/portfolio-health/alerts"] });
    },
    onError: () =>
      toast({
        title: "Couldn't dismiss alert",
        description: "The alert is still active.",
        variant: "destructive",
      }),
  });

  const alerts = data?.alerts ?? [];
  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const warningCount = alerts.filter(a => a.severity === "warning").length;
  const infoCount = alerts.filter(a => a.severity === "info").length;

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-portfolio-health-title">
            Portfolio health
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Proactive alerts for notes, leads, deals, and properties.
          </p>
        </div>
        <Button onClick={() => runScan.mutate()} disabled={runScan.isPending} className="min-h-11">
          {runScan.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Scanning…</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />Run health scan</>
          )}
        </Button>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Card className={criticalCount > 0 ? "border-acr-neg dark:border-acr-neg" : ""}>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-acr-neg mb-1">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">Critical</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{criticalCount}</dd>
          </CardContent>
        </Card>
        <Card className={warningCount > 0 ? "border-acr-warn dark:border-acr-warn" : ""}>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-acr-warn mb-1">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">Warnings</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{warningCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-acr-accent mb-1">
              <Info className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-medium">Info</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{infoCount}</dd>
          </CardContent>
        </Card>
      </dl>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" aria-live="polite">
          <ShieldCheck className="w-12 h-12 text-acr-pos" aria-hidden="true" />
          <h2 className="font-semibold text-lg">Portfolio is healthy.</h2>
          <p className="text-muted-foreground text-sm max-w-md">
            No active alerts. Run a health scan to check for issues across your notes, leads, deals, and properties.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            <span className="tabular-nums">{alerts.length}</span> active alert{alerts.length !== 1 ? "s" : ""}
          </h2>
          <ul className="space-y-3" aria-label="Portfolio health alerts">
            {alerts
              .sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 };
                return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
              })
              .map(alert => (
                <li key={alert.id}>
                  <AlertCard
                    alert={alert}
                    onDismiss={(id) => dismissAlert.mutate(id)}
                  />
                </li>
              ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
