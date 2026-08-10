import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { usePageMeta } from "@/hooks/use-document-title";
import { formatDateTime } from "@/lib/format";
import { SupportFeedbackButton } from "@/components/support-feedback-button";
import type { PublicSloStatus, CanaryStepStatus } from "@shared/slo";

type Tone = "green" | "amber" | "red" | "gray";

// O4 — canary step/run states share the services' visual grammar.
const CANARY_STATUS: Record<
  CanaryStepStatus,
  { tone: Tone; icon: typeof CheckCircle2; label: string; iconClass: string }
> = {
  ok:       { tone: "green", icon: CheckCircle2,  label: "OK",       iconClass: "text-acr-pos" },
  degraded: { tone: "amber", icon: AlertTriangle, label: "Degraded", iconClass: "text-acr-warn" },
  failing:  { tone: "red",   icon: XCircle,       label: "Failing",  iconClass: "text-acr-neg" },
};
const STATUS_CONFIG: Record<string, { tone: Tone; icon: typeof CheckCircle2; label: string }> = {
  operational: { tone: "green", icon: CheckCircle2, label: "Operational" },
  degraded:    { tone: "amber", icon: AlertTriangle, label: "Degraded" },
  outage:      { tone: "red",   icon: XCircle, label: "Outage" },
  unknown:     { tone: "gray",  icon: AlertTriangle, label: "Unknown" },
};

// Branded names need explicit casing — Tailwind's `capitalize` only
// uppercases the first letter, so "openai" became "Openai".
const SERVICE_DISPLAY_NAME: Record<string, string> = {
  database: "Database",
  redis: "Redis",
  stripe: "Stripe",
  openai: "OpenAI",
  twilio: "Twilio",
  email: "Email (SES)",
  lob: "Lob",
  anthropic: "Anthropic",
  clerk: "Clerk",
};

