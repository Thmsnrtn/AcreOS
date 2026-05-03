import { useId, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Bot,
  Brain,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PlayCircle,
  Settings,
  Activity,
  ListChecks,
  Shield,
  ChevronRight,
  RefreshCw,
  BarChart3,
  Eye,
  ThumbsUp,
  ThumbsDown,
  FlaskConical,
  Search,
  MessageSquare,
  DollarSign,
  Briefcase,
} from "lucide-react";
import { relative } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

type AutonomyLevel = "full_auto" | "supervised" | "manual";
type ActionCategory =
  | "research"
  | "draft"
  | "data_write"
  | "scheduling"
  | "external_api"
  | "communication"
  | "financial"
  | "offer"
  | "contract";

interface AgentStatus {
  agentType: string;
  name: string;
  isEnabled: boolean;
  isActive: boolean;
  autonomyLevel: AutonomyLevel;
  lastActiveAt: string | null;
  pendingTaskCount: number;
  pendingApprovalCount: number;
  metrics: {
    totalActions: number;
    successfulActions: number;
    pendingApproval: number;
    lastDayActions: number;
  };
  config: {
    autoApproveCategories: ActionCategory[];
    escalateToHuman: ActionCategory[];
    maxActionsPerDay: number;
    notifyOnAction: boolean;
    customInstructions: string;
  };
}

