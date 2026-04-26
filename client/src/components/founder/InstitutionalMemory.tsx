/**
 * Institutional Memory — Sovereign Company Protocol v7
 *
 * The compound knowledge base. Patterns that get smarter
 * with every execution. Cross-agent signal correlations.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS } from "@/lib/trust-language";
import {
  Library,
  Link2,
  TrendingUp,
  Brain,
  RefreshCw,
} from "lucide-react";

interface Pattern {
  id: number;
  patternName: string;
  description: string;
  effectiveResponse: string;
  ineffectiveResponse: string | null;
  contextConditions: Record<string, string> | null;
  successRate: string;
  sampleSize: number;
  contributingAgents: string[];
}

interface Correlation {
  id: number;
  signalA: string;
  signalB: string;
  predictedOutcome: string;
  correlation: string;
  observationCount: number;
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  const successRate = Math.round(Number(pattern.successRate || 0) * 100);
  const agents = pattern.contributingAgents || [];
  const conditions = pattern.contextConditions || {};
  const patternLabel = pattern.patternName.replace(/_/g, " ");

  return (
    <li
      className="border rounded-lg p-3 space-y-2 list-none"
      aria-label={`Pattern ${patternLabel}: ${successRate}% success across ${pattern.sampleSize} observations`}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{patternLabel}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground tabular-nums">{pattern.sampleSize} observations</span>
          <Badge variant="outline" className={
            (successRate >= 70 ? "bg-emerald-100 text-emerald-800 " :
             successRate >= 40 ? "bg-amber-100 text-amber-800 " :
             "bg-red-100 text-red-800 ") + "tabular-nums"
          }>
            {successRate}%
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{pattern.description}</p>

      {pattern.effectiveResponse && (
        <p className="text-xs m-0">
          <span className="text-emerald-600 font-medium">Works: </span>
          <span className="text-muted-foreground">{pattern.effectiveResponse}</span>
        </p>
      )}

      {pattern.ineffectiveResponse && (
        <p className="text-xs m-0">
          <span className="text-red-600 font-medium">Doesn't work: </span>
          <span className="text-muted-foreground">{pattern.ineffectiveResponse}</span>
        </p>
      )}

      {Object.keys(conditions).length > 0 && (
        <ul aria-label="Context conditions" className="flex flex-wrap gap-1 list-none p-0 m-0">
          {Object.entries(conditions).map(([k, v]) => (
            <li key={k}>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                {k}: {v}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <span>Agents:</span>
        <ul aria-label="Contributing agents" className="flex items-center gap-1 list-none p-0 m-0">
          {agents.map(a => (
            <li key={a} aria-label={a}>
              <span aria-hidden="true">{AGENT_AVATARS[a] || a}</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

function CorrelationCard({ correlation }: { correlation: Correlation }) {
  const strength = Math.round(Number(correlation.correlation || 0) * 100);
  const sigATail = correlation.signalA.split(":")[1]?.replace(/_/g, " ") ?? "";
  const sigBTail = correlation.signalB.split(":")[1]?.replace(/_/g, " ") ?? "";
  const outcome = correlation.predictedOutcome.replace(/_/g, " ");

  return (
    <li
      className="flex items-center gap-2 p-2 rounded-lg border text-xs list-none"
      aria-label={`${correlation.signalA} ${sigATail} + ${correlation.signalB} ${sigBTail}: predicts ${outcome}, ${strength}% strength across ${correlation.observationCount} observations`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] h-4 px-1">{correlation.signalA.split(":")[0]}</Badge>
          <span className="text-muted-foreground">{sigATail}</span>
          <span className="text-muted-foreground">+</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1">{correlation.signalB.split(":")[0]}</Badge>
          <span className="text-muted-foreground">{sigBTail}</span>
        </div>
        <p className="mt-0.5 text-muted-foreground m-0">
          Predicts: {outcome}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-medium tabular-nums m-0">{strength}%</p>
        <p className="text-[10px] text-muted-foreground tabular-nums m-0">{correlation.observationCount} obs</p>
      </div>
    </li>
  );
}

export function InstitutionalMemory() {
  const queryClient = useQueryClient();

  const { data: patterns, isLoading: loadingPatterns } = useQuery({
    queryKey: ["/api/founder/v7/institutional/patterns"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/institutional/patterns").then(r => r.json()),
    refetchInterval: 60000,
  });

  const { data: correlations, isLoading: loadingCorrelations } = useQuery({
    queryKey: ["/api/founder/v7/institutional/correlations"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/institutional/correlations").then(r => r.json()),
    refetchInterval: 60000,
  });

  const discoverMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v7/institutional/discover"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/institutional"] });
    },
  });

  if (loadingPatterns || loadingCorrelations) return <Skeleton role="status" aria-busy="true" aria-label="Loading institutional memory" className="h-48 w-full rounded-xl" />;

  const patternList = (patterns || []) as Pattern[];
  const correlationList = (correlations || []) as Correlation[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Library className="h-4 w-4" aria-hidden="true" /> Institutional memory
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
            aria-busy={discoverMutation.isPending}
          >
            <Brain className={`h-3 w-3 mr-1 ${discoverMutation.isPending ? "animate-pulse" : ""}`} aria-hidden="true" />
            {discoverMutation.isPending ? "Discovering…" : "Discover patterns"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Patterns */}
        {patternList.length > 0 && (
          <section aria-labelledby="learned-patterns-heading" className="space-y-2">
            <p id="learned-patterns-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="h-3 w-3" aria-hidden="true" /> Learned patterns (<span className="tabular-nums">{patternList.length}</span>)
            </p>
            <ul aria-labelledby="learned-patterns-heading" className="space-y-2 list-none p-0 m-0">
              {patternList.slice(0, 6).map(p => <PatternCard key={p.id} pattern={p} />)}
            </ul>
          </section>
        )}

        {/* Correlations */}
        {correlationList.length > 0 && (
          <section aria-labelledby="signal-correlations-heading" className="space-y-2">
            <p id="signal-correlations-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Link2 className="h-3 w-3" aria-hidden="true" /> Signal correlations (<span className="tabular-nums">{correlationList.length}</span>)
            </p>
            <ul aria-labelledby="signal-correlations-heading" className="space-y-2 list-none p-0 m-0">
              {correlationList.slice(0, 5).map(c => <CorrelationCard key={c.id} correlation={c} />)}
            </ul>
          </section>
        )}

        {patternList.length === 0 && correlationList.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No patterns yet. Click "Discover patterns" or they'll emerge naturally as agents operate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
