import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { usePageMeta } from "@/hooks/use-document-title";
import { formatDateTime } from "@/lib/format";
import { SupportFeedbackButton } from "@/components/support-feedback-button";

type Tone = "green" | "amber" | "red" | "gray";
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
