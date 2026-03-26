/**
 * Decision Autopilot — Sovereign Company Protocol v7
 *
 * Shows the CEO which decisions the system can handle autonomously.
 * "You approved 14 of 15 Forge pricing suggestions. Enable autopilot?"
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS, AGENT_ROLES } from "@/lib/trust-language";
import {
  Zap,
  Brain,
  CheckCircle2,
  TrendingUp,
  Shield,
} from "lucide-react";

interface Pattern {
  id: number;
  patternKey: string;
  agentCodename: string;
  decisionCategory: string;
  description: string;
  totalDecisions: number;
  approvedCount: number;
  rejectedCount: number;
  autoApproveRate: string | null;
  predictedAction: string | null;
  predictionConfidence: string | null;
  isAutopilotEligible: boolean;
  isAutopilotActive: boolean;
}

interface AutopilotStats {
  totalPatterns: number;
  activeAutopilots: number;
  eligibleNotActive: number;
  overallAccuracy: number;
}

function PatternRow({ pattern }: { pattern: Pattern }) {
  const queryClient = useQueryClient();
  const avatar = AGENT_AVATARS[pattern.agentCodename] || "?";
  const role = AGENT_ROLES[pattern.agentCodename] || pattern.agentCodename;
  const confidence = Math.round(Number(pattern.predictionConfidence || 0) * 100);
  const approveRate = Math.round(Number(pattern.autoApproveRate || 0) * 100);

  const toggleMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/founder/v7/autopilot/${pattern.id}/toggle`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/autopilot"] }),
  });

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      pattern.isAutopilotActive ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200" :
      pattern.isAutopilotEligible ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200" :
      "bg-background"
    }`}>
      <span className="text-base">{avatar}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{pattern.description}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground">{pattern.totalDecisions} decisions</span>
          <span className="text-[10px] text-muted-foreground">{approveRate}% approved</span>
          <span className="text-[10px] text-muted-foreground">{confidence}% confidence</span>
        </div>
      </div>

      {pattern.isAutopilotEligible && (
        <div className="flex items-center gap-2">
          {!pattern.isAutopilotActive && (
            <Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-700">
              Ready
            </Badge>
          )}
          <Switch
            checked={pattern.isAutopilotActive}
            onCheckedChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
          />
        </div>
      )}

      {!pattern.isAutopilotEligible && (
        <div className="w-16">
          <Progress value={Math.min(100, (pattern.totalDecisions / 15) * 100)} className="h-1.5" />
          <div className="text-[10px] text-muted-foreground text-center mt-0.5">
            {pattern.totalDecisions}/15
          </div>
        </div>
      )}
    </div>
  );
}

export function DecisionAutopilot() {
  const { data: patterns, isLoading: loadingPatterns } = useQuery({
    queryKey: ["/api/founder/v7/autopilot/patterns"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/autopilot/patterns").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v7/autopilot/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/autopilot/stats").then(r => r.json()),
    refetchInterval: 60000,
  });

  if (loadingPatterns) return <Skeleton className="h-48 w-full rounded-xl" />;

  const patternList = (patterns || []) as Pattern[];
  const autopilotStats = stats as AutopilotStats | undefined;
  const eligible = patternList.filter(p => p.isAutopilotEligible && !p.isAutopilotActive);
  const active = patternList.filter(p => p.isAutopilotActive);
  const learning = patternList.filter(p => !p.isAutopilotEligible);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4" /> Decision Autopilot
          </CardTitle>
          {autopilotStats && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="h-3 w-3" />
              {autopilotStats.overallAccuracy}% shadow accuracy
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats bar */}
        {autopilotStats && (autopilotStats.activeAutopilots > 0 || autopilotStats.eligibleNotActive > 0) && (
          <div className="flex items-center gap-4 text-xs">
            {autopilotStats.activeAutopilots > 0 && (
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                <span>{autopilotStats.activeAutopilots} on autopilot</span>
              </div>
            )}
            {autopilotStats.eligibleNotActive > 0 && (
              <div className="flex items-center gap-1.5">
                <Brain className="h-3 w-3 text-blue-500" />
                <span>{autopilotStats.eligibleNotActive} ready to enable</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3 text-muted-foreground" />
              <span>{autopilotStats.totalPatterns} patterns tracked</span>
            </div>
          </div>
        )}

        {/* Eligible for autopilot */}
        {eligible.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-blue-600 uppercase tracking-wider">Ready for Autopilot</div>
            {eligible.map(p => <PatternRow key={p.id} pattern={p} />)}
          </div>
        )}

        {/* Active autopilots */}
        {active.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-emerald-600 uppercase tracking-wider">On Autopilot</div>
            {active.map(p => <PatternRow key={p.id} pattern={p} />)}
          </div>
        )}

        {/* Still learning */}
        {learning.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Learning Your Patterns</div>
            {learning.slice(0, 5).map(p => <PatternRow key={p.id} pattern={p} />)}
            {learning.length > 5 && (
              <div className="text-[10px] text-muted-foreground text-center">
                +{learning.length - 5} more patterns being learned
              </div>
            )}
          </div>
        )}

        {patternList.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Autopilot learns from your decisions. As you approve, reject, and override,
            it builds patterns to eventually handle routine decisions for you.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
