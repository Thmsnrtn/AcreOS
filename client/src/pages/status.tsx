import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2; label: string }> = {
  operational: { color: "bg-green-500", icon: CheckCircle2, label: "Operational" },
  degraded: { color: "bg-yellow-500", icon: AlertTriangle, label: "Degraded" },
  outage: { color: "bg-red-500", icon: XCircle, label: "Outage" },
  unknown: { color: "bg-gray-400", icon: AlertTriangle, label: "Unknown" },
};

export default function StatusPage() {
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
            <div className={`w-3 h-3 rounded-full ${config.color}`} />
            <span className="text-lg font-medium">{isLoading ? "Checking..." : config.label}</span>
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
              <div className="p-6 text-center text-muted-foreground">Loading status...</div>
            ) : (
              data?.services.map((service) => {
                const svc = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
                const SvcIcon = svc.icon;
                return (
                  <div key={service.name} className="flex items-center justify-between px-6 py-4 border-t first:border-t-0">
                    <span className="font-medium capitalize">{service.name}</span>
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
