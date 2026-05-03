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
  best: { label: "Best case", icon: TrendingUp, color: "text-acr-pos", bg: "bg-acr-pos-soft dark:bg-acr-pos-soft/20" },
  median: { label: "Most likely", icon: Minus, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/20" },
  worst: { label: "Worst case", icon: TrendingDown, color: "text-acr-neg", bg: "bg-acr-neg-soft dark:bg-acr-neg-soft/20" },
};

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const analyses = scenario.agentAnalyses || [];
  const outcomes = scenario.scenarios;

  return (
    <li className="border rounded-xl p-4 space-y-3 list-none">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{scenario.title}</p>
          <time dateTime={scenario.createdAt} className="text-xs text-muted-foreground tabular-nums">{new Date(scenario.createdAt).toLocaleString()}</time>
        </div>
        <Badge
          variant="outline"
          aria-label={`Status: ${scenario.status}`}
          className={
            scenario.status === "completed" ? "bg-acr-pos-soft text-acr-pos capitalize" :
            scenario.status === "running" ? "bg-acr-accent text-acr-accent animate-pulse capitalize" :
            "bg-acr-neg-soft text-acr-neg capitalize"
          }
        >
          {scenario.status === "running" && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" aria-hidden="true" />}
          {scenario.status}
        </Badge>
      </div>

      {/* Agent Analyses */}
      {analyses.length > 0 && (
        <ul aria-label="Agent analyses" className="space-y-1.5 list-none p-0 m-0">
          {analyses.map((a, i) => {
            const role = AGENT_ROLES[a.agentCodename] || a.agentCodename;
            const persp = a.perspective.replace(/_/g, " ");
            return (
              <li key={i} className="flex items-start gap-2 text-xs" aria-label={`${role} (${persp}, ${a.confidence} confidence): ${a.analysis}`}>
                <span aria-hidden="true">{AGENT_AVATARS[a.agentCodename] || "?"}</span>
                <div className="flex-1">
                  <span className="font-medium">{role}</span>
                  <span className="text-muted-foreground ml-1">({persp})</span>
                  <p className="text-muted-foreground mt-0.5 m-0">{a.analysis}</p>
                </div>
                <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0 capitalize">{a.confidence}</Badge>
              </li>
            );
          })}
        </ul>
      )}

      {/* Outcome Scenarios */}
      {outcomes && (
        <ul aria-label="Outcome scenarios" className="grid grid-cols-3 gap-2 list-none p-0 m-0">
          {(["best", "median", "worst"] as const).map(key => {
            const outcome = outcomes[key];
            if (!outcome) return null;
            const style = OUTCOME_STYLES[key];
            const Icon = style.icon;
            const probabilityPct = Math.round(outcome.probability * 100);

            return (
              <li
                key={key}
                className={`p-2.5 rounded-lg ${style.bg}`}
                aria-label={`${style.label}: ${outcome.description}, ${probabilityPct}% likely`}
              >
                <p className={`text-[10px] font-medium ${style.color} flex items-center gap-1 m-0`}>
                  <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                  {style.label}
                </p>
                <p className="text-xs mt-1 m-0">{outcome.description}</p>
                <p className="text-[10px] text-muted-foreground mt-1 m-0">
                  <span className="tabular-nums">{probabilityPct}%</span> likely
                </p>
                {Object.entries(outcome.metrics || {}).slice(0, 2).map(([k, v]) => (
                  <p key={k} className="text-[10px] text-muted-foreground m-0">
                    {k.replace(/_/g, " ")}: <span className="tabular-nums">{typeof v === "number" ? (v > 0 ? "+" : "") + v.toLocaleString() : v}</span>
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {/* Recommendation */}
      {scenario.recommendation && (
        <section aria-labelledby={`recommendation-${scenario.id}`} className="p-2.5 rounded-lg bg-muted/50 border">
          <p id={`recommendation-${scenario.id}`} className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-sm m-0">{scenario.recommendation}</p>
        </section>
      )}
    </li>
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

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading scenarios" className="h-48 w-full rounded-xl" />;

  const scenarioList = (scenarios || []) as Scenario[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4" aria-hidden="true" /> What if? Simulator
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
            aria-label="Hypothesis to simulate"
            autoCapitalize="sentences"
            onKeyDown={(e) => {
              if (e.key === "Enter" && hypothesis.trim()) {
                simulateMutation.mutate(hypothesis.trim());
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-9 px-4"
            onClick={() => hypothesis.trim() && simulateMutation.mutate(hypothesis.trim())}
            disabled={!hypothesis.trim() || simulateMutation.isPending}
            aria-busy={simulateMutation.isPending}
          >
            {simulateMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" aria-hidden="true" /> Simulating…</>
            ) : (
              <><FlaskConical className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Simulate</>
            )}
          </Button>
        </div>

        {/* Scenarios */}
        {scenarioList.length > 0 ? (
          <ul aria-label="Simulated scenarios" className="space-y-3 list-none p-0 m-0">
            {scenarioList.map(s => (
              <ScenarioCard key={s.id} scenario={s} />
            ))}
          </ul>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">
            Ask "what if?" and your entire AI team will model the outcomes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
