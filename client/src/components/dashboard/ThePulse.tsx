import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle } from "lucide-react";

interface TrafficLight {
  green: boolean;
  label: string;
  detail: string;
}

interface PulseStatus {
  revenueHealth: TrafficLight;
  systemHealth: TrafficLight;
  sophieHealth: TrafficLight;
  churnRisk: TrafficLight;
  allClear: boolean;
  decisionsInboxCount: number;
}

interface ThePulseProps {
  decisionsInboxCount?: number;
}

const lights = [
  { key: "revenueHealth" as const, title: "Revenue Health" },
  { key: "systemHealth" as const, title: "System Health" },
  { key: "sophieHealth" as const, title: "Sophie Health" },
  { key: "churnRisk" as const, title: "Churn Risk" },
];

export function ThePulse({ decisionsInboxCount }: ThePulseProps) {
  const { data, isLoading } = useQuery<{ pulseStatus: PulseStatus }>({
    queryKey: ["/api/founder/intelligence/pulse"],
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  const pulse = data?.pulseStatus;
  const allClear = pulse?.allClear && (decisionsInboxCount ?? pulse?.decisionsInboxCount ?? 0) === 0;

  if (isLoading) {
    return (
      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0">
          <div className="flex gap-3 animate-pulse">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-20 flex-1 rounded-lg bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">The Pulse</h2>
        <span className="text-xs text-muted-foreground">Updates every 30s</span>
      </div>

      {allClear && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            All systems nominal. 0 decisions pending. Platform is running passively.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {lights.map(({ key, title }) => {
          const light = pulse?.[key];
          const isGreen = light?.green ?? false;

          return (
            <Card
              key={key}
              className={`border transition-colors ${
                isGreen
                  ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20"
                  : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
              }`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{title}</span>
                  <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${isGreen ? "bg-green-500" : "bg-red-500"}`} />
                </div>
                <p className={`mt-1 text-sm font-semibold ${isGreen ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                  {light?.label ?? (isLoading ? "…" : "Unknown")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-tight">
                  {light?.detail ?? ""}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
