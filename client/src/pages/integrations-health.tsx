/**
 * T10 — External Integration Health Dashboard
 * Live status of Stripe, Twilio, SendGrid, OpenAI, Regrid, Lob
 * Mounted at /admin/integrations-health — founder-only
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Activity } from "lucide-react";

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
  const { data, isLoading, refetch, isFetching } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
    refetchInterval: 60_000, // Re-check every 60s
    staleTime: 30_000,
  });

  const overallConfig = STATUS_CONFIG[data?.overall ?? "unknown"];
  const OverallIcon = overallConfig.icon;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integration Health</h1>
          <p className="text-sm text-muted-foreground">
            Live status of all external service dependencies
            {data?.timestamp && (
              <> — checked {new Date(data.timestamp).toLocaleTimeString()}</>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
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
              <OverallIcon className={`h-6 w-6 ${overallConfig.color}`} />
              <div>
                <p className="font-semibold">
                  All Systems{" "}
                  {data.overall === "operational"
                    ? "Operational"
                    : data.overall === "degraded"
                    ? "— Degraded Performance"
                    : "— Service Disruption"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {(data.services ?? []).filter((s) => s.status === "operational").length} of{" "}
                  {(data.services ?? []).length} services operational
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-4 h-24 bg-muted/30 rounded-xl" />
              </Card>
            ))
          : (data?.services ?? []).map((service) => {
              const config = STATUS_CONFIG[service.status];
              const Icon = config.icon;
              return (
                <Card key={service.name}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Icon className={`h-5 w-5 ${config.color} flex-shrink-0`} />
                        <div>
                          <p className="font-medium">{service.name}</p>
                          {service.message && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {service.message}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.badge}`}
                        >
                          {config.label}
                        </span>
                        {service.latency !== undefined && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Activity className="h-3 w-3" />
                            {service.latency}ms
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Latency chart placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">About Integration Monitoring</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Each service is checked every 60 seconds. A service is marked <strong>Degraded</strong> if
            response latency exceeds 3,000ms. <strong>Outage</strong> is reported when a 5xx error is
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
