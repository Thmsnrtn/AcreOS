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
    <li
      className={`flex items-center gap-3 p-3 rounded-card border list-none ${
        pattern.isAutopilotActive ? "bg-acr-pos-soft dark:bg-acr-pos-soft/20 border-acr-pos-soft" :
        pattern.isAutopilotEligible ? "bg-acr-accent dark:bg-acr-accent/20 border-acr-accent" :
        "bg-background"
      }`}
      aria-label={`${role} — ${pattern.description}: ${pattern.totalDecisions} decisions, ${approveRate}% approved, ${confidence}% confidence${pattern.isAutopilotActive ? ", on autopilot" : pattern.isAutopilotEligible ? ", ready for autopilot" : ", still learning"}`}
    >
      <span aria-hidden="true" className="text-base">{avatar}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate m-0">{pattern.description}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground tabular-nums">{pattern.totalDecisions} decisions</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{approveRate}% approved</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{confidence}% confidence</span>
        </div>
      </div>

      {pattern.isAutopilotEligible && (
        <div className="flex items-center gap-2">
          {!pattern.isAutopilotActive && (
            <Badge variant="outline" className="text-[10px] bg-acr-accent text-acr-accent">
              Ready
            </Badge>
          )}
          <Switch
            checked={pattern.isAutopilotActive}
            onCheckedChange={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            aria-label={`Autopilot for ${role}: ${pattern.description}`}
          />
        </div>
      )}

      {!pattern.isAutopilotEligible && (
        <div className="w-16">
          <Progress value={Math.min(100, (pattern.totalDecisions / 15) * 100)} className="h-1.5" aria-label={`Learning progress: ${pattern.totalDecisions} of 15 decisions`} />
          <div className="text-[10px] text-muted-foreground text-center mt-0.5 tabular-nums">
            {pattern.totalDecisions}/15
          </div>
        </div>
      )}
    </li>
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

  if (loadingPatterns) return <Skeleton role="status" aria-busy="true" aria-label="Loading decision autopilot" className="h-48 w-full rounded-xl" />;

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
            <Zap className="h-4 w-4" aria-hidden="true" /> Decision autopilot
          </CardTitle>
          {autopilotStats && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label={`Shadow accuracy: ${autopilotStats.overallAccuracy}%`}>
              <Shield className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">{autopilotStats.overallAccuracy}%</span> shadow accuracy
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats bar */}
        {autopilotStats && (autopilotStats.activeAutopilots > 0 || autopilotStats.eligibleNotActive > 0) && (
          <ul aria-label="Autopilot statistics" className="flex items-center gap-4 text-xs list-none p-0 m-0">
            {autopilotStats.activeAutopilots > 0 && (
              <li className="flex items-center gap-1.5" aria-label={`${autopilotStats.activeAutopilots} on autopilot`}>
                <CheckCircle2 className="h-3 w-3 text-acr-pos" aria-hidden="true" />
                <span><span className="tabular-nums">{autopilotStats.activeAutopilots}</span> on autopilot</span>
              </li>
            )}
            {autopilotStats.eligibleNotActive > 0 && (
              <li className="flex items-center gap-1.5" aria-label={`${autopilotStats.eligibleNotActive} ready to enable`}>
                <Brain className="h-3 w-3 text-acr-accent" aria-hidden="true" />
                <span><span className="tabular-nums">{autopilotStats.eligibleNotActive}</span> ready to enable</span>
              </li>
            )}
            <li className="flex items-center gap-1.5" aria-label={`${autopilotStats.totalPatterns} patterns tracked`}>
              <TrendingUp className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              <span><span className="tabular-nums">{autopilotStats.totalPatterns}</span> patterns tracked</span>
            </li>
          </ul>
        )}

        {/* Eligible for autopilot */}
        {eligible.length > 0 && (
          <section aria-labelledby="ready-heading" className="space-y-2">
            <p id="ready-heading" className="text-xs font-medium text-acr-accent uppercase tracking-wider">Ready for autopilot</p>
            <ul aria-labelledby="ready-heading" className="space-y-2 list-none p-0 m-0">
              {eligible.map(p => <PatternRow key={p.id} pattern={p} />)}
            </ul>
          </section>
        )}

        {/* Active autopilots */}
        {active.length > 0 && (
          <section aria-labelledby="active-heading" className="space-y-2">
            <p id="active-heading" className="text-xs font-medium text-acr-pos uppercase tracking-wider">On autopilot</p>
            <ul aria-labelledby="active-heading" className="space-y-2 list-none p-0 m-0">
              {active.map(p => <PatternRow key={p.id} pattern={p} />)}
            </ul>
          </section>
        )}

        {/* Still learning */}
        {learning.length > 0 && (
          <section aria-labelledby="learning-heading" className="space-y-2">
            <p id="learning-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Learning your patterns</p>
            <ul aria-labelledby="learning-heading" className="space-y-2 list-none p-0 m-0">
              {learning.slice(0, 5).map(p => <PatternRow key={p.id} pattern={p} />)}
            </ul>
            {learning.length > 5 && (
              <p className="text-[10px] text-muted-foreground text-center">
                +<span className="tabular-nums">{learning.length - 5}</span> more patterns being learned
              </p>
            )}
          </section>
        )}

        {patternList.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">
            Autopilot learns from your decisions. As you approve, reject, and override,
            it builds patterns to eventually handle routine decisions for you.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
