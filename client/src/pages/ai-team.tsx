import { useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase,
  MessageSquare,
  Target,
  Megaphone,
  DollarSign,
  Search,
  Loader2,
  Check,
  X,
  Clock,
  AlertCircle,
  Play,
  Zap,
  Settings2,
  FileText,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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

const agentIcons: Record<string, typeof Briefcase> = {
  executive: Briefcase,
  sales: MessageSquare,
  acquisitions: Target,
  marketing: Megaphone,
  collections: DollarSign,
  research: Search,
};

const defaultAgents: VAAgent[] = [
  { id: "1", type: "executive", name: "Executive VA", description: "Oversees all operations and provides strategic insights", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 3 },
  { id: "2", type: "sales", name: "Sales VA", description: "Handles buyer communications and follow-ups", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 5 },
  { id: "3", type: "acquisitions", name: "Acquisitions VA", description: "Manages seller outreach and deal negotiation", status: "idle", enabled: true, autonomyLevel: "manual", pendingActions: 2 },
  { id: "4", type: "marketing", name: "Marketing VA", description: "Creates campaigns and marketing content", status: "idle", enabled: true, autonomyLevel: "full_auto", pendingActions: 0 },
  { id: "5", type: "collections", name: "Collections VA", description: "Manages payment reminders and note servicing", status: "disabled", enabled: false, autonomyLevel: "manual", pendingActions: 0 },
  { id: "6", type: "research", name: "Research VA", description: "Performs due diligence and market research", status: "active", enabled: true, autonomyLevel: "supervised", pendingActions: 1 },
];

const defaultActions: VAAction[] = [
  { id: "1", agentType: "sales", agentName: "Sales VA", title: "Send follow-up email to Robert Chen", description: "Buyer showed interest in 10-acre parcels, proposing a personalized property list", status: "proposed", createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: "2", agentType: "acquisitions", agentName: "Acquisitions VA", title: "Generate offer letter for Maria Garcia", description: "Seller responded to mailer, ready to send $4,500 offer", status: "proposed", createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
  { id: "3", agentType: "research", agentName: "Research VA", title: "Due diligence completed for APN 456-78-901", description: "Title clear, no liens, road access verified", status: "completed", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
  { id: "4", agentType: "marketing", agentName: "Marketing VA", title: "Created Facebook ad campaign", description: "Targeting AZ land buyers, budget $50/day", status: "approved", createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() },
  { id: "5", agentType: "executive", agentName: "Executive VA", title: "Weekly performance report generated", description: "Summarized 12 deals in pipeline, 3 closings expected", status: "completed", createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString() },
  { id: "6", agentType: "sales", agentName: "Sales VA", title: "Rejected SMS campaign to cold leads", description: "User declined bulk SMS to unresponsive leads", status: "rejected", createdAt: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString() },
];

function getAgentIcon(type: string) {
  return agentIcons[type] || Briefcase;
}

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

export default function AITeamPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [mobileTab, setMobileTab] = useState<string>("agents");

  const { data: agents = defaultAgents, isLoading: agentsLoading } = useQuery<VAAgent[]>({
    queryKey: ["/api/va/agents"],
    retry: false,
    staleTime: 30000,
  });

  const { data: actions = defaultActions, isLoading: actionsLoading } = useQuery<VAAction[]>({
    queryKey: ["/api/va/actions"],
    retry: false,
    staleTime: 30000,
  });

  const { data: briefing, isLoading: briefingLoading } = useQuery<DailyBriefing>({
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

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const filteredActions = actions.filter((action) => {
    if (agentFilter !== "all" && action.agentType !== agentFilter) return false;
    if (statusFilter !== "all" && action.status !== statusFilter) return false;
    return true;
  });

  const agentActions = selectedAgent
    ? actions.filter((a) => a.agentType === selectedAgent.type)
    : [];

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] h-screen flex flex-col overflow-hidden pb-24 md:pb-0">
        <div className="p-6 border-b border-border">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Team</h1>
              <p className="text-muted-foreground text-sm">Manage your virtual assistants and review their actions</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
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
          </div>
        </div>

        {/* Mobile Tabbed Layout */}
        <div className="flex-1 flex flex-col overflow-hidden md:hidden pb-24">
          <Tabs value={mobileTab} onValueChange={setMobileTab} className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 pt-2">
              <TabsList className="w-full" data-testid="mobile-tabs">
                <TabsTrigger value="agents" className="flex-1" data-testid="tab-agents">Agents</TabsTrigger>
                <TabsTrigger value="activity" className="flex-1" data-testid="tab-activity">Activity</TabsTrigger>
                <TabsTrigger value="details" className="flex-1" data-testid="tab-details">Details</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="agents" className="flex-1 overflow-hidden mt-0">
              <ScrollArea className="h-full">
                <div className="p-3 space-y-2" data-testid="list-agents-mobile">
                  {agentsLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full rounded-lg" />
                    ))
                  ) : (
                    agents.map((agent) => {
                      const IconComponent = getAgentIcon(agent.type);
                      const isSelected = selectedAgentId === agent.id;
                      return (
                        <div
                          key={agent.id}
                          onClick={() => {
                            setSelectedAgentId(agent.id);
                            setMobileTab("details");
                          }}
                          className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-primary/10 ring-1 ring-primary"
                              : "hover-elevate"
                          }`}
                          data-testid={`card-agent-mobile-${agent.type}`}
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
                                  data-testid={`switch-agent-enabled-mobile-${agent.type}`}
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
            </TabsContent>

            <TabsContent value="activity" className="flex-1 overflow-hidden mt-0 flex flex-col">
              {briefing && (
                <Card className="mx-4 mt-2 border-primary/20 bg-primary/5">
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
                  <SelectTrigger className="w-32" data-testid="select-agent-filter-mobile">
                    <SelectValue placeholder="Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Agents</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.type} value={agent.type}>{agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-32" data-testid="select-status-filter-mobile">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="proposed">Proposed</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-3" data-testid="list-actions-mobile">
                  {actionsLoading ? (
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
                        <Card key={action.id} className="overflow-visible" data-testid={`card-action-mobile-${action.id}`}>
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
                                    data-testid={`button-reject-action-mobile-${action.id}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => approveActionMutation.mutate(action.id)}
                                    disabled={approveActionMutation.isPending}
                                    data-testid={`button-approve-action-mobile-${action.id}`}
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
            </TabsContent>

            <TabsContent value="details" className="flex-1 overflow-hidden mt-0">
              {!selectedAgent ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full">
                  <Settings2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground text-sm">Select an agent to view details and settings</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
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
                        <h3 className="font-semibold" data-testid="text-selected-agent-name-mobile">{selectedAgent.name}</h3>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${getAgentStatusColor(selectedAgent.status)}`} />
                          <span className="text-xs text-muted-foreground capitalize">{selectedAgent.status}</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">{selectedAgent.description}</p>
                  </div>
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
                            data-testid="switch-agent-enabled-detail-mobile"
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
                            <SelectTrigger data-testid="select-autonomy-level-mobile">
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
                            data-testid="textarea-custom-instructions-mobile"
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
                            data-testid="button-save-instructions-mobile"
                          >
                            Save Instructions
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
                        <DialogTrigger asChild>
                          <Button className="w-full" data-testid="button-assign-task-mobile">
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
                            data-testid="textarea-task-input-mobile"
                          />
                          <DialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setTaskDialogOpen(false)}
                              data-testid="button-cancel-task-mobile"
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
                              data-testid="button-submit-task-mobile"
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
                              data-testid={`card-agent-action-mobile-${action.id}`}
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
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Desktop 3-Panel Layout */}
        <div className="flex-1 hidden md:flex overflow-hidden">
          <div className="w-72 border-r border-border vibrancy-sidebar flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-muted-foreground">Agent Roster</h2>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2" data-testid="list-agents">
                {agentsLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                  ))
                ) : (
                  agents.map((agent) => {
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
                        data-testid={`card-agent-${agent.type}`}
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
                                data-testid={`switch-agent-enabled-${agent.type}`}
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
                <SelectTrigger className="w-40" data-testid="select-agent-filter">
                  <SelectValue placeholder="Filter by agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.type} value={agent.type}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
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
              <div className="p-4 space-y-3" data-testid="list-actions">
                {actionsLoading ? (
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
                      <Card key={action.id} className="overflow-visible" data-testid={`card-action-${action.id}`}>
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
                                  data-testid={`button-reject-action-${action.id}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => approveActionMutation.mutate(action.id)}
                                  disabled={approveActionMutation.isPending}
                                  data-testid={`button-approve-action-${action.id}`}
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

          <div className="w-80 border-l border-border vibrancy-sidebar flex flex-col overflow-hidden">
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
                      <h3 className="font-semibold" data-testid="text-selected-agent-name">{selectedAgent.name}</h3>
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
                            data-testid="switch-agent-enabled-detail"
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
                            <SelectTrigger data-testid="select-autonomy-level">
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
                            data-testid="textarea-custom-instructions"
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
                            data-testid="button-save-instructions"
                          >
                            Save Instructions
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
                        <DialogTrigger asChild>
                          <Button className="w-full" data-testid="button-assign-task">
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
                            data-testid="textarea-task-input"
                          />
                          <DialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setTaskDialogOpen(false)}
                              data-testid="button-cancel-task"
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
                              data-testid="button-submit-task"
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
                              data-testid={`card-agent-action-${action.id}`}
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
      </main>
    </div>
  );
}
