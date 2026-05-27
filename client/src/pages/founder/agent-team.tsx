/**
 * /founder/agent-team — Sovereign Company Protocol (extracted from
 * founder-dashboard.tsx).
 *
 * Two panels that always read together on the agents tab:
 *   1. CompanyBriefingPanel — "Good morning, Thomas. Here's your company."
 *   2. AgentTeamPanel — 10-agent grid with trust + chat + goal assignment
 *
 * Pure move; no behavior change. Preserves the existing query keys
 * (/api/founder/intelligence/company-briefing, /api/founder/intelligence/
 * company-agents, /api/founder/intelligence/decisions-inbox) and mutation
 * paths (decisions-inbox approve/reject, company-agents status patch,
 * agent-chat, agent-goals).
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bot,
  Heart,
  DollarSign,
  Megaphone,
  Server,
  BarChart3,
  ShieldAlert,
  BrainCircuit,
  Navigation,
  ScrollText,
  Cpu,
  Users2,
  MessageSquare,
  Target,
  Play,
  Pause,
  RefreshCw,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { relative } from "@/lib/format";
import { trustLabel, trustBadgeColor } from "@/lib/trust-language";
import { agentTextClass } from "@/lib/agent-identity";

// ─────────────────────────────────────────────────────────────────────
// Shared agent identity tables
// ─────────────────────────────────────────────────────────────────────

const AGENT_ICONS: Record<string, React.ElementType> = {
  atlas_cto: Cpu,
  sophie_csm: Heart,
  forge_revenue: DollarSign,
  beacon_marketing: Megaphone,
  sentinel_devops: Server,
  ledger_finance: BarChart3,
  shield_legal: ShieldAlert,
  oracle_analytics: BrainCircuit,
  compass_pm: Navigation,
  crucible_qa: ScrollText,
};

// Per-agent text color sourced from the consolidated identity registry
// — see client/src/lib/agent-identity.ts (agentTextClass). Direct lookup
// kept as a Record so existing call-sites (`AGENT_COLORS[codename]`) keep
// working without further refactoring.
const AGENT_COLORS: Record<string, string> = new Proxy({}, {
  get: (_, codename: string) => agentTextClass(codename),
}) as Record<string, string>;

const WING_BADGES: Record<string, { label: string; className: string }> = {
  product: { label: "Product", className: "bg-acr-accent/10 text-acr-accent dark:text-acr-accent border-acr-accent/20" },
  growth: { label: "Growth", className: "bg-acr-pos/10 text-acr-pos dark:text-acr-pos border-acr-pos/20" },
  ops: { label: "Ops", className: "bg-muted/10 text-foreground dark:text-muted-foreground border-border/20" },
};

const MOOD_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: "bg-acr-pos/5", border: "border-acr-pos/20", text: "text-acr-pos dark:text-acr-pos", dot: "bg-acr-pos" },
  yellow: { bg: "bg-acr-warn/5", border: "border-acr-warn/20", text: "text-acr-warn dark:text-acr-warn", dot: "bg-acr-warn" },
  red: { bg: "bg-acr-neg/5", border: "border-acr-neg/20", text: "text-acr-neg dark:text-acr-neg", dot: "bg-acr-neg" },
};

// ─────────────────────────────────────────────────────────────────────
// CompanyBriefingPanel
// ─────────────────────────────────────────────────────────────────────

export function CompanyBriefingPanel() {
  const { user: authUser } = useAuth();
  const founderName = authUser?.firstName || "Founder";

  const { data: briefing, isLoading, refetch } = useQuery({
    queryKey: ["/api/founder/intelligence/company-briefing"],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/founder/intelligence/company-briefing", {});
      return res.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchInterval: 60 * 60 * 1000, // refresh every hour
  });

  // Optimistic approve/reject on decisions-inbox — the card should reflect
  // its new state instantly. Rollback restores prior status on server error.
  const approveMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: async ({ id }) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/decisions-inbox/${id}`, {
        action: "approve",
      });
      return res.json();
    },
    listKeys: [["/api/founder/intelligence/decisions-inbox"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "approved" }),
    successToast: { title: "Decision approved" },
  });

  const rejectMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: async ({ id }) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/decisions-inbox/${id}`, {
        action: "reject",
      });
      return res.json();
    },
    listKeys: [["/api/founder/intelligence/decisions-inbox"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "rejected" }),
    successToast: { title: "Decision rejected" },
  });

  if (isLoading) {
    return (
      <Card className="border-2">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!briefing) return null;

  const mood = MOOD_STYLES[briefing.mood] || MOOD_STYLES.green;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className={`rounded-xl border-2 ${mood.border} ${mood.bg} p-6 space-y-6`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {greeting}, {founderName}. Here's your company.
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Generated {briefing.generatedAt ? relative(briefing.generatedAt) : "just now"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${mood.bg} border ${mood.border}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${mood.dot} animate-pulse`} />
            <span className={`text-sm font-bold ${mood.text}`}>
              Company Health: {briefing.healthScore >= 80 ? "Excellent" : briefing.healthScore >= 60 ? "Good" : briefing.healthScore >= 40 ? "Needs attention" : "Critical"}
            </span>
          </div>
          <Button aria-label="Refresh" size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Overnight Activity */}
      {briefing.agentReports && briefing.agentReports.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Overnight, your team:
          </h3>
          <div className="space-y-2">
            {briefing.agentReports.map((report: any) => {
              const Icon = AGENT_ICONS[report.codename] || Bot;
              const color = AGENT_COLORS[report.codename] || "text-muted-foreground";

              return (
                <div key={report.codename} className="flex items-start gap-3 p-2 rounded-card hover:bg-background/50 transition-colors">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0">
                    <span className={`font-semibold text-sm ${color}`}>{report.codename.split("_")[0].charAt(0).toUpperCase() + report.codename.split("_")[0].slice(1)}</span>
                    <span className="text-sm text-foreground ml-1">{report.summary}</span>
                  </div>
                  {report.alerts && report.alerts.length > 0 && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {report.alerts.length} alert{report.alerts.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Decisions */}
      {briefing.decisionsNeeded && briefing.decisionsNeeded.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            You have {briefing.decisionsNeeded.length} decision{briefing.decisionsNeeded.length > 1 ? "s" : ""} pending:
          </h3>
          <div className="space-y-3">
            {briefing.decisionsNeeded.map((decision: any) => {
              const urgencyColors: Record<string, string> = {
                critical: "border-acr-neg/30 bg-acr-neg/5",
                high: "border-acr-warn/30 bg-acr-warn/5",
                medium: "border-acr-accent/30 bg-acr-accent/5",
                low: "border-acr-pos/30 bg-acr-pos/5",
              };

              const urgencyDot: Record<string, string> = {
                critical: "bg-acr-neg",
                high: "bg-acr-warn",
                medium: "bg-acr-accent",
                low: "bg-acr-pos",
              };

              const fromAgent = decision.fromAgent?.split("_")[0] || "unknown";
              const agentLabel = fromAgent.charAt(0).toUpperCase() + fromAgent.slice(1);

              return (
                <div key={decision.id} className={`p-4 rounded-card border ${urgencyColors[decision.urgency] || urgencyColors.medium}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${urgencyDot[decision.urgency] || urgencyDot.medium}`} />
                      <div>
                        <span className="text-sm">
                          <span className="font-semibold">{agentLabel}</span>
                          {" "}{decision.title || decision.context}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-acr-pos/30 text-acr-pos hover:bg-acr-pos/10"
                        onClick={() => approveMutation.mutate({ id: decision.id })}
                        disabled={approveMutation.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-acr-neg/30 text-acr-neg hover:bg-acr-neg/10"
                        onClick={() => rejectMutation.mutate({ id: decision.id })}
                        disabled={rejectMutation.isPending}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All Clear */}
      {(!briefing.decisionsNeeded || briefing.decisionsNeeded.length === 0) && (
        <div className="flex items-center gap-2 text-sm font-medium text-acr-pos">
          <CheckCircle2 className="w-4 h-4" />
          No escalations. Your company is running.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AgentTeamPanel — Sovereign Company Protocol
// Grid of all 10 AI agents with trust scores, status, and chat.
// ─────────────────────────────────────────────────────────────────────

export function AgentTeamPanel() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgent, setChatAgent] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string; agent?: string }[]>([]);
  const [chatConvId, setChatConvId] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalAgent, setGoalAgent] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [goalPriority, setGoalPriority] = useState("medium");
  const [chatPending, setChatPending] = useState(false);

  const { data: agents, isLoading, refetch } = useQuery({
    queryKey: ["/api/founder/intelligence/company-agents"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/founder/intelligence/company-agents");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ codename, status }: { codename: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/company-agents/${codename}/status`, { status });
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: `Agent ${vars.status === "paused" ? "paused" : "resumed"}` });
      refetch();
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    const userMsg = chatMessage;
    setChatMessage("");
    setChatHistory(prev => [...prev, { role: "user", content: userMsg }]);
    setChatPending(true);

    try {
      const res = await apiRequest("POST", "/api/founder/intelligence/agent-chat", {
        message: userMsg,
        targetAgent: chatAgent,
        conversationId: chatConvId,
      });
      const data = await res.json();
      if (data.conversationId && !chatConvId) setChatConvId(data.conversationId);
      setChatHistory(prev => [...prev, {
        role: "assistant",
        content: data.response + (data.dataUsed ? "" : ""),
        agent: data.agentTitle,
      }]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't process that request." }]);
    } finally {
      setChatPending(false);
    }
  };

  const sendGoal = async () => {
    if (!goalAgent || !goalText.trim()) return;
    try {
      await apiRequest("POST", "/api/founder/intelligence/agent-goals", {
        assignedAgent: goalAgent,
        goal: goalText,
        priority: goalPriority,
      });
      toast({ title: "Goal assigned", description: `${goalAgent} has received a new goal.` });
      setGoalOpen(false);
      setGoalText("");
    } catch {
      toast({ title: "Couldn't assign goal", description: "The agent has not received a new goal. Try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const agentList = agents || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users2 className="w-5 h-5 text-acr-accent" />
            Your AI Team
          </h2>
          <p className="text-sm text-muted-foreground">10 agent personas coordinating {">"}166 services</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setChatAgent(null); setChatOpen(true); setChatHistory([]); }}>
          <MessageSquare className="w-4 h-4 mr-1.5" />
          Talk to your company
        </Button>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {agentList.map((agent: any) => {
          const Icon = AGENT_ICONS[agent.codename] || Bot;
          const color = AGENT_COLORS[agent.codename] || "text-muted-foreground";
          const wing = WING_BADGES[agent.wing] || WING_BADGES.ops;
          const isPaused = agent.status === "paused";
          const trustPct = agent.trustScore || 50;

          return (
            <Card key={agent.codename} className={`relative overflow-hidden cursor-pointer hover:border-primary/30 transition-colors ${isPaused ? "opacity-60" : ""}`}
              onClick={() => navigate(`/founder/agents/${agent.codename}`)}>
              <CardContent className="p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-5 h-5 ${color}`} />
                    <div>
                      <div className="text-sm font-semibold leading-tight">
                        {agent.codename.split("_")[0].charAt(0).toUpperCase() + agent.codename.split("_")[0].slice(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">{agent.title}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-micro px-1.5 py-0 ${wing.className}`}>
                    {wing.label}
                  </Badge>
                </div>

                {/* Trust Score */}
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Trust</span>
                    <span className={`font-medium ${trustBadgeColor(trustPct)} px-1.5 py-0.5 rounded-full text-micro`}>{trustLabel(trustPct)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        trustPct >= 75 ? "bg-acr-pos" : trustPct >= 50 ? "bg-acr-warn" : "bg-acr-neg"
                      }`}
                      style={{ width: `${trustPct}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs flex-1"
                    onClick={() => { setChatAgent(agent.codename); setChatOpen(true); setChatHistory([]); setChatConvId(null); }}
                  >
                    <MessageSquare className="w-3 h-3 mr-1" />
                    Chat
                  </Button>
                  <Button aria-label="Target"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-acr-accent"
                    onClick={() => { setGoalAgent(agent.codename); setGoalOpen(true); }}
                  >
                    <Target className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`h-7 text-xs ${isPaused ? "text-acr-pos" : "text-acr-warn"}`}
                    onClick={() => statusMutation.mutate({
                      codename: agent.codename,
                      status: isPaused ? "active" : "paused",
                    })}
                    disabled={statusMutation.isPending}
                  >
                    {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  </Button>
                </div>

                {/* Status indicator */}
                <div className="absolute top-2 right-2">
                  <div className={`w-2 h-2 rounded-full ${isPaused ? "bg-acr-warn" : "bg-acr-pos animate-pulse"}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Goal Delegation Dialog */}
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              Assign Goal to {goalAgent?.split("_")[0]}
            </DialogTitle>
            <DialogDescription>
              Describe what you want this agent to accomplish.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="e.g. Increase trial-to-paid conversion by 15% this quarter"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              rows={3}
            />
            <Select value={goalPriority} onValueChange={setGoalPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low Priority</SelectItem>
                <SelectItem value="medium">Medium Priority</SelectItem>
                <SelectItem value="high">High Priority</SelectItem>
                <SelectItem value="critical">Critical Priority</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGoalOpen(false)}>Cancel</Button>
            <Button onClick={sendGoal} disabled={!goalText.trim()}>Assign Goal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent Chat Dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {chatAgent
                ? `Talk to ${chatAgent.split("_")[0].charAt(0).toUpperCase() + chatAgent.split("_")[0].slice(1)}`
                : "Talk to your company"}
            </DialogTitle>
            <DialogDescription>
              {chatAgent
                ? "Ask this agent about their domain."
                : "Address any agent by name, or ask a general question. Try: \"Forge, what's our MRR trend?\""}
            </DialogDescription>
          </DialogHeader>

          {/* Chat History */}
          <div className="max-h-[400px] overflow-y-auto space-y-3 p-3 bg-muted/30 rounded-card">
            {chatHistory.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Start a conversation with your AI team.
              </p>
            )}
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border"
                }`}>
                  {msg.agent && (
                    <div className="text-xs font-semibold text-muted-foreground mb-1">{msg.agent}</div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {chatPending && (
              <div className="flex justify-start">
                <div className="bg-card border rounded-card px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <div className="flex items-center gap-2">
            <Input
              placeholder={chatAgent ? `Ask ${chatAgent.split("_")[0]}...` : "Type your message..."}
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              disabled={chatPending}
            />
            <Button aria-label="Send" onClick={sendChat} disabled={chatPending || !chatMessage.trim()} size="sm">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Default-exported route page
// ─────────────────────────────────────────────────────────────────────

export default function FounderAgentTeamPage() {
  useDocumentTitle("Agent team — AcreOS");

  return (
    <PageShell label="Agent team">
      <div className="mb-6 flex items-start gap-3">
        <Users2 className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent team</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Sovereign Company Protocol — your AI team's daily briefing, pending
            decisions, and the 10-agent operations grid with trust scores, chat,
            and goal delegation.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <CompanyBriefingPanel />
        <AgentTeamPanel />
      </div>
    </PageShell>
  );
}
