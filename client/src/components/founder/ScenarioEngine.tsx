/**
 * Scenario Engine — Sovereign Company Protocol v7
 *
 * "What if we raise prices 20%?" → multi-agent simulation
 * with best/median/worst outcomes.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS, AGENT_ROLES } from "@/lib/trust-language";
import {
  FlaskConical,
  Send,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
} from "lucide-react";

interface Scenario {
  id: number;
  title: string;
  hypothesis: string;
  status: string;
  agentAnalyses: Array<{
    agentCodename: string;
    perspective: string;
    analysis: string;
    confidence: string;
  }>;
  scenarios: {
    best: { description: string; probability: number; metrics: Record<string, number> };
    median: { description: string; probability: number; metrics: Record<string, number> };
    worst: { description: string; probability: number; metrics: Record<string, number> };
  } | null;
  recommendation: string | null;
  createdAt: string;
}

const OUTCOME_STYLES = {
  best: { label: "Best Case", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
  median: { label: "Most Likely", icon: Minus, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/20" },
  worst: { label: "Worst Case", icon: TrendingDown, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/20" },
};

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const analyses = scenario.agentAnalyses || [];
  const outcomes = scenario.scenarios;

  return (
    <div className="border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{scenario.title}</div>
          <div className="text-xs text-muted-foreground">{new Date(scenario.createdAt).toLocaleString()}</div>
        </div>
        <Badge variant="outline" className={
          scenario.status === "completed" ? "bg-emerald-100 text-emerald-800" :
          scenario.status === "running" ? "bg-blue-100 text-blue-800 animate-pulse" :
          "bg-red-100 text-red-800"
        }>
          {scenario.status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
          {scenario.status}
        </Badge>
      </div>

      {/* Agent Analyses */}
      {analyses.length > 0 && (
        <div className="space-y-1.5">
          {analyses.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span>{AGENT_AVATARS[a.agentCodename] || "?"}</span>
              <div className="flex-1">
                <span className="font-medium">{AGENT_ROLES[a.agentCodename] || a.agentCodename}</span>
                <span className="text-muted-foreground ml-1">({a.perspective.replace(/_/g, " ")})</span>
                <p className="text-muted-foreground mt-0.5">{a.analysis}</p>
              </div>
              <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{a.confidence}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Outcome Scenarios */}
      {outcomes && (
        <div className="grid grid-cols-3 gap-2">
          {(["best", "median", "worst"] as const).map(key => {
            const outcome = outcomes[key];
            if (!outcome) return null;
            const style = OUTCOME_STYLES[key];
            const Icon = style.icon;

            return (
              <div key={key} className={`p-2.5 rounded-lg ${style.bg}`}>
                <div className={`text-[10px] font-medium ${style.color} flex items-center gap-1`}>
                  <Icon className="h-2.5 w-2.5" />
                  {style.label}
                </div>
                <div className="text-xs mt-1">{outcome.description}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {Math.round(outcome.probability * 100)}% likely
                </div>
                {Object.entries(outcome.metrics || {}).slice(0, 2).map(([k, v]) => (
                  <div key={k} className="text-[10px] text-muted-foreground">
                    {k.replace(/_/g, " ")}: {typeof v === "number" ? (v > 0 ? "+" : "") + v.toLocaleString() : v}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Recommendation */}
      {scenario.recommendation && (
        <div className="p-2.5 rounded-lg bg-muted/50 border">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Recommendation</div>
          <div className="text-sm">{scenario.recommendation}</div>
        </div>
      )}
    </div>
  );
}

export function ScenarioEngine() {
  const queryClient = useQueryClient();
  const [hypothesis, setHypothesis] = useState("");

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ["/api/founder/v7/scenarios"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/scenarios").then(r => r.json()),
    refetchInterval: 5000,
  });

  const simulateMutation = useMutation({
    mutationFn: (h: string) =>
      apiRequest("POST", "/api/founder/v7/scenarios/simulate", { hypothesis: h }),
    onSuccess: () => {
      setHypothesis("");
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/scenarios"] });
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const scenarioList = (scenarios || []) as Scenario[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4" /> What If? Simulator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder="What if we raise prices 20%? What if we hire 3 engineers?"
            className="text-sm h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter" && hypothesis.trim()) {
                simulateMutation.mutate(hypothesis.trim());
              }
            }}
          />
          <Button
            size="sm"
            className="h-9 px-4"
            onClick={() => hypothesis.trim() && simulateMutation.mutate(hypothesis.trim())}
            disabled={!hypothesis.trim() || simulateMutation.isPending}
          >
            {simulateMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <><FlaskConical className="h-3.5 w-3.5 mr-1" /> Simulate</>
            )}
          </Button>
        </div>

        {/* Scenarios */}
        {scenarioList.map(s => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}

        {scenarioList.length === 0 && (
          <div className="text-center py-4 text-xs text-muted-foreground">
            Ask "what if?" and your entire AI team will model the outcomes.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
