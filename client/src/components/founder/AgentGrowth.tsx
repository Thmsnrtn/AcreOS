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
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className={achieved ? "text-emerald-600 font-medium" : ""}>{goal.description}</span>
        {achieved && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
      </div>
      <Progress value={achieved ? 100 : progress} className="h-1.5" />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Baseline: {goal.baselineValue}</span>
        <span>Current: {current}</span>
        <span>Target: {goal.targetValue}</span>
      </div>
    </div>
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
    <div className="border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{avatar}</span>
          <div>
            <div className="text-sm font-semibold">{role}</div>
            <div className="text-[10px] text-muted-foreground">
              {achievedCount}/{goals.length} goals achieved
            </div>
          </div>
        </div>
        <Badge variant="outline" className={
          plan.status === "completed" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
        }>
          {plan.status}
        </Badge>
      </div>

      {/* Goals */}
      {goals.length > 0 && (
        <div className="space-y-2">
          {goals.map((g, i) => <GoalProgress key={i} goal={g} />)}
        </div>
      )}

      {/* Skill Requests */}
      {skills.filter(s => s.status === "requested").length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium flex items-center gap-1 text-amber-600">
            <Sparkles className="h-3 w-3" /> Skill Requests
          </div>
          {skills.map((s, i) => (
            s.status === "requested" && (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100">
                <div className="flex-1 text-xs">
                  <div className="font-medium">{s.skill}</div>
                  <div className="text-muted-foreground">{s.reason}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-emerald-600"
                  onClick={() => approveSkillMutation.mutate({ planId: plan.id, skillIndex: i })}
                >
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Grant
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-red-600"
                  onClick={() => denySkillMutation.mutate({ planId: plan.id, skillIndex: i })}
                >
                  <XCircle className="h-2.5 w-2.5 mr-0.5" /> Deny
                </Button>
              </div>
            )
          ))}
        </div>
      )}

      {/* Latest Progress */}
      {progress.length > 0 && (
        <div className="text-xs text-muted-foreground italic border-t pt-2">
          Latest: {progress[progress.length - 1].notes}
        </div>
      )}
    </div>
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

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const planList = (plans || []) as ImprovementPlan[];
  const pendingSkills = planList.reduce((n, p) =>
    n + (p.skillRequests || []).filter(s => s.status === "requested").length, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sprout className="h-4 w-4" /> Agent Growth
            {pendingSkills > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 ml-1">
                {pendingSkills} skill request{pendingSkills > 1 ? "s" : ""}
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            Generate Plans
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {planList.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No improvement plans yet. Generate plans after running performance reviews.
          </div>
        ) : (
          planList.map(plan => <PlanCard key={plan.id} plan={plan} />)
        )}
      </CardContent>
    </Card>
  );
}
