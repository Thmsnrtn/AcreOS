import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { usePageMeta } from "@/hooks/use-document-title";

type Tone = "green" | "amber" | "red" | "gray";
const STATUS_CONFIG: Record<string, { tone: Tone; icon: typeof CheckCircle2; label: string }> = {
  operational: { tone: "green", icon: CheckCircle2, label: "Operational" },
  degraded:    { tone: "amber", icon: AlertTriangle, label: "Degraded" },
  outage:      { tone: "red",   icon: XCircle, label: "Outage" },
  unknown:     { tone: "gray",  icon: AlertTriangle, label: "Unknown" },
};

// Proper display names. Tailwind's `capitalize` only uppercases the
// first letter, so "openai" became "Openai" — wrong. Branded names
// (OpenAI, Stripe, etc) need explicit casing.
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
  const { data, isLoading, refetch } = useQuery<{
    status: string;
    services: { name: string; status: string }[];
    lastChecked: string;
  }>({
    queryKey: ["/api/status"],
    refetchInterval: 30000,
  });

  const overall = data?.status || "unknown";
  const config = STATUS_CONFIG[overall] || STATUS_CONFIG.unknown;
  const OverallIcon = config.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to AcreOS
            </Link>
          </Button>
        </div>

        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-2">AcreOS System Status</h1>
          <div className="flex items-center justify-center gap-2 mt-4">
            <StatusDot
              tone={config.tone}
              size="lg"
              pulse={config.tone === "green"}
              label={<span className="text-lg font-medium">{isLoading ? "Checking…" : config.label}</span>}
            />
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg">Services</CardTitle>
            <Button variant="ghost" size="icon" onClick={() => refetch()} className="min-h-[44px] min-w-[44px]" aria-label="Refresh status">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground">Checking every service…</div>
            ) : (
              data?.services.map((service) => {
                const svc = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
                const SvcIcon = svc.icon;
                return (
                  <div key={service.name} className="flex items-center justify-between px-6 py-4 border-t first:border-t-0">
                    <span className="font-medium">
                      {SERVICE_DISPLAY_NAME[service.name.toLowerCase()] ??
                        service.name.charAt(0).toUpperCase() + service.name.slice(1)}
                    </span>
                    <Badge variant="outline" className="gap-1.5">
                      <SvcIcon className={`w-3.5 h-3.5 ${service.status === "operational" ? "text-green-600" : service.status === "degraded" ? "text-yellow-600" : "text-red-600"}`} />
                      {svc.label}
                    </Badge>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {data?.lastChecked && (
          <p className="text-center text-sm text-muted-foreground mt-6">
            Last checked: {new Date(data.lastChecked).toLocaleString()}
          </p>
        )}

        <div className="text-center mt-12 space-y-2">
          <p className="text-sm text-muted-foreground">
            Questions? Contact <a href="mailto:support@acreos.io" className="underline hover:text-foreground">support@acreos.io</a>
          </p>
        </div>
      </div>
    </div>
  );
}
