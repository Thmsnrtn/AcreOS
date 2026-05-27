/**
 * Founder Wellbeing Card — Sovereign Company Protocol v8
 * "Your team is handling things. Here's how YOU'RE doing."
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, AlertTriangle, PartyPopper, Coffee, Trophy, RefreshCw, Battery } from "lucide-react";

interface WellbeingData {
  id: number;
  metrics: {
    overrideCount: number; overrideAvgWeekly: number; daysSinceLastBreak: number;
    agentSuccessRateWithoutCEO: number; winCount: number; stressSignals: string[];
  };
  insights: Array<{ type: string; message: string; severity?: string }>;
  energyScore: number;
}

const INSIGHT_ICONS: Record<string, any> = {
  warning: AlertTriangle, celebration: PartyPopper, nudge: Coffee, milestone: Trophy,
};
const INSIGHT_COLORS: Record<string, string> = {
  warning: "bg-acr-warn-soft dark:bg-acr-warn-soft/20 border-acr-warn-soft text-acr-warn",
  celebration: "bg-acr-pos-soft dark:bg-acr-pos-soft/20 border-acr-pos-soft text-acr-pos",
  nudge: "bg-acr-accent dark:bg-acr-accent/20 border-acr-accent text-acr-accent",
  milestone: "bg-acr-brand-soft dark:bg-acr-brand-soft/20 border-acr-brand-soft text-acr-brand",
};

function EnergyBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-acr-pos" : score >= 40 ? "bg-acr-warn" : "bg-acr-neg";
  return (
    <div className="flex items-center gap-2">
      <Battery className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <div
        role="progressbar"
        aria-label={`Energy score: ${score} out of 100`}
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex-1 h-2 rounded-full bg-muted overflow-hidden"
      >
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums">{score}%</span>
    </div>
  );
}

export function FounderWellbeingCard() {
  const queryClient = useQueryClient();
  const { data: wellbeing, isLoading } = useQuery({
    queryKey: ["/api/founder/v8/wellbeing"],
    queryFn: () => apiRequest("GET", "/api/founder/v8/wellbeing").then(r => r.json()),
    refetchInterval: 60000,
  });

  const assessMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v8/wellbeing/assess"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v8/wellbeing"] }),
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading wellbeing" className="h-32 w-full rounded-xl" />;

  const data = wellbeing as WellbeingData | null;
  if (!data?.metrics) {
    return (
      <Card><CardContent className="py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Heart className="h-4 w-4" aria-hidden="true" /> No wellbeing data yet.</div>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => assessMutation.mutate()} disabled={assessMutation.isPending} aria-busy={assessMutation.isPending}>
          <RefreshCw className={`h-3 w-3 mr-1 ${assessMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" /> {assessMutation.isPending ? "Assessing…" : "Assess"}
        </Button>
      </CardContent></Card>
    );
  }

  const m = data.metrics;
  const insights = data.insights || [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Heart className="h-4 w-4" aria-hidden="true" /> Founder wellbeing</CardTitle>
          <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => assessMutation.mutate()} disabled={assessMutation.isPending} aria-busy={assessMutation.isPending} aria-label="Refresh wellbeing assessment">
            <RefreshCw className={`h-2.5 w-2.5 mr-1 ${assessMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <EnergyBar score={data.energyScore || 50} />

        <ul aria-label="Wellbeing metrics" className="flex items-center gap-4 text-xs text-muted-foreground list-none p-0 m-0">
          <li aria-label={`${m.overrideCount} overrides this week${m.overrideAvgWeekly > 0 ? `, average ${m.overrideAvgWeekly}` : ""}`}>
            <span className="tabular-nums">{m.overrideCount}</span> overrides this week {m.overrideAvgWeekly > 0 ? <>(avg: <span className="tabular-nums">{m.overrideAvgWeekly}</span>)</> : ""}
          </li>
          <li aria-label={m.daysSinceLastBreak < 999 ? `${m.daysSinceLastBreak} days since break` : "No break taken"}>
            {m.daysSinceLastBreak < 999 ? <><span className="tabular-nums">{m.daysSinceLastBreak}</span>d since break</> : "No break taken"}
          </li>
          <li aria-label={`Team success rate without CEO: ${m.agentSuccessRateWithoutCEO}%`}>
            Team success: <span className="tabular-nums">{m.agentSuccessRateWithoutCEO}%</span>
          </li>
        </ul>

        {insights.length > 0 && (
          <ul aria-label="Wellbeing insights" className="space-y-2 list-none p-0 m-0">
            {insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || Heart;
              const colorClass = INSIGHT_COLORS[insight.type] || "";
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2 p-2.5 rounded-card border text-xs ${colorClass}`}
                  role={insight.type === "warning" ? "alert" : insight.type === "celebration" || insight.type === "milestone" ? "status" : undefined}
                >
                  <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{insight.message}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