export default function StatusPage() {
  usePageMeta(
    "System status",
    "Live status of AcreOS platform services — database, authentication, email, SMS, payments, and integrations. Real-time health checks."
  );
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<{
    status: string;
    services: { name: string; status: string }[];
    lastChecked: string;
    // O4 — SLO register + canary payload. Null when the truth layer itself
    // couldn't be read (rendered as honestly unavailable, never invented).
    slo?: PublicSloStatus | null;
  }>({
    queryKey: ["/api/status"],
    refetchInterval: 30000,
  });

  const overall = data?.status || "unknown";
  const config = STATUS_CONFIG[overall] || STATUS_CONFIG.unknown;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" /> Back to AcreOS
            </Link>
          </Button>
        </div>

        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-2">AcreOS system status</h1>
          <div className="flex items-center justify-center gap-2 mt-4">
            <StatusDot
              tone={config.tone}
              size="lg"
              pulse={config.tone === "green"}
              label={
                <span className="text-lg font-medium">
                  {isLoading ? "Checking…" : isError ? "Status check unavailable" : config.label}
                </span>
              }
            />
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg">Services</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="min-h-[44px] min-w-[44px]"
              aria-label="Refresh service status"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              // Shaped to match the real status rows: service name left, status badge right.
              <div role="status" aria-busy="true" data-testid="status-services-loading">
                <span className="sr-only">Loading service status…</span>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-6 py-4 border-t first:border-t-0"
                  >
                    <Skeleton announce={false} className="h-5 w-28" />
                    <Skeleton announce={false} className="h-6 w-28 rounded-full" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              // A status page that fails silently is self-defeating — say so, with retry.
              <QueryErrorState
                error={error instanceof Error ? error : null}
                onRetry={() => refetch()}
                isRetrying={isRefetching}
                title="Can't load service status"
                description="The status check itself didn't respond. That may indicate a wider issue — try again in a moment."
                testId="status-error-state"
              />
            ) : !data?.services?.length ? (
              <EmptyState
                icon={AlertTriangle}
                headline="No service checks reported"
                subtitle="The status endpoint responded but returned no services. Refresh to re-run the checks."
                cta={{
                  label: "Refresh status",
                  onClick: () => refetch(),
                  "data-testid": "status-empty-refresh",
                }}
                actionIcon={RefreshCw}
                testId="status-empty-state"
              />
            ) : (
              <ul aria-label="Platform services">
                {data.services.map((service) => {
                  const svc = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
                  const SvcIcon = svc.icon;
                  return (
                    <li
                      key={service.name}
                      className="flex items-center justify-between px-6 py-4 border-t first:border-t-0"
                    >
                      <span className="font-medium">
                        {SERVICE_DISPLAY_NAME[service.name.toLowerCase()] ??
                          service.name.charAt(0).toUpperCase() + service.name.slice(1)}
                      </span>
                      <Badge variant="outline" className="gap-1.5">
                        <SvcIcon
                          className={`w-3.5 h-3.5 ${service.status === "operational" ? "text-acr-pos" : service.status === "degraded" ? "text-acr-warn" : "text-acr-neg"}`}
                          aria-hidden="true"
                        />
                        {svc.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {data?.lastChecked && (
          <p className="text-center text-sm text-muted-foreground mt-6">
            Last checked: <span className="tabular-nums">{formatDateTime(data.lastChecked)}</span>
          </p>
        )}

        {/* O4 — the SLO register: declared promises with DERIVED sensor state.
            A target without a live reading renders as honestly absent — this
            page never invents a number. Hidden on query error: the services
            card above already carries the one retry surface. */}
        {!isError && (
          <Card className="mt-8" data-testid="slo-register">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Service promises</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                // Shaped like the real rows: name + badge line, two text lines.
                <div role="status" aria-busy="true" data-testid="slo-register-loading">
                  <span className="sr-only">Loading service promises…</span>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-6 py-4 border-t first:border-t-0 space-y-2">
                      <div className="flex items-center justify-between">
                        <Skeleton announce={false} className="h-5 w-52" />
                        <Skeleton announce={false} className="h-6 w-32 rounded-full" />
                      </div>
                      <Skeleton announce={false} className="h-4 w-full" />
                      <Skeleton announce={false} className="h-4 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : !data?.slo?.rows?.length ? (
                <p
                  className="px-6 py-4 text-sm text-muted-foreground"
                  data-testid="slo-unavailable"
                >
                  Service-promise telemetry is unavailable right now. Nothing is
                  shown rather than an invented number — refresh to try again.
                </p>
              ) : (
                <ul aria-label="Service-level promises">
                  {data.slo.rows.map((row) => (
                    <li
                      key={row.surfaceClass}
                      className="px-6 py-4 border-t first:border-t-0 space-y-1.5"
                      data-testid={`slo-row-${row.surfaceClass}`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="font-medium">{row.name}</span>
                        {row.wired && row.current ? (
                          <Badge variant="outline" className="gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
                            Sensed
                          </Badge>
                        ) : row.wired ? (
                          <Badge variant="outline" className="gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-acr-warn" aria-hidden="true" />
                            Wired — no data yet
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                            Declared — not yet sensed
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{row.promise}</p>
                      <p className="text-sm">
                        Target: <span className="text-muted-foreground">{row.target}</span>
                      </p>
                      {row.wired && row.current ? (
                        <p className="text-sm" data-testid={`slo-current-${row.surfaceClass}`}>
                          {row.current.label}:{" "}
                          <span className="tabular-nums">{row.current.value}</span>
                          {row.current.asOf && (
                            <>
                              {" "}· as of{" "}
                              <span className="tabular-nums">{formatDateTime(row.current.asOf)}</span>
                            </>
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No measured value yet — this target only ever renders from live telemetry.
                        </p>
                      )}
                      {row.notYetSensed.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Declared, not yet sensed: {row.notYetSensed.join(" · ")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* O4 — the persona-journey canary: a scheduled synthetic walk of a
            real minimal journey, per-step latency + success from recorded
            runs only. */}
        {!isError && !isLoading && data?.slo && (
          <Card className="mt-8" data-testid="journey-canary">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Journey canary</CardTitle>
            </CardHeader>
            <CardContent className={data.slo.canary.lastRun ? undefined : "p-0"}>
              {data.slo.canary.lastRun ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <StatusDot
                      tone={CANARY_STATUS[data.slo.canary.lastRun.overallStatus].tone}
                      label={
                        <span className="font-medium">
                          {CANARY_STATUS[data.slo.canary.lastRun.overallStatus].label}
                        </span>
                      }
                    />
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatDateTime(data.slo.canary.lastRun.at)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {data.slo.canary.lastRun.substrate === "demo_org"
                      ? "Walked against the public demo workspace (sample-marked data only)."
                      : "Demo workspace not provisioned — walked the deepest platform journey available instead, recorded honestly."}
                  </p>
                  <ul aria-label="Canary journey steps">
                    {data.slo.canary.lastRun.steps.map((step) => {
                      const cfg = CANARY_STATUS[step.status] ?? CANARY_STATUS.failing;
                      const StepIcon = cfg.icon;
                      return (
                        <li
                          key={step.key}
                          className="flex items-center justify-between gap-3 py-2 border-t first:border-t-0"
                        >
                          <span className="text-sm">{step.label}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {step.latencyMs != null && (
                              <span className="text-sm text-muted-foreground tabular-nums">
                                {step.latencyMs} ms
                              </span>
                            )}
                            <Badge variant="outline" className="gap-1.5">
                              <StepIcon
                                className={`w-3.5 h-3.5 ${cfg.iconClass}`}
                                aria-hidden="true"
                              />
                              {cfg.label}
                            </Badge>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {data.slo.canary.window24h && data.slo.canary.window24h.runs > 0 && (
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Last 24h:{" "}
                      {data.slo.canary.window24h.runs - data.slo.canary.window24h.failing} of{" "}
                      {data.slo.canary.window24h.runs} runs healthy
                      {data.slo.canary.window24h.burnRate != null && (
                        <> · error-budget burn at {data.slo.canary.window24h.burnRate.toFixed(2)}× budget pace</>
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={Activity}
                  headline="No canary runs recorded yet"
                  subtitle="The persona-journey canary walks a real minimal journey every 30 minutes. Its first recorded run will appear here — nothing is simulated in the meantime."
                  cta={{
                    label: "Refresh status",
                    onClick: () => refetch(),
                    "data-testid": "canary-empty-refresh",
                  }}
                  actionIcon={RefreshCw}
                  testId="canary-empty-state"
                />
              )}
            </CardContent>
          </Card>
        )}

        <div className="text-center mt-12 space-y-2">
          <p className="text-sm text-muted-foreground">
            Questions?{" "}
            <SupportFeedbackButton
              variant="link"
              defaultCategory="question"
              source="status_page"
              ariaLabel="Open support form to ask about service status"
              testId="status-contact"
            >
              Contact us
            </SupportFeedbackButton>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
