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

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{pattern.patternName.replace(/_/g, " ")}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{pattern.sampleSize} observations</span>
          <Badge variant="outline" className={
            successRate >= 70 ? "bg-emerald-100 text-emerald-800" :
            successRate >= 40 ? "bg-amber-100 text-amber-800" :
            "bg-red-100 text-red-800"
          }>
            {successRate}%
          </Badge>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{pattern.description}</p>

      {pattern.effectiveResponse && (
        <div className="text-xs">
          <span className="text-emerald-600 font-medium">Works: </span>
          <span className="text-muted-foreground">{pattern.effectiveResponse}</span>
        </div>
      )}

      {pattern.ineffectiveResponse && (
        <div className="text-xs">
          <span className="text-red-600 font-medium">Doesn't work: </span>
          <span className="text-muted-foreground">{pattern.ineffectiveResponse}</span>
        </div>
      )}

      {Object.keys(conditions).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(conditions).map(([k, v]) => (
            <Badge key={k} variant="outline" className="text-[10px] h-4 px-1.5">
              {k}: {v}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        Agents: {agents.map(a => <span key={a} title={a}>{AGENT_AVATARS[a] || a}</span>)}
      </div>
    </div>
  );
}

function CorrelationCard({ correlation }: { correlation: Correlation }) {
  const strength = Math.round(Number(correlation.correlation || 0) * 100);

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg border text-xs">
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] h-4 px-1">{correlation.signalA.split(":")[0]}</Badge>
          <span className="text-muted-foreground">{correlation.signalA.split(":")[1]?.replace(/_/g, " ")}</span>
          <span className="text-muted-foreground">+</span>
          <Badge variant="outline" className="text-[10px] h-4 px-1">{correlation.signalB.split(":")[0]}</Badge>
          <span className="text-muted-foreground">{correlation.signalB.split(":")[1]?.replace(/_/g, " ")}</span>
        </div>
        <div className="mt-0.5 text-muted-foreground">
          Predicts: {correlation.predictedOutcome.replace(/_/g, " ")}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-medium">{strength}%</div>
        <div className="text-[10px] text-muted-foreground">{correlation.observationCount} obs</div>
      </div>
    </div>
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

  if (loadingPatterns || loadingCorrelations) return <Skeleton className="h-48 w-full rounded-xl" />;

  const patternList = (patterns || []) as Pattern[];
  const correlationList = (correlations || []) as Correlation[];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Library className="h-4 w-4" /> Institutional Memory
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
          >
            <Brain className={`h-3 w-3 mr-1 ${discoverMutation.isPending ? "animate-pulse" : ""}`} />
            Discover Patterns
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Patterns */}
        {patternList.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Learned Patterns ({patternList.length})
            </div>
            {patternList.slice(0, 6).map(p => <PatternCard key={p.id} pattern={p} />)}
          </div>
        )}

        {/* Correlations */}
        {correlationList.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Link2 className="h-3 w-3" /> Signal Correlations ({correlationList.length})
            </div>
            {correlationList.slice(0, 5).map(c => <CorrelationCard key={c.id} correlation={c} />)}
          </div>
        )}

        {patternList.length === 0 && correlationList.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No patterns yet. Click "Discover Patterns" or they'll emerge naturally as agents operate.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
