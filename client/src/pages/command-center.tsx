import { useState, useRef, useEffect } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAgentTasks, useCreateAgentTask } from "@/hooks/use-agent-tasks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Bot,
  Target,
  Calculator,
  Megaphone,
  Search,
  FileText,
  Send,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
  ChevronRight,
  Wrench,
  Users,
  Settings2,
  Settings,
  Zap,
  Clock,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  TrendingUp,
  Brain,
  Briefcase,
  Sparkles,
  Play,
  Check,
  X,
  ListTodo,
  Bell,
  GitBranch,
  RefreshCw,
  Activity,
  Headphones,
} from "lucide-react";
import { AISettings } from "@/components/ai-settings";
import { formatDistanceToNow } from "date-fns";
import { DisclaimerBanner } from "@/components/disclaimer-banner";

interface Agent {
  name: string;
  role: string;
  displayName: string;
  description: string;
  icon: string;
}

interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: any;
    result: any;
  }>;
  createdAt: string;
}

interface Conversation {
  id: number;
  organizationId: number;
  userId: string;
  title: string;
  agentRole: string;
  createdAt: string;
  updatedAt: string;
}

interface VAAgent {
  id: string;
  type: string;
  name: string;
  description: string;
  status: "active" | "idle" | "disabled";
  enabled: boolean;
  autonomyLevel: "full_auto" | "supervised" | "manual";
  pendingActions: number;
  customInstructions?: string;
}

interface VAAction {
  id: string;
  agentType: string;
  agentName: string;
  title: string;
  description: string;
  status: "proposed" | "approved" | "completed" | "rejected";
  createdAt: string;
  metadata?: Record<string, any>;
}

interface DailyBriefing {
  id: string;
  summary: string;
  generatedAt: string;
  highlights: string[];
}

const agentIcons: Record<string, typeof Bot> = {
  Bot,
  Target,
  Calculator,
  Megaphone,
  Search,
  FileText,
  Briefcase,
  DollarSign,
  executive: Briefcase,
  sales: MessageSquare,
  acquisitions: Target,
  marketing: Megaphone,
  collections: DollarSign,
  research: Search,
};

function getAgentIcon(iconName: string) {
  return agentIcons[iconName] || Bot;
}

const defaultVAAgents: VAAgent[] = [
  { id: "1", type: "executive", name: "Executive VA", description: "Oversees all operations and provides strategic insights", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 3 },
  { id: "2", type: "sales", name: "Sales VA", description: "Handles buyer communications and follow-ups", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 5 },
  { id: "3", type: "acquisitions", name: "Acquisitions VA", description: "Manages seller outreach and deal negotiation", status: "idle", enabled: true, autonomyLevel: "manual", pendingActions: 2 },
  { id: "4", type: "marketing", name: "Marketing VA", description: "Creates campaigns and marketing content", status: "idle", enabled: true, autonomyLevel: "full_auto", pendingActions: 0 },
  { id: "5", type: "collections", name: "Collections VA", description: "Manages payment reminders and note servicing", status: "disabled", enabled: false, autonomyLevel: "manual", pendingActions: 0 },
  { id: "6", type: "research", name: "Research VA", description: "Performs due diligence and market research", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 1 },
];

