import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

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
  { key: "revenueHealth" as const, title: "Revenue health" },
  { key: "systemHealth" as const, title: "System health" },
  { key: "sophieHealth" as const, title: "Sophie health" },
  { key: "churnRisk" as const, title: "Churn risk" },
];

export function ThePulse({ decisionsInboxCount }: ThePulseProps) {
  const { data, isLoading } = useQuery<{ pulseStatus: PulseStatus }>({
    queryKey: ["/api/founder/intelligence/pulse"],
    // 2026-05-26: dropped 30s polling — refresh on focus only.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });

  const pulse = data?.pulseStatus;
  const allClear = pulse?.allClear && (decisionsInboxCount ?? pulse?.decisionsInboxCount ?? 0) === 0;

  if (isLoading) {
    return (
      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0">
          <div className="flex gap-3 animate-pulse">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-20 flex-1 rounded-card bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <section aria-labelledby="the-pulse-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="the-pulse-heading" className="text-lg font-semibold text-foreground">The Pulse</h2>
        <span className="text-xs text-muted-foreground">Updates every 30s</span>
      </div>

      {allClear && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-card border border-acr-pos-soft bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/30 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-acr-pos dark:text-acr-pos shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium text-acr-pos dark:text-acr-pos">
            All systems nominal. 0 decisions pending. Platform is running passively.
          </p>
        </div>
      )}

      <ul aria-label="Health indicators" className="grid grid-cols-2 gap-3 sm:grid-cols-4 list-none p-0 m-0">
        {lights.map(({ key, title }) => {
          const light = pulse?.[key];
          const isGreen = light?.green ?? false;

          return (
            <li key={key}>
              <Card
                className={`border transition-colors ${
                  isGreen
                    ? "border-acr-pos-soft bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/20"
                    : "border-acr-neg-soft bg-acr-neg-soft dark:border-acr-neg-soft dark:bg-acr-neg-soft/20"
                }`}
                aria-label={`${title}: ${light?.label ?? "Unknown"}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{title}</span>
                    <span aria-hidden="true" className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${isGreen ? "bg-acr-pos" : "bg-acr-neg"}`} />
                  </div>
                  <p className={`mt-1 text-sm font-semibold ${isGreen ? "text-acr-pos dark:text-acr-pos" : "text-acr-neg dark:text-acr-neg"}`}>
                    {light?.label ?? (isLoading ? "…" : "Unknown")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-tight">
                    {light?.detail ?? ""}
                  </p>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
