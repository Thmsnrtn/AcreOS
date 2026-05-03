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
  running: { icon: Loader2, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/30" },
  completed: { icon: CheckCircle2, color: "text-acr-pos", bg: "bg-acr-pos-soft dark:bg-acr-pos-soft/30" },
  failed: { icon: AlertCircle, color: "text-acr-neg", bg: "bg-acr-neg-soft dark:bg-acr-neg-soft/30" },
  skipped: { icon: SkipForward, color: "text-muted-foreground", bg: "bg-muted/30" },
};

function StepPill({ step }: { step: WorkflowStep }) {
  const style = STEP_STATUS_STYLES[step.status] || STEP_STATUS_STYLES.pending;
  const Icon = style.icon;
  const avatar = AGENT_AVATARS[step.agentCodename] || "?";
  const role = AGENT_ROLES[step.agentCodename] || step.agentCodename;
  const action = step.action.replace(/_/g, " ");
  const durationText = step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s` : "";

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${style.bg} transition-all`}
      aria-label={`${role}: ${action}, status ${step.status}${durationText ? `, ${durationText}` : ""}`}
    >
      <span aria-hidden="true" className="text-base">{avatar}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate m-0">{role}</p>
        <p className="text-[10px] text-muted-foreground truncate m-0">{action}</p>
      </div>
      <Icon className={`h-3.5 w-3.5 ${style.color} ${step.status === "running" ? "animate-spin" : ""}`} aria-hidden="true" />
      {step.durationMs && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{durationText}</span>
      )}
    </div>
  );
}

function RunCard({ run, workflowName }: { run: WorkflowRun; workflowName?: string }) {
  const steps = (run.stepResults || []) as WorkflowStep[];
  const statusColor = run.status === "completed" ? "bg-acr-pos-soft text-acr-pos"
    : run.status === "failed" ? "bg-acr-neg-soft text-acr-neg"
    : run.status === "running" ? "bg-acr-accent text-acr-accent"
    : "bg-muted text-muted-foreground";

  return (
    <li className="border rounded-xl p-4 space-y-3 list-none">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold m-0">{workflowName || `Run #${run.id}`}</p>
          <p className="text-xs text-muted-foreground m-0">
            Triggered by {run.triggeredBy} &middot; <time dateTime={run.startedAt} className="tabular-nums">{new Date(run.startedAt).toLocaleString()}</time>
          </p>
        </div>
        <Badge variant="outline" className={`capitalize ${statusColor}`} aria-label={`Status: ${run.status}`}>{run.status}</Badge>
      </div>

      <ol aria-label="Pipeline steps" className="space-y-1.5 list-none p-0 m-0">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-1">
            <StepPill step={step} />
            {i < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mx-0.5" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>

      {run.durationMs && (
        <p className="text-xs text-muted-foreground text-right m-0">
          Total: <span className="tabular-nums">{(run.durationMs / 1000).toFixed(1)}s</span>
        </p>
      )}
    </li>
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
    return <Skeleton role="status" aria-busy="true" aria-label="Loading workflow monitor" className="h-48 w-full rounded-xl" />;
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
            <Workflow className="h-4 w-4" aria-hidden="true" />
            Agent pipelines
          </CardTitle>
          {activeRuns.length > 0 && (
            <Badge variant="outline" className="bg-acr-accent text-acr-accent tabular-nums" aria-label={`${activeRuns.length} running`}>
              {activeRuns.length} running
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Runs */}
        {activeRuns.length > 0 && (
          <ul aria-label="Active runs" className="space-y-4 list-none p-0 m-0">
            {activeRuns.map(run => (
              <RunCard key={run.id} run={run} workflowName={workflowNames[run.workflowId]} />
            ))}
          </ul>
        )}

        {/* Available Workflows */}
        <section aria-labelledby="available-pipelines-heading" className="space-y-2">
          <p id="available-pipelines-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available pipelines</p>
          <ul aria-labelledby="available-pipelines-heading" className="space-y-2 list-none p-0 m-0">
            {workflowList.map(w => (
              <li key={w.id} className="flex items-center justify-between py-2 px-3 rounded-lg border">
                <div>
                  <p className="text-sm font-medium m-0">{w.name}</p>
                  <p className="text-xs text-muted-foreground m-0">
                    <span className="tabular-nums">{w.steps?.length || 0}</span> steps &middot; <span className="tabular-nums">{w.totalRuns}</span> runs
                    {w.successRate ? <> &middot; <span className="tabular-nums">{w.successRate}%</span> success</> : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => triggerMutation.mutate(w.id)}
                  disabled={triggerMutation.isPending}
                  aria-busy={triggerMutation.isPending}
                  aria-label={`Run ${w.name}`}
                >
                  <Play className="h-3 w-3 mr-1" aria-hidden="true" /> Run
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {/* Recent Completed Runs */}
        {recentRuns.length > 0 && (
          <section aria-labelledby="recent-runs-heading" className="space-y-2">
            <p id="recent-runs-heading" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent runs</p>
            <ul aria-labelledby="recent-runs-heading" className="space-y-4 list-none p-0 m-0">
              {recentRuns.map(run => (
                <RunCard key={run.id} run={run} workflowName={workflowNames[run.workflowId]} />
              ))}
            </ul>
          </section>
        )}

        {workflowList.length === 0 && runList.length === 0 && (
          <p className="text-center py-6 text-sm text-muted-foreground">
            No workflows configured yet. Workflows will auto-trigger when events occur.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