interface AgentTask {
  id: number;
  agentType: string;
  status: string;
  priority: number;
  input: Record<string, any>;
  output: Record<string, any> | null;
  error: string | null;
  requiresReview: boolean;
  reviewedBy: number | null;
  reviewNotes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  executionTimeMs: number | null;
  relatedLeadId: number | null;
  relatedPropertyId: number | null;
  relatedDealId: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, React.ElementType> = {
  research: Search,
  deals: Briefcase,
  communications: MessageSquare,
  operations: Settings,
};

const AUTONOMY_LABELS: Record<AutonomyLevel, { label: string; description: string; color: string }> = {
  full_auto: {
    label: "Full auto",
    description: "Agent acts on all tasks without waiting for approval.",
    color: "text-acr-pos",
  },
  supervised: {
    label: "Supervised",
    description: "Agent auto-executes low-risk tasks; escalates high-risk ones.",
    color: "text-acr-warn",
  },
  manual: {
    label: "Manual",
    description: "Agent only acts when you explicitly approve each task.",
    color: "text-acr-neg",
  },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-acr-warn-soft text-acr-warn",
  processing: "bg-acr-accent text-acr-accent",
  completed: "bg-acr-pos-soft text-acr-pos",
  failed: "bg-acr-neg-soft text-acr-neg",
  cancelled: "bg-muted text-foreground",
};

const ALL_CATEGORIES: ActionCategory[] = [
  "research",
  "draft",
  "data_write",
  "scheduling",
  "external_api",
  "communication",
  "financial",
  "offer",
  "contract",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentCard({
  agent,
  onConfigure,
}: {
  agent: AgentStatus;
  onConfigure: (agent: AgentStatus) => void;
}) {
  const Icon = AGENT_ICONS[agent.agentType] || Bot;
  const autonomyInfo = AUTONOMY_LABELS[agent.autonomyLevel];
  const successRate =
    agent.metrics.totalActions > 0
      ? Math.round((agent.metrics.successfulActions / agent.metrics.totalActions) * 100)
      : 100;

  return (
    <Card className="flex flex-col gap-0 p-0 overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <CardDescription className="text-xs capitalize">{agent.agentType} agent</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.isActive && (
            <span className="flex items-center gap-1 text-xs text-acr-pos" role="status" aria-live="polite">
              <Activity className="h-3 w-3 animate-pulse" aria-hidden="true" />
              Active
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onConfigure(agent)}
            aria-label={`Configure ${agent.name}`}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Autonomy level */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Autonomy</span>
          <span className={`text-xs font-semibold ${autonomyInfo.color}`} aria-label={`Autonomy level: ${autonomyInfo.label}`}>
            {autonomyInfo.label}
          </span>
        </div>

        {/* Stats row */}
        <dl className="grid grid-cols-3 gap-2 text-center m-0">
          <div className="rounded-md bg-muted/50 p-2">
            <dd className="text-lg font-bold tabular-nums m-0">{agent.metrics.lastDayActions}</dd>
            <dt className="text-[10px] text-muted-foreground">Today</dt>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <dd className="text-lg font-bold tabular-nums m-0">{agent.pendingApprovalCount}</dd>
            <dt className="text-[10px] text-muted-foreground">Pending</dt>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <dd className="text-lg font-bold tabular-nums m-0">{successRate}%</dd>
            <dt className="text-[10px] text-muted-foreground">Success</dt>
          </div>
        </dl>

        {/* Success rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Success rate</span>
            <span className="tabular-nums">{agent.metrics.successfulActions}/{agent.metrics.totalActions} actions</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${agent.name} success rate`}
            aria-valuenow={successRate}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <Progress value={successRate} className="h-1.5" aria-hidden="true" />
          </div>
        </div>

        {/* Last active */}
        {agent.lastActiveAt && (
          <p className="text-[10px] text-muted-foreground">
            Last active <time dateTime={new Date(agent.lastActiveAt).toISOString()}>{relative(agent.lastActiveAt)}</time>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  onApprove,
  onReject,
  onRun,
}: {
  task: AgentTask;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onRun?: (id: number) => void;
}) {
  const Icon = AGENT_ICONS[task.agentType] || Bot;
  const input = task.input as Record<string, any>;
  const action = input?.action || "unknown";

  const actionLabel = action.replace(/_/g, " ");
  const taskLabel = `${task.agentType} ${actionLabel} task`;

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors" role="group" aria-label={taskLabel}>
      <div className="rounded-md bg-primary/10 p-1.5 mt-0.5">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium capitalize">{task.agentType}</span>
          <code className="text-xs bg-muted rounded px-1 py-0.5">{actionLabel}</code>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[task.status] || ""}`}
            aria-label={`Status: ${task.status}`}
          >
            {task.status}
          </Badge>
          {task.requiresReview && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-acr-warn-soft text-acr-warn border-acr-warn-soft" aria-label="Needs your approval">
              needs approval
            </Badge>
          )}
        </div>
        {input?.parameters && Object.keys(input.parameters).length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {Object.entries(input.parameters)
              .slice(0, 3)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          <time dateTime={new Date(task.createdAt).toISOString()}>{relative(task.createdAt)}</time>
          {task.executionTimeMs ? <span className="tabular-nums"> · {task.executionTimeMs}ms</span> : null}
        </p>
        {task.error && (
          <p className="text-xs text-acr-neg mt-1" role="alert">{task.error}</p>
        )}
        {task.output && task.status === "completed" && (task.output as any).data?.analysis && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {(task.output as any).data.analysis}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {task.requiresReview && task.status === "pending" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-acr-pos hover:text-acr-pos hover:bg-acr-pos-soft"
              onClick={() => onApprove?.(task.id)}
              aria-label={`Approve ${taskLabel}`}
            >
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-acr-neg hover:text-acr-neg hover:bg-acr-neg-soft"
              onClick={() => onReject?.(task.id)}
              aria-label={`Reject ${taskLabel}`}
            >
              <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
        {["pending", "failed"].includes(task.status) && !task.requiresReview && onRun && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onRun(task.id)}
            aria-label={`Run ${taskLabel} now`}
          >
            <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AgentConfigPanel({
  agent,
  onClose,
}: {
  agent: AgentStatus;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const autonomyId = useId();
  const maxActionsId = useId();
  const notifyId = useId();
  const customInstructionsId = useId();

  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>(agent.autonomyLevel);
  const [autoApprove, setAutoApprove] = useState<ActionCategory[]>(agent.config.autoApproveCategories);
  const [escalate, setEscalate] = useState<ActionCategory[]>(agent.config.escalateToHuman);
  const [notifyOnAction, setNotifyOnAction] = useState(agent.config.notifyOnAction);
  const [maxActions, setMaxActions] = useState(String(agent.config.maxActionsPerDay));
  const [customInstructions, setCustomInstructions] = useState(agent.config.customInstructions);

  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("PUT", `/api/autonomous/agents/${agent.agentType}/config`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/agents"] });
      toast({ title: "Configuration saved", description: `${agent.name} now uses your new autonomy settings.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save configuration", description: `${err.message} — ${agent.name}'s settings are unchanged.`, variant: "destructive" });
    },
  });

  const toggleCategory = (
    cat: ActionCategory,
    list: ActionCategory[],
    setList: (v: ActionCategory[]) => void
  ) => {
    setList(list.includes(cat) ? list.filter(c => c !== cat) : [...list, cat]);
  };

  const handleSubmit = () => {
    updateMutation.mutate({
      autonomyLevel,
      autoApproveCategories: autoApprove,
      escalateToHuman: escalate,
      maxActionsPerDay: parseInt(maxActions) || 50,
      notifyOnAction,
      customInstructions,
    });
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" aria-hidden="true" />
            Configure {agent.name}
          </DialogTitle>
          <DialogDescription>
            Control how autonomously this agent operates.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => { e.preventDefault(); if (!updateMutation.isPending) handleSubmit(); }}
        >
          {/* Autonomy level */}
          <div className="space-y-2">
            <Label htmlFor={autonomyId}>Autonomy level</Label>
            <Select
              value={autonomyLevel}
              onValueChange={v => setAutonomyLevel(v as AutonomyLevel)}
            >
              <SelectTrigger id={autonomyId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(AUTONOMY_LABELS) as [AutonomyLevel, any][]).map(([value, info]) => (
                  <SelectItem key={value} value={value}>
                    <span className={`font-medium ${info.color}`}>{info.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">— {info.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {AUTONOMY_LABELS[autonomyLevel].description}
            </p>
          </div>

          {/* Auto-approve categories */}
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-sm font-medium">Always auto-approve</legend>
            <p className="text-xs text-muted-foreground">
              These action types will always execute without approval, even in supervised mode.
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Always auto-approve action categories">
              {ALL_CATEGORIES.map(cat => {
                const pressed = autoApprove.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat, autoApprove, setAutoApprove)}
                    aria-pressed={pressed}
                    aria-label={`${pressed ? "Remove" : "Add"} auto-approve for ${cat.replace(/_/g, " ")}`}
                    className={`rounded-full px-3 py-1 text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      pressed
                        ? "bg-acr-pos-soft border-acr-pos text-acr-pos"
                        : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Always escalate categories */}
          <fieldset className="space-y-2 border-0 p-0 m-0">
            <legend className="text-sm font-medium">Always require approval</legend>
            <p className="text-xs text-muted-foreground">
              These action types always require your sign-off, even in full-auto mode.
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Always escalate action categories">
              {ALL_CATEGORIES.map(cat => {
                const pressed = escalate.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat, escalate, setEscalate)}
                    aria-pressed={pressed}
                    aria-label={`${pressed ? "Remove" : "Add"} approval requirement for ${cat.replace(/_/g, " ")}`}
                    className={`rounded-full px-3 py-1 text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive ${
                      pressed
                        ? "bg-acr-neg-soft border-acr-neg text-acr-neg"
                        : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Max actions per day */}
          <div className="space-y-2">
            <Label htmlFor={maxActionsId}>Max actions per day</Label>
            <input
              id={maxActionsId}
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={maxActions}
              onChange={e => setMaxActions(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
            />
          </div>

          {/* Notify on action */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor={notifyId}>Notify on each action</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send a notification every time this agent takes an action.
              </p>
            </div>
            <Switch id={notifyId} checked={notifyOnAction} onCheckedChange={setNotifyOnAction} />
          </div>

          {/* Custom instructions */}
          <div className="space-y-2">
            <Label htmlFor={customInstructionsId}>Custom instructions</Label>
            <Textarea
              id={customInstructionsId}
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              placeholder="e.g. Only send emails on weekdays. Never contact leads marked as DNC."
              className="h-24 text-sm"
              autoCapitalize="sentences"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save configuration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentCommandCenter() {
  useDocumentTitle("Agent command center");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [configuringAgent, setConfiguringAgent] = useState<AgentStatus | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [taskFilter, setTaskFilter] = useState<string>("all");
  const [pendingApproveAll, setPendingApproveAll] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: agents = [], isLoading: agentsLoading } = useQuery<AgentStatus[]>({
    queryKey: ["/api/autonomous/agents"],
    refetchInterval: 15_000,
  });

  const { data: pendingTasks = [], isLoading: tasksLoading } = useQuery<AgentTask[]>({
    queryKey: ["/api/autonomous/tasks/pending-approval"],
    refetchInterval: 10_000,
  });

  const { data: allTasks = [] } = useQuery<AgentTask[]>({
    queryKey: ["/api/autonomous/tasks", taskFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (taskFilter !== "all") params.set("status", taskFilter);
      return fetch(`/api/autonomous/tasks?${params}`, { credentials: "include" }).then(r => r.json());
    },
    refetchInterval: 15_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("POST", `/api/autonomous/tasks/${taskId}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/tasks"] });
      toast({ title: "Task approved and queued for execution" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't approve task", description: `${err.message} — the task is still pending.`, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("POST", `/api/autonomous/tasks/${taskId}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/tasks"] });
      toast({ title: "Task rejected" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't reject task", description: `${err.message} — the task is still pending.`, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("POST", `/api/autonomous/tasks/${taskId}/run`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/tasks"] });
      toast({ title: "Task executed" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't execute task", description: `${err.message} — the task is unchanged.`, variant: "destructive" });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/autonomous/trigger-processor", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/tasks"] });
      toast({ title: "Processor triggered", description: "Pending tasks will execute on the next cycle." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't trigger processor", description: `${err.message} — pending tasks will still execute on their normal schedule.`, variant: "destructive" });
    },
  });

  // ── Summary stats ──────────────────────────────────────────────────────────

  const totalPendingApprovals = agents.reduce((s, a) => s + a.pendingApprovalCount, 0);
  const totalActiveAgents = agents.filter(a => a.isEnabled).length;
  const totalTodayActions = agents.reduce((s, a) => s + a.metrics.lastDayActions, 0);
  const overallSuccess =
    agents.reduce((s, a) => s + a.metrics.totalActions, 0) > 0
      ? Math.round(
          (agents.reduce((s, a) => s + a.metrics.successfulActions, 0) /
            agents.reduce((s, a) => s + a.metrics.totalActions, 0)) *
            100
        )
      : 100;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-7 w-7 text-primary" aria-hidden="true" />
            Agent command center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor, configure, and control your autonomous AI agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalPendingApprovals > 0 && (
            <Badge variant="destructive" className="animate-pulse" aria-live="polite" aria-label={`${totalPendingApprovals} task${totalPendingApprovals === 1 ? "" : "s"} awaiting your approval`}>
              <span className="tabular-nums">{totalPendingApprovals}</span> pending approval{totalPendingApprovals !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
            aria-label="Run autonomous processor now"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${triggerMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            Run now
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 m-0">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-acr-accent p-2">
              <Bot className="h-5 w-5 text-acr-accent" aria-hidden="true" />
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Active agents</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{totalActiveAgents}</dd>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-acr-warn-soft p-2">
              <Clock className="h-5 w-5 text-acr-warn" aria-hidden="true" />
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Awaiting approval</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{totalPendingApprovals}</dd>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-acr-pos-soft p-2">
              <Zap className="h-5 w-5 text-acr-pos" aria-hidden="true" />
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Actions today</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{totalTodayActions}</dd>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-acr-brand-soft p-2">
              <BarChart3 className="h-5 w-5 text-acr-brand" aria-hidden="true" />
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Success rate</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{overallSuccess}%</dd>
            </div>
          </div>
        </Card>
      </dl>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="approvals" className="relative">
            Approvals
            {totalPendingApprovals > 0 && (
              <span className="ml-1.5 rounded-full bg-acr-neg text-white text-[10px] px-1.5 py-0.5">
                {totalPendingApprovals}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks">Task log</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4">
          <div className="space-y-6">
            {/* Autonomy mode banner */}
            <div className="rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-primary mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-medium text-sm">Intelligent autonomy system</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Each agent has its own autonomy level. Low-risk actions (research, drafts) execute
                    automatically. High-risk actions (offers, contracts, outbound comms) route to your
                    approval queue. You stay in control of what matters.
                  </p>
                </div>
              </div>
            </div>

            {/* Agent cards */}
            {agentsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" role="status" aria-label="Loading agents">
                {[1, 2, 3, 4].map(i => (
                  <Card key={i} className="h-48 animate-pulse bg-muted/30" />
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 list-none p-0 m-0" aria-label={`${agents.length} autonomous agent${agents.length === 1 ? "" : "s"}`}>
                {agents.map(agent => (
                  <li key={agent.agentType}>
                    <AgentCard
                      agent={agent}
                      onConfigure={setConfiguringAgent}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* Risk level guide */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Risk classification guide</CardTitle>
                <CardDescription className="text-xs">
                  How the autonomy engine scores and routes actions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3 list-none p-0 m-0">
                  <li className="rounded-lg border border-acr-pos-soft bg-acr-pos-soft p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <CheckCircle2 className="h-4 w-4 text-acr-pos" aria-hidden="true" />
                      <span className="text-xs font-semibold text-acr-pos">Auto-execute</span>
                    </div>
                    <p className="text-[11px] text-acr-pos">Research, data lookups, drafts, calculations.</p>
                    <p className="text-[10px] text-acr-pos mt-1 tabular-nums">Risk score: 0–25</p>
                  </li>
                  <li className="rounded-lg border border-acr-warn-soft bg-acr-warn-soft p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertTriangle className="h-4 w-4 text-acr-warn" aria-hidden="true" />
                      <span className="text-xs font-semibold text-acr-warn">Needs approval</span>
                    </div>
                    <p className="text-[11px] text-acr-warn">Outbound comms, scheduling, data writes.</p>
                    <p className="text-[10px] text-acr-warn mt-1 tabular-nums">Risk score: 26–75</p>
                  </li>
                  <li className="rounded-lg border border-acr-neg-soft bg-acr-neg-soft p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <XCircle className="h-4 w-4 text-acr-neg" aria-hidden="true" />
                      <span className="text-xs font-semibold text-acr-neg">Always escalate</span>
                    </div>
                    <p className="text-[11px] text-acr-neg">Offers, contracts, financial commitments.</p>
                    <p className="text-[10px] text-acr-neg mt-1 tabular-nums">Risk score: 76–100</p>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Approvals ── */}
        <TabsContent value="approvals" className="mt-4">
          <div className="space-y-3">
            {tasksLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : pendingTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
                <CheckCircle2 className="h-12 w-12 text-acr-pos mb-3" aria-hidden="true" />
                <p className="font-medium">All caught up.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No tasks waiting for your approval.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    <span className="tabular-nums">{pendingTasks.length}</span> task{pendingTasks.length !== 1 ? "s" : ""} awaiting your review
                  </p>
                  {pendingTasks.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingApproveAll(true)}
                      aria-label={`Approve all ${pendingTasks.length} pending tasks`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                      Approve all
                    </Button>
                  )}
                </div>
                <ul className="space-y-3 list-none p-0 m-0" aria-label="Tasks awaiting your approval">
                  {pendingTasks.map(task => (
                    <li key={task.id}>
                      <TaskRow
                        task={task}
                        onApprove={id => approveMutation.mutate(id)}
                        onReject={id => rejectMutation.mutate(id)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Task Log ── */}
        <TabsContent value="tasks" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={taskFilter} onValueChange={setTaskFilter}>
                <SelectTrigger className="w-40" aria-label="Filter tasks by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tasks</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                Showing <span className="tabular-nums">{allTasks.length}</span> task{allTasks.length === 1 ? "" : "s"}
              </span>
            </div>

            {allTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center" role="status">
                <ListChecks className="h-12 w-12 text-muted-foreground mb-3" aria-hidden="true" />
                <p className="font-medium">No tasks yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Agent tasks will appear here as they're created and processed.
                </p>
              </div>
            ) : (
              <ul className="space-y-2 list-none p-0 m-0" aria-label={`${allTasks.length} agent task${allTasks.length === 1 ? "" : "s"}`}>
                {allTasks.map(task => (
                  <li key={task.id}>
                    <TaskRow
                      task={task}
                      onApprove={id => approveMutation.mutate(id)}
                      onReject={id => rejectMutation.mutate(id)}
                      onRun={id => runMutation.mutate(id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Config panel overlay */}
      {configuringAgent && (
        <AgentConfigPanel
          agent={configuringAgent}
          onClose={() => setConfiguringAgent(null)}
        />
      )}

      <ConfirmDialog
        open={pendingApproveAll}
        onOpenChange={(open) => { if (!open) setPendingApproveAll(false); }}
        title={`Approve all ${pendingTasks.length} pending task${pendingTasks.length === 1 ? "" : "s"}?`}
        description="Each task will be queued for autonomous execution. This includes any high-risk actions (offers, contracts, outbound comms) that were escalated for review."
        confirmLabel={`Approve ${pendingTasks.length}`}
        onConfirm={() => {
          pendingTasks.forEach(t => approveMutation.mutate(t.id));
          setPendingApproveAll(false);
        }}
      />
    </div>
  );
}
