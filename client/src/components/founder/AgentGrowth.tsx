/**
 * Agent Growth — Sovereign Company Protocol v7
 *
 * Agent self-improvement plans + skill requests.
 * Agents set goals, track progress, request new capabilities.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENT_AVATARS, AGENT_ROLES } from "@/lib/trust-language";
import {
  Sprout,
  Target,
  Sparkles,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowUp,
} from "lucide-react";

interface ImprovementPlan {
  id: number;
  agentCodename: string;
  status: string;
  goals: Array<{
    description: string;
    metric: string;
    baselineValue: number;
    targetValue: number;
    currentValue?: number;
    status: string;
  }>;
  skillRequests: Array<{
    skill: string;
    reason: string;
    status: string;
  }>;
  weeklyProgress: Array<{
    week: string;
    notes: string;
  }>;
}

function GoalProgress({ goal }: { goal: ImprovementPlan["goals"][0] }) {
  const current = goal.currentValue ?? goal.baselineValue;
  const range = Math.abs(goal.targetValue - goal.baselineValue);
  const progress = range > 0 ? Math.min(100, Math.abs(current - goal.baselineValue) / range * 100) : 0;
  const achieved = goal.status === "achieved";

  return (
    <li
      className="space-y-1"
      aria-label={`${goal.description}: ${achieved ? "achieved" : `${Math.round(progress)}% — current ${current}, target ${goal.targetValue}`}`}
    >
      <div className="flex items-center justify-between text-xs">
        <span className={achieved ? "text-acr-pos font-medium" : ""}>{goal.description}</span>
        {achieved && <CheckCircle2 className="h-3 w-3 text-acr-pos" aria-hidden="true" />}
      </div>
      <Progress value={achieved ? 100 : progress} className="h-1.5" />
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>Baseline: {goal.baselineValue}</span>
        <span>Current: {current}</span>
        <span>Target: {goal.targetValue}</span>
      </div>
    </li>
  );
}

function PlanCard({ plan }: { plan: ImprovementPlan }) {
  const queryClient = useQueryClient();
  const avatar = AGENT_AVATARS[plan.agentCodename] || "?";
  const role = AGENT_ROLES[plan.agentCodename] || plan.agentCodename;
  const goals = plan.goals || [];
  const skills = plan.skillRequests || [];
  const progress = plan.weeklyProgress || [];
  const achievedCount = goals.filter(g => g.status === "achieved").length;

  const approveSkillMutation = useMutation({
    mutationFn: ({ planId, skillIndex }: { planId: number; skillIndex: number }) =>
      apiRequest("POST", `/api/founder/v7/improvement/${planId}/skill/${skillIndex}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/improvement"] }),
  });

  const denySkillMutation = useMutation({
    mutationFn: ({ planId, skillIndex }: { planId: number; skillIndex: number }) =>
      apiRequest("POST", `/api/founder/v7/improvement/${planId}/skill/${skillIndex}/deny`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/improvement"] }),
  });

  return (
    <li className="border rounded-xl p-4 space-y-3 list-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-lg">{avatar}</span>
          <div>
            <p className="text-sm font-semibold m-0">{role}</p>
            <p className="text-[10px] text-muted-foreground m-0">
              <span className="tabular-nums">{achievedCount}/{goals.length}</span> goals achieved
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={`capitalize ${plan.status === "completed" ? "bg-acr-pos-soft text-acr-pos" : "bg-acr-accent text-acr-accent"}`}
          aria-label={`Status: ${plan.status}`}
        >
          {plan.status}
        </Badge>
      </div>

      {/* Goals */}
      {goals.length > 0 && (
        <ul aria-label="Goals" className="space-y-2 list-none p-0 m-0">
          {goals.map((g, i) => <GoalProgress key={i} goal={g} />)}
        </ul>
      )}

      {/* Skill Requests */}
      {skills.filter(s => s.status === "requested").length > 0 && (
        <div className="space-y-1.5">
          <p id={`skill-requests-${plan.id}`} className="text-xs font-medium flex items-center gap-1 text-acr-warn">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> Skill requests
          </p>
          <ul aria-labelledby={`skill-requests-${plan.id}`} className="space-y-1.5 list-none p-0 m-0">
            {skills.map((s, i) => (
              s.status === "requested" && (
                <li key={i} className="flex items-center gap-2 p-2 rounded-card bg-acr-warn-soft dark:bg-acr-warn-soft/20 border border-acr-warn-soft">
                  <div className="flex-1 text-xs">
                    <p className="font-medium m-0">{s.skill}</p>
                    <p className="text-muted-foreground m-0">{s.reason}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-acr-pos"
                    onClick={() => approveSkillMutation.mutate({ planId: plan.id, skillIndex: i })}
                    disabled={approveSkillMutation.isPending}
                    aria-busy={approveSkillMutation.isPending}
                    aria-label={`Grant ${s.skill} to ${role}`}
                  >
                    <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" aria-hidden="true" /> Grant
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-acr-neg"
                    onClick={() => denySkillMutation.mutate({ planId: plan.id, skillIndex: i })}
                    disabled={denySkillMutation.isPending}
                    aria-busy={denySkillMutation.isPending}
                    aria-label={`Deny ${s.skill} for ${role}`}
                  >
                    <XCircle className="h-2.5 w-2.5 mr-0.5" aria-hidden="true" /> Deny
                  </Button>
                </li>
              )
            ))}
          </ul>
        </div>
      )}

      {/* Latest Progress */}
      {progress.length > 0 && (
        <p className="text-xs text-muted-foreground italic border-t pt-2 m-0">
          Latest: {progress[progress.length - 1].notes}
        </p>
      )}
    </li>
  );
}

export function AgentGrowth() {
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery({
    queryKey: ["/api/founder/v7/improvement"],
    queryFn: () => apiRequest("GET", "/api/founder/v7/improvement").then(r => r.json()),
    refetchInterval: 30000,
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v7/improvement/generate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v7/improvement"] }),
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading agent growth" className="h-48 w-full rounded-xl" />;

  const planList = (plans || []) as ImprovementPlan[];
  const pendingSkills = planList.reduce((n, p) =>
    n + (p.skillRequests || []).filter(s => s.status === "requested").length, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sprout className="h-4 w-4" aria-hidden="true" /> Agent growth
            {pendingSkills > 0 && (
              <Badge variant="outline" className="bg-acr-warn-soft text-acr-warn ml-1 tabular-nums" aria-label={`${pendingSkills} pending skill request${pendingSkills > 1 ? "s" : ""}`}>
                {pendingSkills} skill request{pendingSkills > 1 ? "s" : ""}
              </Badge>
            )}
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            aria-busy={generateMutation.isPending}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${generateMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {generateMutation.isPending ? "Generating…" : "Generate plans"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {planList.length === 0 ? (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No improvement plans yet. Generate plans after running performance reviews.
          </p>
        ) : (
          <ul aria-label="Improvement plans" className="space-y-4 list-none p-0 m-0">
            {planList.map(plan => <PlanCard key={plan.id} plan={plan} />)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
