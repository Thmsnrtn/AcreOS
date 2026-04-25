/**
 * T10 — External Integration Health Dashboard
 * Live status of Stripe, Twilio, SendGrid, OpenAI, Regrid, Lob
 * Mounted at /admin/integrations-health — founder-only
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Activity } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface ServiceHealth {
  name: string;
  status: "operational" | "degraded" | "outage" | "unknown";
  latency?: number;
  lastChecked: string;
  message?: string;
}

interface HealthResponse {
  services: ServiceHealth[];
  timestamp: string;
  overall: "operational" | "degraded" | "outage";
}

const STATUS_CONFIG = {
  operational: {
    icon: CheckCircle2,
    color: "text-green-600",
    badge: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
    label: "Operational",
  },
  degraded: {
    icon: AlertTriangle,
    color: "text-amber-600",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    label: "Degraded",
  },
  outage: {
    icon: XCircle,
    color: "text-red-600",
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    label: "Outage",
  },
  unknown: {
    icon: HelpCircle,
    color: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
    label: "Unknown",
  },
};

export default function IntegrationsHealth() {
  useDocumentTitle("Integration health");
  const { data, isLoading, refetch, isFetching } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Cycle 11 fix: /api/health may return an "overall" status the
  // client doesn't have a STATUS_CONFIG entry for (e.g. "healthy"
  // instead of "operational") or may not respond at all. Previously
  // this threw `Cannot read properties of undefined (reading 'icon')`
  // and fired the global error boundary. Fall back to "unknown".
  const overallConfig = STATUS_CONFIG[(data?.overall as keyof typeof STATUS_CONFIG) ?? "unknown"] ?? STATUS_CONFIG.unknown;
  const OverallIcon = overallConfig.icon;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Integration health</h1>
          <p className="text-sm text-muted-foreground">
            Live status of all external service dependencies
            {data?.timestamp && (
              <> — checked <span className="tabular-nums">{new Date(data.timestamp).toLocaleTimeString()}</span></>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh integration status"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Overall status banner */}
      {data && (
        <Card className={`border-2 ${
          data.overall === "operational"
            ? "border-green-200 dark:border-green-800"
            : data.overall === "degraded"
            ? "border-amber-200 dark:border-amber-800"
            : "border-red-200 dark:border-red-800"
        }`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <OverallIcon className={`h-6 w-6 ${overallConfig.color}`} aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {data.overall === "operational"
                    ? "All systems operational"
                    : data.overall === "degraded"
                    ? "Degraded performance"
                    : "Service disruption"}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="tabular-nums">{(data.services ?? []).filter((s) => s.status === "operational").length}</span>
                  {" "}of{" "}
                  <span className="tabular-nums">{(data.services ?? []).length}</span>
                  {" "}services operational
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="status" aria-live="polite">
          <span className="sr-only">Loading integration status…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-24 bg-muted/30 rounded-xl" />
            </Card>
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="External services">
          {(data?.services ?? []).map((service) => {
            const config = STATUS_CONFIG[service.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.unknown;
            const Icon = config.icon;
            return (
              <li key={service.name}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon className={`h-5 w-5 ${config.color} flex-shrink-0`} aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="font-medium">{service.name}</p>
                          {service.message && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {service.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.badge}`}
                          aria-label={`Status: ${config.label}`}
                        >
                          {config.label}
                        </span>
                        {service.latency !== undefined && (
                          <span
                            className="text-xs text-muted-foreground flex items-center gap-1"
                            aria-label={`Latency ${service.latency} milliseconds`}
                          >
                            <Activity className="h-3 w-3" aria-hidden="true" />
                            <span className="tabular-nums">{service.latency}ms</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">About integration monitoring</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Each service is checked every 60 seconds. A service is marked <strong>Degraded</strong> if
            response latency exceeds <span className="tabular-nums">3,000ms</span>. <strong>Outage</strong> is reported when a 5xx error is
            returned or the request times out.
          </p>
          <p>
            Sophie Observer automatically sends an alert when any integration degrades below
            operational status. Configure notification preferences in{" "}
            <a href="/settings" className="underline text-primary">
              Settings → Notifications
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
