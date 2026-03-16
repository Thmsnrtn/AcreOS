import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { formatDistanceToNow } from "date-fns";

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
    label: "Full Auto",
    description: "Agent acts on all tasks without waiting for approval",
    color: "text-green-600",
  },
  supervised: {
    label: "Supervised",
    description: "Agent auto-executes low-risk tasks, escalates high-risk ones",
    color: "text-amber-600",
  },
  manual: {
    label: "Manual",
    description: "Agent only acts when you explicitly approve each task",
    color: "text-red-600",
  },
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
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
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <CardDescription className="text-xs capitalize">{agent.agentType} agent</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.isActive && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Activity className="h-3 w-3 animate-pulse" />
              Active
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={() => onConfigure(agent)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Autonomy level */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Autonomy</span>
          <span className={`text-xs font-semibold ${autonomyInfo.color}`}>
            {autonomyInfo.label}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-lg font-bold">{agent.metrics.lastDayActions}</p>
            <p className="text-[10px] text-muted-foreground">Today</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-lg font-bold">{agent.pendingApprovalCount}</p>
            <p className="text-[10px] text-muted-foreground">Pending</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-lg font-bold">{successRate}%</p>
            <p className="text-[10px] text-muted-foreground">Success</p>
          </div>
        </div>

        {/* Success rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Success rate</span>
            <span>{agent.metrics.successfulActions}/{agent.metrics.totalActions} actions</span>
          </div>
          <Progress value={successRate} className="h-1.5" />
        </div>

        {/* Last active */}
        {agent.lastActiveAt && (
          <p className="text-[10px] text-muted-foreground">
            Last active {formatDistanceToNow(new Date(agent.lastActiveAt), { addSuffix: true })}
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

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors">
      <div className="rounded-md bg-primary/10 p-1.5 mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium capitalize">{task.agentType}</span>
          <code className="text-xs bg-muted rounded px-1 py-0.5">{action.replace(/_/g, " ")}</code>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[task.status] || ""}`}
          >
            {task.status}
          </Badge>
          {task.requiresReview && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">
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
          {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
          {task.executionTimeMs && ` · ${task.executionTimeMs}ms`}
        </p>
        {task.error && (
          <p className="text-xs text-red-600 mt-1">{task.error}</p>
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
              className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={() => onApprove?.(task.id)}
              title="Approve"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => onReject?.(task.id)}
              title="Reject"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {["pending", "failed"].includes(task.status) && !task.requiresReview && onRun && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onRun(task.id)}
            title="Run now"
          >
            <PlayCircle className="h-3.5 w-3.5" />
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
      toast({ title: "Configuration saved" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleCategory = (
    cat: ActionCategory,
    list: ActionCategory[],
    setList: (v: ActionCategory[]) => void
  ) => {
    setList(list.includes(cat) ? list.filter(c => c !== cat) : [...list, cat]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configure {agent.name}
          </CardTitle>
          <CardDescription>
            Control how autonomously this agent operates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Autonomy level */}
          <div className="space-y-2">
            <Label>Autonomy Level</Label>
            <Select
              value={autonomyLevel}
              onValueChange={v => setAutonomyLevel(v as AutonomyLevel)}
            >
              <SelectTrigger>
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
            <p className="text-xs text-muted-foreground">
              {AUTONOMY_LABELS[autonomyLevel].description}
            </p>
          </div>

          {/* Auto-approve categories */}
          <div className="space-y-2">
            <Label>Always Auto-Approve</Label>
            <p className="text-xs text-muted-foreground">
              These action types will always execute without approval, even in supervised mode.
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat, autoApprove, setAutoApprove)}
                  className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                    autoApprove.includes(cat)
                      ? "bg-green-100 border-green-400 text-green-800"
                      : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Always escalate categories */}
          <div className="space-y-2">
            <Label>Always Require Approval</Label>
            <p className="text-xs text-muted-foreground">
              These action types always require your sign-off, even in full-auto mode.
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat, escalate, setEscalate)}
                  className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                    escalate.includes(cat)
                      ? "bg-red-100 border-red-400 text-red-800"
                      : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Max actions per day */}
          <div className="space-y-2">
            <Label>Max Actions Per Day</Label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxActions}
              onChange={e => setMaxActions(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Notify on action */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Notify on Each Action</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send a notification every time this agent takes an action
              </p>
            </div>
            <Switch checked={notifyOnAction} onCheckedChange={setNotifyOnAction} />
          </div>

          {/* Custom instructions */}
          <div className="space-y-2">
            <Label>Custom Instructions</Label>
            <Textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              placeholder="e.g. Only send emails on weekdays. Never contact leads marked as DNC."
              className="h-24 text-sm"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                updateMutation.mutate({
                  autonomyLevel,
                  autoApproveCategories: autoApprove,
                  escalateToHuman: escalate,
                  maxActionsPerDay: parseInt(maxActions) || 50,
                  notifyOnAction,
                  customInstructions,
                })
              }
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentCommandCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [configuringAgent, setConfiguringAgent] = useState<AgentStatus | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [taskFilter, setTaskFilter] = useState<string>("all");

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
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
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
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
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
      toast({ title: "Execution failed", description: err.message, variant: "destructive" });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/autonomous/trigger-processor", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autonomous/tasks"] });
      toast({ title: "Processor triggered" });
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
            <Brain className="h-7 w-7 text-primary" />
            Agent Command Center
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor, configure, and control your autonomous AI agents
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalPendingApprovals > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              {totalPendingApprovals} pending approval{totalPendingApprovals !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${triggerMutation.isPending ? "animate-spin" : ""}`} />
            Run Now
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2">
              <Bot className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Agents</p>
              <p className="text-2xl font-bold">{totalActiveAgents}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-100 p-2">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Awaiting Approval</p>
              <p className="text-2xl font-bold">{totalPendingApprovals}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2">
              <Zap className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Actions Today</p>
              <p className="text-2xl font-bold">{totalTodayActions}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-100 p-2">
              <BarChart3 className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Success Rate</p>
              <p className="text-2xl font-bold">{overallSuccess}%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="approvals" className="relative">
            Approvals
            {totalPendingApprovals > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500 text-white text-[10px] px-1.5 py-0.5">
                {totalPendingApprovals}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks">Task Log</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-4">
          <div className="space-y-6">
            {/* Autonomy mode banner */}
            <div className="rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Intelligent Autonomy System</p>
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <Card key={i} className="h-48 animate-pulse bg-muted/30" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {agents.map(agent => (
                  <AgentCard
                    key={agent.agentType}
                    agent={agent}
                    onConfigure={setConfiguringAgent}
                  />
                ))}
              </div>
            )}

            {/* Risk level guide */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Risk Classification Guide</CardTitle>
                <CardDescription className="text-xs">
                  How the autonomy engine scores and routes actions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-xs font-semibold text-green-800">Auto-Execute</span>
                    </div>
                    <p className="text-[11px] text-green-700">Research, data lookups, drafts, calculations</p>
                    <p className="text-[10px] text-green-600 mt-1">Risk score: 0–25</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span className="text-xs font-semibold text-amber-800">Needs Approval</span>
                    </div>
                    <p className="text-[11px] text-amber-700">Outbound comms, scheduling, data writes</p>
                    <p className="text-[10px] text-amber-600 mt-1">Risk score: 26–75</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-xs font-semibold text-red-800">Always Escalate</span>
                    </div>
                    <p className="text-[11px] text-red-700">Offers, contracts, financial commitments</p>
                    <p className="text-[10px] text-red-600 mt-1">Risk score: 76–100</p>
                  </div>
                </div>
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
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
                <p className="font-medium">All caught up!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No tasks waiting for your approval.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {pendingTasks.length} task{pendingTasks.length !== 1 ? "s" : ""} awaiting your review
                  </p>
                  {pendingTasks.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        pendingTasks.forEach(t => approveMutation.mutate(t.id));
                      }}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                      Approve All
                    </Button>
                  )}
                </div>
                {pendingTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onApprove={id => approveMutation.mutate(id)}
                    onReject={id => rejectMutation.mutate(id)}
                  />
                ))}
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Task Log ── */}
        <TabsContent value="tasks" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={taskFilter} onValueChange={setTaskFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Showing {allTasks.length} tasks
              </span>
            </div>

            {allTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ListChecks className="h-12 w-12 text-muted-foreground mb-3" />
                <p className="font-medium">No tasks yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Agent tasks will appear here as they're created and processed.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {allTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onApprove={id => approveMutation.mutate(id)}
                    onReject={id => rejectMutation.mutate(id)}
                    onRun={id => runMutation.mutate(id)}
                  />
                ))}
              </div>
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
    </div>
  );
}
