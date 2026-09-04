/**
 * Founder-only: the VA roster, the activity feed and the per-VA detail panel.
 *
 * Reads /api/va/agents, /api/va/actions and /api/va/briefings/latest; writes
 * through PATCH /api/va/agents/:id, the approve/reject action routes and
 * POST /api/va/agents/:type/task. Moved here 2026-09-04 from
 * client/src/pages/command-center.tsx (the CUSTOMER's /ai door) — see
 * ./index.ts for why. Behaviour is unchanged: command-center.tsx renders this
 * behind `mainTab === "team" && isFounder`, exactly as before.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Target,
  Calculator,
  Megaphone,
  Search,
  FileText,
  MessageSquare,
  Loader2,
  ChevronRight,
  Settings2,
  Zap,
  Clock,
  AlertCircle,
  DollarSign,
  Briefcase,
  Play,
  Check,
  X
} from "lucide-react";
import { relative } from "@/lib/format";
import { LowBalanceAlert } from "@/components/low-balance-alert";
import { Verbs } from "@/lib/labels";

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

// VA agents + actions render from /api/va/agents and /api/va/actions. When the
// backend returns nothing (no VAs provisioned yet for this org), the UI shows
// the canonical EmptyState — never invented "Acquisitions VA / Sales VA / Robert
// Chen / Maria Garcia" placeholder data. Founder-only surface, but truthfulness
// still applies: the founder should not see fake activity attributed to real-
// sounding customers, ever.

function getStatusColor(status: VAAction["status"]) {
  switch (status) {
    case "proposed": return "bg-acr-warn-soft text-acr-warn-soft-ink border border-acr-warn/30";
    case "approved": return "bg-acr-brand-soft text-acr-brand-soft-ink border border-acr-brand/30";
    case "completed": return "bg-acr-pos-soft text-acr-pos-soft-ink border border-acr-pos/30";
    case "rejected": return "bg-acr-neg-soft text-acr-neg-soft-ink border border-acr-neg/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function getAgentStatusColor(status: VAAgent["status"]) {
  switch (status) {
    case "active": return "bg-acr-pos";
    case "idle": return "bg-acr-warn";
    case "disabled": return "bg-acr-ink-4";
    default: return "bg-acr-ink-4";
  }
}

export function VaTeamPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  const { data: vaAgents = [], isLoading: vaAgentsLoading } = useQuery<VAAgent[]>({
    queryKey: ["/api/va/agents"],
    retry: false,
    staleTime: 30000,
  });

  const { data: vaActions = [], isLoading: vaActionsLoading } = useQuery<VAAction[]>({
    queryKey: ["/api/va/actions"],
    retry: false,
    staleTime: 30000,
  });

  const { data: briefing } = useQuery<DailyBriefing>({
    queryKey: ["/api/va/briefings/latest"],
    retry: false,
    staleTime: 60000,
  });

  const updateAgentMutation = useOptimisticUpdate<{ id: string; updates: Partial<VAAgent> }>({
    mutationFn: async ({ id, updates }) => {
      const res = await apiRequest("PATCH", `/api/va/agents/${id}`, updates);
      return res.json();
    },
    listKeys: [["/api/va/agents"]],
    getId: ({ id }) => id,
    buildPatch: ({ updates }) => updates as Record<string, unknown>,
    successToast: { title: "Agent updated", description: "Settings saved successfully" },
  });

  const approveActionMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await apiRequest("POST", `/api/va/actions/${actionId}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/actions"] });
      toast({ title: "Action approved", description: "The agent will proceed with this task." });
    },
    onError: () => {
      toast({ title: "Couldn't approve action", description: "The action is still pending. Try again.", variant: "destructive" });
    },
  });

  const rejectActionMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await apiRequest("POST", `/api/va/actions/${actionId}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/actions"] });
      toast({ title: "Action rejected", description: "The agent will not proceed with this task." });
    },
    onError: () => {
      toast({ title: "Couldn't reject action", description: "The action is still pending. Try again.", variant: "destructive" });
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
      toast({ title: "Task assigned", description: "The agent will work on this task." });
    },
    onError: () => {
      toast({ title: "Couldn't assign task", description: "Your draft is preserved. Try again.", variant: "destructive" });
    },
  });

  const generateBriefingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/va/briefings/generate", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/va/briefings/latest"] });
      toast({ title: "Briefing generated", description: "Your daily briefing is ready." });
    },
    onError: () => {
      toast({ title: "Couldn't generate briefing", description: "Try again or check the system status.", variant: "destructive" });
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
      <LowBalanceAlert />
      <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          onClick={() => generateBriefingMutation.mutate()}
          disabled={generateBriefingMutation.isPending}
          data-testid="button-generate-briefing"
        >
          {generateBriefingMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate Daily Briefing
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Roster column: full-width on mobile (shown when no agent selected),
            fixed 18rem on md+. The middle activity feed and detail panel are
            hidden on mobile — they display md+. */}
        <div className={`${selectedAgentId ? "hidden md:flex" : "flex"} w-full md:w-72 border-r border-border flex-col overflow-hidden`}>
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-muted-foreground">Agent Roster</h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2" data-testid="list-va-agents">
              {vaAgentsLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-card" />
                ))
              ) : vaAgents.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  headline="No VA agents yet"
                  subtitle="Once you provision an agent role (Acquisitions, Sales, Research, etc.), it'll appear here with live status and pending actions."
                  // TODO(cta): VA provisioning is a Phase 1+ feature — there's no
                  // self-serve "create VA" action yet. When it ships, swap to a real CTA.
                  cta={{ label: "", _noOp: true }}
                  testId="empty-va-agents"
                />
              ) : (
                vaAgents.map((agent) => {
                  const IconComponent = getAgentIcon(agent.type);
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`p-3 rounded-card cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary"
                          : "hover-elevate"
                      }`}
                      data-testid={`card-va-agent-${agent.type}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-card ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-sm truncate min-w-0">{agent.name}</span>
                            <div className={`w-2 h-2 rounded-full shrink-0 ${getAgentStatusColor(agent.status)}`} />
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {agent.description}
                          </p>
                          <div className="flex items-center justify-between gap-2 mt-2">
                            {agent.pendingActions > 0 ? (
                              <Badge variant="secondary" className="text-xs min-w-0 truncate">
                                {agent.pendingActions} pending
                              </Badge>
                            ) : (
                              <span />
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

        {/* Activity feed: hidden on mobile, shown on md+ */}
        <div className="hidden md:flex flex-1 flex-col overflow-hidden">
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
                            <Check className="w-3 h-3 text-acr-pos" aria-hidden="true" /> {h}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Generated {relative(briefing.generatedAt)}
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
                  <Skeleton key={i} className="h-24 w-full rounded-card" />
                ))
              ) : filteredActions.length === 0 ? (
                <EmptyState
                  icon={AlertCircle}
                  headline={vaActions.length === 0 ? "No agent activity yet" : "No actions match these filters"}
                  subtitle={
                    vaActions.length === 0
                      ? "When your VA agents propose actions — outreach, due diligence, follow-ups — they'll queue here for your approval."
                      : "Try clearing the agent or status filter to see all activity."
                  }
                  // TODO(cta): activity feed is observe-only — there's no "create action"
                  // affordance; actions originate from VA agents. Filter-reset is the only
                  // meaningful CTA and it's already on-screen via the Select dropdowns.
                  cta={{ label: "", _noOp: true }}
                  testId="empty-va-actions"
                />
              ) : (
                filteredActions.map((action) => {
                  const IconComponent = getAgentIcon(action.agentType);
                  return (
                    <Card key={action.id} className="overflow-visible" data-testid={`card-va-action-${action.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-card bg-muted">
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
                                {relative(action.createdAt)}
                              </span>
                              <span className="text-xs text-muted-foreground">{action.agentName}</span>
                            </div>
                          </div>
                          {action.status === "proposed" && (
                            <div className="flex items-center gap-2">
                              <Button aria-label="Reject action"
                                size="sm"
                                variant="outline"
                                onClick={() => rejectActionMutation.mutate(action.id)}
                                disabled={rejectActionMutation.isPending}
                                data-testid={`button-reject-va-action-${action.id}`}
                              >
                                <X className="w-4 h-4" aria-hidden="true" />
                              </Button>
                              <Button aria-label="Approve action"
                                size="sm"
                                onClick={() => approveActionMutation.mutate(action.id)}
                                disabled={approveActionMutation.isPending}
                                data-testid={`button-approve-va-action-${action.id}`}
                              >
                                <Check className="w-4 h-4" aria-hidden="true" />
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

        {/* Detail panel: full-width on mobile (shown when agent selected),
            fixed 20rem on md+. Back affordance lets mobile users return
            to the roster without redesigning the panel layout. */}
        <div className={`${selectedAgentId ? "flex" : "hidden md:flex"} w-full md:w-80 border-l border-border flex-col overflow-hidden`}>
          {!selectedAgent ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Settings2 className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm">Select an agent to view details and settings</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border">
                {/* Back button: only visible on mobile, returns to roster */}
                <button
                  type="button"
                  className="md:hidden flex items-center gap-1 text-xs text-muted-foreground mb-3 active:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedAgentId(null)}
                  aria-label="Back to agent roster"
                >
                  <ChevronRight className="w-3 h-3 rotate-180" aria-hidden="true" />
                  All agents
                </button>
                <div className="flex items-center gap-3">
                  {(() => {
                    const IconComponent = getAgentIcon(selectedAgent.type);
                    return (
                      <div className="p-3 rounded-card bg-primary text-primary-foreground shrink-0">
                        <IconComponent className="w-5 h-5" />
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate" data-testid="text-selected-va-agent-name">{selectedAgent.name}</h3>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${getAgentStatusColor(selectedAgent.status)}`} />
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
                          aria-label="Custom instructions for this agent"
                          placeholder="Add custom instructions for this agent…"
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
                          aria-label="Describe the task for this agent"
                          placeholder="E.g., Send follow-up emails to all leads who haven't responded in 7 days…"
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
                            {Verbs.CANCEL}
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
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
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
                            className="p-3 rounded-card bg-muted/50"
                            data-testid={`card-va-agent-action-${action.id}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium truncate">{action.title}</span>
                              <Badge className={`text-xs shrink-0 ${getStatusColor(action.status)}`}>
                                {action.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {relative(action.createdAt)}
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
