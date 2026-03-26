/**
 * Workflow Monitor — Sovereign Company Protocol v6
 *
 * Watch multi-agent pipelines execute in real-time.
 * Each step shows which agent is working, what they're doing,
 * and whether it succeeded. Like watching a factory floor.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  AGENT_COLORS,
} from "@/lib/trust-language";
import {
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  SkipForward,
  ArrowRight,
  Workflow,
  Clock,
} from "lucide-react";

interface WorkflowStep {
  step: number;
  agentCodename: string;
  action: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  output?: any;
  error?: string;
  durationMs?: number;
}

interface WorkflowRun {
  id: number;
  workflowId: number;
  status: string;
  triggeredBy: string;
  currentStep: number;
  stepResults: WorkflowStep[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

interface Workflow {
  id: number;
  name: string;
  description: string;
  triggerType: string;
  steps: any[];
  isActive: boolean;
  totalRuns: number;
  successRate: string | null;
}

const STEP_STATUS_STYLES: Record<string, { icon: any; color: string; bg: string }> = {
  pending: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted/50" },
  running: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
  completed: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  failed: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", bg: "bg-muted/30" },
};

function StepPill({ step }: { step: WorkflowStep }) {
  const style = STEP_STATUS_STYLES[step.status] || STEP_STATUS_STYLES.pending;
  const Icon = style.icon;
  const avatar = AGENT_AVATARS[step.agentCodename] || "?";
  const role = AGENT_ROLES[step.agentCodename] || step.agentCodename;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${style.bg} transition-all`}>
      <span className="text-base">{avatar}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{role}</div>
        <div className="text-[10px] text-muted-foreground truncate">{step.action.replace(/_/g, " ")}</div>
      </div>
      <Icon className={`h-3.5 w-3.5 ${style.color} ${step.status === "running" ? "animate-spin" : ""}`} />
      {step.durationMs && (
        <span className="text-[10px] text-muted-foreground">{(step.durationMs / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

function RunCard({ run, workflowName }: { run: WorkflowRun; workflowName?: string }) {
  const steps = (run.stepResults || []) as WorkflowStep[];
  const statusColor = run.status === "completed" ? "bg-emerald-100 text-emerald-800"
    : run.status === "failed" ? "bg-red-100 text-red-800"
    : run.status === "running" ? "bg-blue-100 text-blue-800"
    : "bg-muted text-muted-foreground";

  return (
    <div className="border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{workflowName || `Run #${run.id}`}</div>
          <div className="text-xs text-muted-foreground">
            Triggered by {run.triggeredBy} &middot; {new Date(run.startedAt).toLocaleString()}
          </div>
        </div>
        <Badge variant="outline" className={statusColor}>{run.status}</Badge>
      </div>

      <div className="space-y-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1">
            <StepPill step={step} />
            {i < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mx-0.5" />
            )}
          </div>
        ))}
      </div>

      {run.durationMs && (
        <div className="text-xs text-muted-foreground text-right">
          Total: {(run.durationMs / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
}

export function WorkflowMonitor() {
  const queryClient = useQueryClient();

  const { data: workflows, isLoading: loadingWorkflows } = useQuery({
    queryKey: ["/api/founder/v6/workflows"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/workflows").then(r => r.json()),
    refetchInterval: 10000,
  });

  const { data: runs, isLoading: loadingRuns } = useQuery({
    queryKey: ["/api/founder/v6/workflow-runs"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/workflow-runs").then(r => r.json()),
    refetchInterval: 5000,
  });

  const triggerMutation = useMutation({
    mutationFn: (workflowId: number) =>
      apiRequest("POST", `/api/founder/v6/workflows/${workflowId}/trigger`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/workflow-runs"] }),
  });

  if (loadingWorkflows || loadingRuns) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  const workflowList = (workflows || []) as Workflow[];
  const runList = (runs || []) as WorkflowRun[];
  const activeRuns = runList.filter(r => r.status === "running");
  const recentRuns = runList.filter(r => r.status !== "running").slice(0, 5);

  const workflowNames = Object.fromEntries(workflowList.map(w => [w.id, w.name]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Agent Pipelines
          </CardTitle>
          {activeRuns.length > 0 && (
            <Badge variant="outline" className="bg-blue-100 text-blue-800">
              {activeRuns.length} running
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Runs */}
        {activeRuns.map(run => (
          <RunCard key={run.id} run={run} workflowName={workflowNames[run.workflowId]} />
        ))}

        {/* Available Workflows */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available Pipelines</div>
          {workflowList.map(w => (
            <div key={w.id} className="flex items-center justify-between py-2 px-3 rounded-lg border">
              <div>
                <div className="text-sm font-medium">{w.name}</div>
                <div className="text-xs text-muted-foreground">
                  {w.steps?.length || 0} steps &middot; {w.totalRuns} runs
                  {w.successRate ? ` &middot; ${w.successRate}% success` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => triggerMutation.mutate(w.id)}
                disabled={triggerMutation.isPending}
              >
                <Play className="h-3 w-3 mr-1" /> Run
              </Button>
            </div>
          ))}
        </div>

        {/* Recent Completed Runs */}
        {recentRuns.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Runs</div>
            {recentRuns.map(run => (
              <RunCard key={run.id} run={run} workflowName={workflowNames[run.workflowId]} />
            ))}
          </div>
        )}

        {workflowList.length === 0 && runList.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No workflows configured yet. Workflows will auto-trigger when events occur.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