const defaultVAActions: VAAction[] = [
  { id: "1", agentType: "sales", agentName: "Sales VA", title: "Send follow-up email to Robert Chen", description: "Buyer showed interest in 10-acre parcels, proposing a personalized property list", status: "proposed", createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: "2", agentType: "acquisitions", agentName: "Acquisitions VA", title: "Generate offer letter for Maria Garcia", description: "Seller responded to mailer, ready to send $4,500 offer", status: "proposed", createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
  { id: "3", agentType: "research", agentName: "Research VA", title: "Due diligence completed for APN 456-78-901", description: "Title clear, no liens, road access verified", status: "completed", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  { id: "4", agentType: "marketing", agentName: "Marketing VA", title: "Created Facebook ad campaign", description: "Targeting AZ land buyers, budget $50/day", status: "approved", createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
  { id: "5", agentType: "executive", agentName: "Executive VA", title: "Weekly performance report generated", description: "Summarized 12 deals in pipeline, 3 closings expected", status: "completed", createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() },
];

function getStatusColor(status: VAAction["status"]) {
  switch (status) {
    case "proposed": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    case "approved": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "completed": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}

function getAgentStatusColor(status: VAAgent["status"]) {
  switch (status) {
    case "active": return "bg-green-500";
    case "idle": return "bg-amber-500";
    case "disabled": return "bg-muted-foreground";
    default: return "bg-muted-foreground";
  }
}

function TeamTabContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  const { data: vaAgents = defaultVAAgents, isLoading: vaAgentsLoading } = useQuery<VAAgent[]>({
    queryKey: ["/api/va/agents"],
    retry: false,
    staleTime: 30000,
  });

  const { data: vaActions = defaultVAActions, isLoading: vaActionsLoading } = useQuery<VAAction[]>({
    queryKey: ["/api/va/actions"],
    retry: false,
    staleTime: 30000,
  });

  const { data: briefing } = useQuery<DailyBriefing>({
    queryKey: ["/api/va/briefings/latest"],
    retry: false,
    staleTime: 60000,
  });

  const updateAgentMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<VAAgent> }) => {
      const res = await apiRequest("PATCH", `/api/va/agents/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/agents"] });
      toast({ title: "Agent updated", description: "Settings saved successfully" });
    },
    onError: () => {
      toast({ title: "Update failed", description: "Could not save agent settings", variant: "destructive" });
    },
  });

  const approveActionMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await apiRequest("POST", `/api/va/actions/${actionId}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/actions"] });
      toast({ title: "Action approved", description: "The agent will proceed with this task" });
    },
    onError: () => {
      toast({ title: "Approval failed", variant: "destructive" });
    },
  });

  const rejectActionMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await apiRequest("POST", `/api/va/actions/${actionId}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/actions"] });
      toast({ title: "Action rejected", description: "The agent will not proceed with this task" });
    },
    onError: () => {
      toast({ title: "Rejection failed", variant: "destructive" });
    },
  });

  const submitTaskMutation = useMutation({
    mutationFn: async ({ agentType, task }: { agentType: string; task: string }) => {
      const res = await apiRequest("POST", `/api/va/agents/${agentType}/task`, { task });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/actions"] });
      setTaskDialogOpen(false);
      setTaskInput("");
      toast({ title: "Task assigned", description: "The agent will work on this task" });
    },
    onError: () => {
      toast({ title: "Task submission failed", variant: "destructive" });
    },
  });

  const generateBriefingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/va/briefings/generate", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/briefings/latest"] });
      toast({ title: "Briefing generated", description: "Your daily briefing is ready" });
    },
    onError: () => {
      toast({ title: "Briefing generation failed", variant: "destructive" });
    },
  });

  const selectedAgent = vaAgents.find((a) => a.id === selectedAgentId);

  const filteredActions = vaActions.filter((action) => {
    if (agentFilter !== "all" && action.agentType !== agentFilter) return false;
    if (statusFilter !== "all" && action.status !== statusFilter) return false;
    return true;
  });

  const agentActions = selectedAgent
    ? vaActions.filter((a) => a.agentType === selectedAgent.type)
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          onClick={() => generateBriefingMutation.mutate()}
          disabled={generateBriefingMutation.isPending}
          data-testid="button-generate-briefing"
        >
          {generateBriefingMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <FileText className="w-4 h-4 mr-2" />
          )}
          Generate Daily Briefing
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-72 border-r border-border flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-muted-foreground">Agent Roster</h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2" data-testid="list-va-agents">
              {vaAgentsLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))
              ) : (
                vaAgents.map((agent) => {
                  const IconComponent = getAgentIcon(agent.type);
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary"
                          : "hover-elevate"
                      }`}
                      data-testid={`card-va-agent-${agent.type}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{agent.name}</span>
                            <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(agent.status)}`} />
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {agent.description}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {agent.pendingActions > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {agent.pendingActions} pending
                              </Badge>
                            )}
                            <Switch
                              checked={agent.enabled}
                              onCheckedChange={(checked) => {
                                updateAgentMutation.mutate({
                                  id: agent.id,
                                  updates: { enabled: checked },
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`switch-va-agent-enabled-${agent.type}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {briefing && (
            <Card className="m-4 mb-0 border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm mb-1">Daily Briefing</h3>
                    <p className="text-sm text-muted-foreground">{briefing.summary}</p>
                    {briefing.highlights && briefing.highlights.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {briefing.highlights.slice(0, 3).map((h, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                            <Check className="w-3 h-3 text-green-500" /> {h}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Generated {formatDistanceToNow(new Date(briefing.generatedAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-muted-foreground mr-auto">Activity Feed</h2>
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-40" data-testid="select-va-agent-filter">
                <SelectValue placeholder="Filter by agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {vaAgents.map((agent) => (
                  <SelectItem key={agent.type} value={agent.type}>{agent.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-va-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="proposed">Proposed</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3" data-testid="list-va-actions">
              {vaActionsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-lg" />
                ))
              ) : filteredActions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertCircle className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground text-sm">No actions match your filters</p>
                </div>
              ) : (
                filteredActions.map((action) => {
                  const IconComponent = getAgentIcon(action.agentType);
                  return (
                    <Card key={action.id} className="overflow-visible" data-testid={`card-va-action-${action.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-muted">
                            <IconComponent className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-medium text-sm">{action.title}</span>
                              <Badge className={`text-xs ${getStatusColor(action.status)}`}>
                                {action.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{action.description}</p>
                            <div className="flex items-center gap-4 mt-2 flex-wrap">
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDistanceToNow(new Date(action.createdAt), { addSuffix: true })}
                              </span>
                              <span className="text-xs text-muted-foreground">{action.agentName}</span>
                            </div>
                          </div>
                          {action.status === "proposed" && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => rejectActionMutation.mutate(action.id)}
                                disabled={rejectActionMutation.isPending}
                                data-testid={`button-reject-va-action-${action.id}`}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => approveActionMutation.mutate(action.id)}
                                disabled={approveActionMutation.isPending}
                                data-testid={`button-approve-va-action-${action.id}`}
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="w-80 border-l border-border flex flex-col overflow-hidden">
          {!selectedAgent ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Settings2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm">Select an agent to view details and settings</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  {(() => {
                    const IconComponent = getAgentIcon(selectedAgent.type);
                    return (
                      <div className="p-3 rounded-lg bg-primary text-primary-foreground">
                        <IconComponent className="w-5 h-5" />
                      </div>
                    );
                  })()}
                  <div>
                    <h3 className="font-semibold" data-testid="text-selected-va-agent-name">{selectedAgent.name}</h3>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(selectedAgent.status)}`} />
                      <span className="text-xs text-muted-foreground capitalize">{selectedAgent.status}</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-3">{selectedAgent.description}</p>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold mb-3">Settings</h4>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Enabled</p>
                          <p className="text-xs text-muted-foreground">Allow this agent to operate</p>
                        </div>
                        <Switch
                          checked={selectedAgent.enabled}
                          onCheckedChange={(checked) => {
                            updateAgentMutation.mutate({
                              id: selectedAgent.id,
                              updates: { enabled: checked },
                            });
                          }}
                          data-testid="switch-va-agent-enabled-detail"
                        />
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Autonomy Level</p>
                        <Select
                          value={selectedAgent.autonomyLevel}
                          onValueChange={(value: VAAgent["autonomyLevel"]) => {
                            updateAgentMutation.mutate({
                              id: selectedAgent.id,
                              updates: { autonomyLevel: value },
                            });
                          }}
                        >
                          <SelectTrigger data-testid="select-va-autonomy-level">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="full_auto">Full Auto</SelectItem>
                            <SelectItem value="supervised">Supervised</SelectItem>
                            <SelectItem value="manual">Manual</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {selectedAgent.autonomyLevel === "full_auto" && "Agent acts without approval"}
                          {selectedAgent.autonomyLevel === "supervised" && "Agent proposes actions for approval"}
                          {selectedAgent.autonomyLevel === "manual" && "Agent only acts when assigned tasks"}
                        </p>
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Custom Instructions</p>
                        <Textarea
                          placeholder="Add custom instructions for this agent..."
                          value={customInstructions || selectedAgent.customInstructions || ""}
                          onChange={(e) => setCustomInstructions(e.target.value)}
                          className="min-h-[100px]"
                          data-testid="textarea-va-custom-instructions"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => {
                            updateAgentMutation.mutate({
                              id: selectedAgent.id,
                              updates: { customInstructions },
                            });
                          }}
                          disabled={updateAgentMutation.isPending}
                          data-testid="button-save-va-instructions"
                        >
                          Save Instructions
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="w-full" data-testid="button-assign-va-task">
                          <Play className="w-4 h-4 mr-2" />
                          Assign Task
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Assign Task to {selectedAgent.name}</DialogTitle>
                          <DialogDescription>
                            Describe the task you want this agent to perform.
                          </DialogDescription>
                        </DialogHeader>
                        <Textarea
                          placeholder="E.g., Send follow-up emails to all leads who haven't responded in 7 days..."
                          value={taskInput}
                          onChange={(e) => setTaskInput(e.target.value)}
                          className="min-h-[120px]"
                          data-testid="textarea-va-task-input"
                        />
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setTaskDialogOpen(false)}
                            data-testid="button-cancel-va-task"
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={() => {
                              submitTaskMutation.mutate({
                                agentType: selectedAgent.type,
                                task: taskInput,
                              });
                            }}
                            disabled={!taskInput.trim() || submitTaskMutation.isPending}
                            data-testid="button-submit-va-task"
                          >
                            {submitTaskMutation.isPending ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : null}
                            Submit Task
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-3">Recent Actions</h4>
                    {agentActions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No recent actions</p>
                    ) : (
                      <div className="space-y-2">
                        {agentActions.slice(0, 5).map((action) => (
                          <div
                            key={action.id}
                            className="p-3 rounded-lg bg-muted/50"
                            data-testid={`card-va-agent-action-${action.id}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium truncate">{action.title}</span>
                              <Badge className={`text-xs shrink-0 ${getStatusColor(action.status)}`}>
                                {action.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(action.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface BackgroundAgent {
  id: string;
  name: string;
  description: string;
  frequency: string;
  icon: typeof Bot;
  status: "running" | "idle" | "error";
  lastRunAt?: string;
  processedCount?: number;
  errorCount?: number;
}

interface AgentRunStatus {
  id: number;
  agentName: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  processedCount: number | null;
  errorCount: number | null;
  lastError: string | null;
  metadata: Record<string, any> | null;
}

const defaultBackgroundAgents: Omit<BackgroundAgent, "status" | "lastRunAt" | "processedCount" | "errorCount">[] = [
  {
    id: "lead_nurturer",
    name: "Lead Nurturer",
    description: "Scores leads and generates personalized follow-up sequences",
    frequency: "Every 30 minutes",
    icon: Users,
  },
  {
    id: "campaign_optimizer",
    name: "Campaign Optimizer",
    description: "Analyzes campaign performance and suggests optimizations",
    frequency: "Every hour",
    icon: TrendingUp,
  },
  {
    id: "finance_agent",
    name: "Finance Agent",
    description: "Handles delinquency detection and payment reminders",
    frequency: "Every 4 hours",
    icon: DollarSign,
  },
  {
    id: "alerting_service",
    name: "Alerting Service",
    description: "Monitors system health and detects issues",
    frequency: "Every 15 minutes",
    icon: Bell,
  },
  {
    id: "digest_service",
    name: "Digest Service",
    description: "Generates performance summaries and reports",
    frequency: "Weekly",
    icon: FileText,
  },
  {
    id: "sequence_processor",
    name: "Sequence Processor",
    description: "Processes automation sequences and workflows",
    frequency: "Every minute",
    icon: GitBranch,
  },
];

function getAgentStatusBadge(status: BackgroundAgent["status"]) {
  switch (status) {
    case "running":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Running</Badge>;
    case "idle":
      return <Badge variant="secondary">Idle</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Error</Badge>;
    default:
      return <Badge variant="outline">Unknown</Badge>;
  }
}

function AgentsTabContent() {
  const { toast } = useToast();

  const { data: agentStatuses = [], isLoading } = useQuery<AgentRunStatus[]>({
    queryKey: ["/api/agents/status"],
    refetchInterval: 30000,
  });

  const backgroundAgents: BackgroundAgent[] = defaultBackgroundAgents.map((agent) => {
    const apiStatus = agentStatuses.find((s) => s.agentName === agent.id);
    const status: BackgroundAgent["status"] = apiStatus
      ? (apiStatus.status === "failed" ? "error" : apiStatus.status === "running" ? "running" : apiStatus.status === "completed" ? "idle" : "idle")
      : "idle";
    return {
      ...agent,
      status,
      lastRunAt: apiStatus?.lastRunAt || undefined,
      processedCount: apiStatus?.processedCount || 0,
      errorCount: apiStatus?.errorCount || 0,
    };
  });

  const handleViewActivity = (agentId: string, agentName: string) => {
    toast({ 
      title: "Coming Soon", 
      description: `Activity logs for ${agentName} will be available in a future update.` 
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1">Background Agent Services</h2>
        <p className="text-sm text-muted-foreground">
          These agents run automatically in the background to keep your business running smoothly.
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="flex flex-col" data-testid={`card-agent-skeleton-${i}`}>
                <CardHeader className="pb-3">
                  <Skeleton className="h-10 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-16 w-full mb-3" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))
          ) : (
            backgroundAgents.map((agent) => {
              const IconComponent = agent.icon;

              return (
                <Card key={agent.id} className="flex flex-col" data-testid={`card-agent-${agent.id}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${agent.status === "running" ? "bg-green-100 dark:bg-green-900/30" : agent.status === "error" ? "bg-red-100 dark:bg-red-900/30" : "bg-muted"}`}>
                          <IconComponent className={`w-4 h-4 ${agent.status === "running" ? "text-green-600 dark:text-green-400" : agent.status === "error" ? "text-red-600 dark:text-red-400" : ""}`} />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-medium">{agent.name}</CardTitle>
                        </div>
                      </div>
                      {getAgentStatusBadge(agent.status)}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">{agent.description}</p>
                    
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <RefreshCw className="w-3 h-3" />
                        <span>{agent.frequency}</span>
                      </div>
                      {agent.lastRunAt && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>Last run: {formatDistanceToNow(new Date(agent.lastRunAt), { addSuffix: true })}</span>
                        </div>
                      )}
                      {(agent.processedCount !== undefined && agent.processedCount > 0) && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          <span>Processed: {agent.processedCount}</span>
                        </div>
                      )}
                      {(agent.errorCount !== undefined && agent.errorCount > 0) && (
                        <div className="flex items-center gap-2 text-red-500">
                          <AlertCircle className="w-3 h-3" />
                          <span>Errors: {agent.errorCount}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-auto pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleViewActivity(agent.id, agent.name)}
                        data-testid={`button-view-agent-${agent.id}`}
                      >
                        <Activity className="w-3 h-3 mr-1" />
                        View Activity
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

const agentTypeDescriptions: Record<string, { description: string; placeholder: string }> = {
  research: {
    description: "Use this agent to analyze county data, pricing, and comps.",
    placeholder: "Describe your research task here..."
  },
  marketing: {
    description: "Use this agent to write ad copy and generate listing descriptions.",
    placeholder: "Describe your marketing task here..."
  },
  lead_nurturing: {
    description: "Score leads and generate personalized follow-up sequences.",
    placeholder: "Describe which leads to nurture or follow-up strategy..."
  },
  campaign: {
    description: "Analyze campaign performance and suggest optimizations.",
    placeholder: "Describe which campaign to optimize or analyze..."
  },
  finance: {
    description: "Handle payment reminders and delinquency management.",
    placeholder: "Describe payment reminders or collection tasks..."
  },
  support: {
    description: "Handle support cases and generate response recommendations.",
    placeholder: "Describe the support case or issue to handle..."
  }
};

function TasksTabContent() {
  const { data: tasks, isLoading } = useAgentTasks();
  const { mutate: createTask, isPending } = useCreateAgentTask();
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("research");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    createTask({
      agentType: activeTab,
      input: input,
      status: "pending"
    }, {
      onSuccess: () => setInput("")
    });
  };

  const currentAgentType = agentTypeDescriptions[activeTab] || agentTypeDescriptions.research;

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <Card className="col-span-1 shadow-sm flex flex-col">
          <CardHeader className="bg-muted/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4" /> New Task
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col pt-6 gap-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <ScrollArea className="w-full">
                <TabsList className="inline-flex w-max gap-1 p-1">
                  <TabsTrigger value="research" data-testid="tab-task-research">
                    <Search className="w-3 h-3 mr-1" />
                    Research
                  </TabsTrigger>
                  <TabsTrigger value="marketing" data-testid="tab-task-marketing">
                    <Megaphone className="w-3 h-3 mr-1" />
                    Marketing
                  </TabsTrigger>
                  <TabsTrigger value="lead_nurturing" data-testid="tab-task-lead-nurturing">
                    <Users className="w-3 h-3 mr-1" />
                    Nurturing
                  </TabsTrigger>
                  <TabsTrigger value="campaign" data-testid="tab-task-campaign">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    Campaign
                  </TabsTrigger>
                  <TabsTrigger value="finance" data-testid="tab-task-finance">
                    <DollarSign className="w-3 h-3 mr-1" />
                    Finance
                  </TabsTrigger>
                  <TabsTrigger value="support" data-testid="tab-task-support">
                    <Headphones className="w-3 h-3 mr-1" />
                    Support
                  </TabsTrigger>
                </TabsList>
              </ScrollArea>
              <div className="mt-4 text-sm text-muted-foreground">
                {currentAgentType.description}
              </div>
            </Tabs>
            
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4">
              <Textarea 
                placeholder={currentAgentType.placeholder}
                className="flex-1 resize-none p-4 text-base"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                data-testid="textarea-quick-task"
              />
              <div className="flex flex-col gap-1">
                <Button type="submit" className="w-full" disabled={isPending || !input.trim()} data-testid="button-deploy-task">
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Deploy Agent
                </Button>
                <span className="text-xs text-muted-foreground text-center" data-testid="text-cost-agent-task">$0.02 per task</span>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-2 shadow-sm flex flex-col overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <CardTitle className="text-base">Active Operations</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 relative">
            <ScrollArea className="h-full absolute inset-0">
              <div className="p-6 space-y-6">
                {isLoading ? (
                  <div className="text-center py-10 text-muted-foreground">Connecting to agents...</div>
                ) : tasks?.length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground">
                    <Bot className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    No active tasks. Start a new one!
                  </div>
                ) : (
                  tasks?.map((task) => (
                    <div key={task.id} className="group flex gap-4" data-testid={`task-item-${task.id}`}>
                      <div className="flex flex-col items-center gap-2">
                        <div className={`w-2 h-full rounded-full ${
                          task.status === 'completed' ? 'bg-green-500/20' : 'bg-muted'
                        }`} />
                      </div>
                      <div className="flex-1 pb-8">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className="capitalize">{task.agentType}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {task.createdAt ? new Date(task.createdAt).toLocaleTimeString() : 'Just now'}
                          </span>
                          {task.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                          {task.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                        </div>
                        <div className="bg-muted/50 rounded-lg p-4 mb-3 border">
                          <p className="text-sm font-medium">{String(task.input ?? '')}</p>
                        </div>
                        {task.output != null && task.output !== '' ? (
                          <div className="bg-green-50/50 dark:bg-green-900/10 rounded-lg p-4 border border-green-100 dark:border-green-900/50">
                            <p className="text-sm whitespace-pre-wrap leading-relaxed">
                              {String(task.output)}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface Suggestion {
  label: string;
  skill: string;
  actionId: string;
  category: "insight" | "action";
  requiredTier?: string;
  available: boolean;
  currentTier: string;
}

interface ActiveSkill {
  type: string;
  label: string;
}

export default function CommandCenterPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState<string>("chat");
  const [input, setInput] = useState("");
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<Array<{ name: string; result?: any }>>([]);
  const [activeSkill, setActiveSkill] = useState<ActiveSkill | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: suggestions = [] } = useQuery<Suggestion[]>({
    queryKey: ["/api/assistant/suggestions"],
  });

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/ai/conversations"],
  });

  const { data: currentConversation, isLoading: messagesLoading } = useQuery<{
    conversation: Conversation;
    messages: Message[];
  }>({
    queryKey: ["/api/ai/conversations", currentConversationId],
    enabled: !!currentConversationId,
  });

  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/conversations", { agentRole: "assistant" });
      return res.json() as Promise<Conversation>;
    },
    onSuccess: (conversation) => {
      setCurrentConversationId(conversation.id);
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/conversations/${id}`, {});
    },
    onSuccess: () => {
      if (currentConversationId) {
        setCurrentConversationId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
    },
  });

  const classifyIntentMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/assistant/classify-intent", { message });
      return res.json();
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentConversation?.messages, streamingContent]);

  const sendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    const message = input.trim();
    setInput("");
    setStreamingContent("");
    setPendingToolCalls([]);
    setIsStreaming(true);
    setActiveSkill(null);

    try {
      const intentResult = await classifyIntentMutation.mutateAsync(message);
      if (intentResult?.skillLabel) {
        setActiveSkill({ type: intentResult.agentType, label: intentResult.skillLabel });
      }

      let conversationId = currentConversationId;
      if (!conversationId) {
        try {
          const newConversation = await createConversationMutation.mutateAsync();
          conversationId = newConversation.id;
          setCurrentConversationId(conversationId);
        } catch (err) {
          toast({
            title: "Error",
            description: "Failed to create conversation. Please try again.",
            variant: "destructive",
          });
          setInput(message);
          setIsStreaming(false);
          return;
        }
      }

      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId,
          agentRole: "assistant",
        }),
        credentials: "include",
      });

      if (response.status === 402) {
        toast({
          title: "Insufficient AI Credits",
          description: "Please add credits to continue using the AI assistant. Visit Settings to purchase more.",
          variant: "destructive",
        });
        setInput(message);
        setIsStreaming(false);
        setActiveSkill(null);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "content" && data.content) {
                accumulatedContent += data.content;
                setStreamingContent(accumulatedContent);
              } else if (data.type === "tool_start") {
                setPendingToolCalls((prev) => [...prev, { name: data.toolCall?.name }]);
              } else if (data.type === "tool_result") {
                setPendingToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.name === data.toolCall?.name ? { ...tc, result: data.toolCall?.result } : tc
                  )
                );
              } else if (data.type === "done") {
                queryClient.invalidateQueries({ queryKey: ["/api/ai/conversations"] });
                if (currentConversationId) {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/ai/conversations", currentConversationId],
                  });
                }
              }
            } catch (e) {
            }
          }
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);
      toast({ title: "Error", description: "Failed to send message", variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setPendingToolCalls([]);
      setActiveSkill(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewConversation = () => {
    createConversationMutation.mutate();
  };

  const handleSelectConversation = (id: number) => {
    setCurrentConversationId(id);
  };

  const handleSuggestionClick = (suggestion: Suggestion) => {
    if (!suggestion.available && suggestion.category === "action") {
      toast({
        title: "Upgrade Required",
        description: `This action requires ${suggestion.requiredTier || 'a higher'} tier. Upgrade in Settings to unlock it.`,
        variant: "default",
      });
      return;
    }
    setInput(suggestion.label);
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteConversationMutation.mutate(id);
  };

  const messages = currentConversation?.messages || [];

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] h-screen flex flex-col overflow-hidden">
        <div className="p-4 pt-16 md:pt-4 border-b border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-primary rounded-lg text-primary-foreground">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold" data-testid="text-page-title">AcreOS Assistant</h1>
              <p className="text-sm text-muted-foreground">Your AI partner for land investment</p>
            </div>
          </div>
          <DisclaimerBanner type="ai" className="mb-4" />
          <div className="flex items-center gap-2">
            <Tabs value={mainTab} onValueChange={setMainTab} className="flex-1">
              <TabsList className={isMobile ? "w-full" : ""}>
                <TabsTrigger value="chat" className={isMobile ? "flex-1" : ""} data-testid="tab-chat">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Assistant
                </TabsTrigger>
                <TabsTrigger value="team" className={isMobile ? "flex-1" : ""} data-testid="tab-team">
                  <Users className="w-4 h-4 mr-2" />
                  Team
                </TabsTrigger>
                <TabsTrigger value="tasks" className={isMobile ? "flex-1" : ""} data-testid="tab-tasks">
                  <ListTodo className="w-4 h-4 mr-2" />
                  Tasks
                </TabsTrigger>
                <TabsTrigger value="agents" className={isMobile ? "flex-1" : ""} data-testid="tab-agents">
                  <Bot className="w-4 h-4 mr-2" />
                  Background
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-ai-settings">
                  <Settings className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    AI Settings
                  </DialogTitle>
                  <DialogDescription>
                    Configure AI behavior preferences
                  </DialogDescription>
                </DialogHeader>
                <AISettings compact={true} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          {mainTab === "chat" && (
            <div className="flex flex-1 h-full overflow-hidden">
              {!isMobile && (
                <div className="w-72 border-r border-border flex flex-col">
                  <div className="p-4 border-b border-border">
                    <Button
                      onClick={handleNewConversation}
                      className="w-full"
                      disabled={createConversationMutation.isPending}
                      data-testid="button-new-conversation"
                    >
                      {createConversationMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      New Conversation
                    </Button>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1" data-testid="list-conversations">
                      {conversationsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : conversations.length === 0 ? (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                          No conversations yet
                        </div>
                      ) : (
                        conversations.map((conv) => (
                          <div
                            key={conv.id}
                            onClick={() => handleSelectConversation(conv.id)}
                            className={`flex items-center gap-2 p-3 rounded-lg cursor-pointer group transition-colors ${
                              currentConversationId === conv.id
                                ? "bg-primary/10 text-primary"
                                : "hover-elevate"
                            }`}
                            data-testid={`conversation-item-${conv.id}`}
                          >
                            <MessageSquare className="w-4 h-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{conv.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(conv.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={(e) => handleDeleteConversation(e, conv.id)}
                              data-testid={`button-delete-conversation-${conv.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <div className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 p-4" data-testid="list-messages">
                  <div className="max-w-3xl mx-auto space-y-4">
                    {!currentConversationId ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                          <Sparkles className="w-10 h-10 text-primary" />
                        </div>
                        <h3 className="text-xl font-semibold mb-2" data-testid="text-assistant-welcome">AcreOS Assistant</h3>
                        <p className="text-muted-foreground text-sm max-w-md mb-8">
                          Your intelligent partner for land investment. I can help with research, deals, communications, and operations.
                        </p>
                        
                        {suggestions.length > 0 && (
                          <div className="w-full max-w-2xl">
                            <p className="text-xs text-muted-foreground mb-3">Try asking me to:</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {suggestions.slice(0, 6).map((suggestion, idx) => (
                                <Button
                                  key={idx}
                                  variant="outline"
                                  className={`justify-start text-left h-auto py-3 px-4 ${
                                    !suggestion.available && suggestion.category === "action" 
                                      ? "opacity-60" 
                                      : ""
                                  }`}
                                  onClick={() => handleSuggestionClick(suggestion)}
                                  data-testid={`button-suggestion-${idx}`}
                                >
                                  <div className="flex flex-col items-start gap-1 w-full">
                                    <div className="flex items-center gap-2 w-full">
                                      <span className="font-medium text-sm">{suggestion.label}</span>
                                      {suggestion.category === "insight" && (
                                        <Badge variant="secondary" className="text-xs ml-auto">
                                          Free
                                        </Badge>
                                      )}
                                      {suggestion.category === "action" && !suggestion.available && (
                                        <Badge variant="outline" className="text-xs ml-auto">
                                          {suggestion.requiredTier}
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground">{suggestion.skill}</span>
                                  </div>
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : messagesLoading ? (
                      <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : messages.length === 0 && !streamingContent ? (
                      <div className="flex flex-col items-center justify-center h-64 text-center">
                        <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-4" />
                        <p className="text-muted-foreground text-sm">
                          Send a message to start the conversation
                        </p>
                      </div>
                    ) : (
                      <>
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            data-testid={`message-${msg.id}`}
                          >
                            <div
                              className={`max-w-[80%] rounded-lg p-4 ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-card border"
                              }`}
                            >
                              <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                              {msg.toolCalls && msg.toolCalls.length > 0 && (
                                <Accordion type="single" collapsible className="mt-3">
                                  <AccordionItem value="tools" className="border-t border-border/50">
                                    <AccordionTrigger className="py-2 text-xs">
                                      <span className="flex items-center gap-2">
                                        <Wrench className="w-3 h-3" />
                                        {msg.toolCalls.length} tool
                                        {msg.toolCalls.length > 1 ? "s" : ""} used
                                      </span>
                                    </AccordionTrigger>
                                    <AccordionContent>
                                      <div className="space-y-2">
                                        {msg.toolCalls.map((tc, idx) => (
                                          <div
                                            key={idx}
                                            className="bg-muted/50 rounded p-2 text-xs font-mono"
                                          >
                                            <div className="font-semibold text-primary mb-1">
                                              {tc.name}
                                            </div>
                                            <pre className="overflow-x-auto text-muted-foreground">
                                              {JSON.stringify(tc.arguments, null, 2)}
                                            </pre>
                                            {tc.result && (
                                              <>
                                                <div className="font-semibold text-accent mt-2 mb-1">
                                                  Result:
                                                </div>
                                                <pre className="overflow-x-auto text-muted-foreground">
                                                  {JSON.stringify(tc.result, null, 2)}
                                                </pre>
                                              </>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              )}
                            </div>
                          </div>
                        ))}

                        {isStreaming && (
                          <div className="flex justify-start" data-testid="message-streaming">
                            <div className="max-w-[80%] rounded-lg p-4 bg-card border">
                              {activeSkill && (
                                <div className="flex items-center gap-2 mb-3 text-xs">
                                  <Badge variant="secondary" className="text-xs">
                                    <Brain className="w-3 h-3 mr-1" />
                                    {activeSkill.label}
                                  </Badge>
                                </div>
                              )}
                              
                              {pendingToolCalls.length > 0 && (
                                <div className="mb-3 space-y-2">
                                  {pendingToolCalls.map((tc, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2"
                                    >
                                      <Wrench className="w-3 h-3" />
                                      <span>{tc.name}</span>
                                      {!tc.result ? (
                                        <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                                      ) : (
                                        <ChevronRight className="w-3 h-3 ml-auto text-accent" />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {streamingContent ? (
                                <p className="whitespace-pre-wrap text-sm">{streamingContent}</p>
                              ) : pendingToolCalls.length === 0 ? (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span className="text-sm text-muted-foreground">Thinking...</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                <div className="p-4 border-t border-border">
                  <div className="max-w-3xl mx-auto flex flex-col gap-1">
                    <div className="flex gap-3">
                      <Textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask me anything about your land investments..."
                        className="flex-1 min-h-[48px] max-h-32 resize-none"
                        disabled={isStreaming}
                        data-testid="input-message"
                      />
                      <Button
                        onClick={sendMessage}
                        disabled={!input.trim() || isStreaming}
                        data-testid="button-send-message"
                      >
                        {isStreaming ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    <span className="text-xs text-muted-foreground text-center" data-testid="text-cost-ai-chat">$0.02 per message</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mainTab === "team" && (
            <TeamTabContent />
          )}

          {mainTab === "tasks" && (
            <TasksTabContent />
          )}

          {mainTab === "agents" && (
            <AgentsTabContent />
          )}
        </div>
      </main>
    </div>
  );
}
