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
  warning: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 text-amber-800",
  celebration: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 text-emerald-800",
  nudge: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 text-blue-800",
  milestone: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 text-purple-800",
};

function EnergyBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <Battery className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium">{score}%</span>
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

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  const data = wellbeing as WellbeingData | null;
  if (!data?.metrics) {
    return (
      <Card><CardContent className="py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Heart className="h-4 w-4" /> No wellbeing data yet.</div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => assessMutation.mutate()}>
          <RefreshCw className="h-3 w-3 mr-1" /> Assess
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
          <CardTitle className="text-base flex items-center gap-2"><Heart className="h-4 w-4" /> Founder Wellbeing</CardTitle>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => assessMutation.mutate()}>
            <RefreshCw className={`h-2.5 w-2.5 mr-1 ${assessMutation.isPending ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <EnergyBar score={data.energyScore || 50} />

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{m.overrideCount} overrides this week {m.overrideAvgWeekly > 0 ? `(avg: ${m.overrideAvgWeekly})` : ""}</span>
          <span>{m.daysSinceLastBreak < 999 ? `${m.daysSinceLastBreak}d since break` : "No break taken"}</span>
          <span>Team success: {m.agentSuccessRateWithoutCEO}%</span>
        </div>

        {insights.map((insight, i) => {
          const Icon = INSIGHT_ICONS[insight.type] || Heart;
          const colorClass = INSIGHT_COLORS[insight.type] || "";
          return (
            <div key={i} className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${colorClass}`}>
              <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{insight.message}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
