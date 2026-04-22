import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MessageSquare, Users, Send, UserCheck, ArrowRight,
  Vote, AlertTriangle, CheckCircle, Clock, Crown,
  Bot, XCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { relative } from "@/lib/format";
import { useWebSocketChannel } from "@/hooks/use-websocket-channel";

const AGENT_CODENAMES = [
  "ceo", "cfo", "coo", "vp-sales", "vp-marketing",
  "vp-acquisitions", "vp-engineering", "legal-counsel",
  "data-scientist", "customer-success",
];

function useAgentMessages(limit: number = 50) {
  return useQuery({
    queryKey: ["/api/founder/agent-collaboration/messages", limit],
    queryFn: async () => {
      const res = await fetch(`/api/founder/agent-collaboration/messages?limit=${limit}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

function MessageBubble({ message }: { message: any }) {
  const isFounder = message.fromAgent === "founder";
  const isDelegation = message.messageType === "delegation";
  const isConsensus = message.messageType === "consensus_request";

  return (
    <div className={`flex ${isFounder ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[75%] rounded-lg p-3 ${
        isFounder
          ? "bg-primary text-primary-foreground"
          : isDelegation
          ? "bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
          : isConsensus
          ? "bg-purple-50 border border-purple-200 dark:bg-purple-950 dark:border-purple-800"
          : "bg-muted"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          {isFounder ? (
            <Crown className="w-3 h-3" />
          ) : (
            <Bot className="w-3 h-3" />
          )}
          <span className="text-xs font-medium">
            {message.fromAgent ?? "Unknown"} → {message.toAgent ?? "all"}
          </span>
          {isDelegation && <Badge variant="outline" className="text-xs py-0">delegation</Badge>}
          {isConsensus && <Badge variant="outline" className="text-xs py-0">consensus</Badge>}
        </div>
        <p className="text-sm">{message.subject ?? ""}</p>
        {message.content && typeof message.content === "string" && (
          <p className="text-xs opacity-80 mt-1">
            {(() => {
              try { return JSON.parse(message.content)?.task ?? message.content; }
              catch { return message.content; }
            })()}
          </p>
        )}
        <p className="text-xs opacity-60 mt-1">
          {message.createdAt && relative(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

export default function AgentCollaboration() {
  const { data: messages = [], isLoading } = useAgentMessages();
  const queryClient = useQueryClient();

  // Delegation form
  const [delegateAgent, setDelegateAgent] = useState("");
  const [delegateTask, setDelegateTask] = useState("");
  const [delegateContext, setDelegateContext] = useState("");

  // Override form
  const [overrideAgent, setOverrideAgent] = useState("");
  const [overrideAction, setOverrideAction] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  // Consensus form
  const [consensusTopic, setConsensusTopic] = useState("");
  const [consensusParticipants, setConsensusParticipants] = useState<string[]>([]);

  // Real-time updates
  useWebSocketChannel("founder:activity", (event) => {
    if (event.type?.startsWith("agent:")) {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/agent-collaboration/messages"] });
    }
  });

  const delegateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/agent-collaboration/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAgent: "founder",
          toAgent: delegateAgent,
          task: delegateTask,
          context: delegateContext ? { notes: delegateContext } : {},
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delegate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/agent-collaboration/messages"] });
      setDelegateAgent("");
      setDelegateTask("");
      setDelegateContext("");
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/agent-collaboration/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentCodename: overrideAgent,
          overrideAction,
          reason: overrideReason,
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to override");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/agent-collaboration/messages"] });
      setOverrideAgent("");
      setOverrideAction("");
      setOverrideReason("");
    },
  });

  const consensusMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/founder/agent-collaboration/consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: consensusTopic,
          participants: consensusParticipants,
          options: ["approve", "reject", "abstain"],
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to start consensus");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/agent-collaboration/messages"] });
      setConsensusTopic("");
      setConsensusParticipants([]);
    },
  });

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Agent Collaboration
          </h1>
          <p className="text-sm text-muted-foreground">
            Inter-agent messaging, task delegation, founder overrides, and consensus voting
          </p>
        </div>

        <Tabs defaultValue="messages">
          <TabsList>
            <TabsTrigger value="messages">
              <MessageSquare className="w-3.5 h-3.5 mr-1" /> Messages
            </TabsTrigger>
            <TabsTrigger value="delegate">
              <ArrowRight className="w-3.5 h-3.5 mr-1" /> Delegate
            </TabsTrigger>
            <TabsTrigger value="override">
              <Crown className="w-3.5 h-3.5 mr-1" /> Override
            </TabsTrigger>
            <TabsTrigger value="consensus">
              <Vote className="w-3.5 h-3.5 mr-1" /> Consensus
            </TabsTrigger>
          </TabsList>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between">
                  Agent Conversation Thread
                  <Badge variant="secondary">{Array.isArray(messages) ? messages.length : 0} messages</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-y-auto space-y-1 p-2">
                  {Array.isArray(messages) && messages.length > 0 ? (
                    [...messages].reverse().map((msg: any, i: number) => (
                      <MessageBubble key={msg.id ?? i} message={msg} />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-12">
                      No inter-agent messages yet. Use the Delegate tab to assign a task to an agent.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Delegate Tab */}
          <TabsContent value="delegate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Delegate Task to Agent</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Agent</label>
                  <Select value={delegateAgent} onValueChange={setDelegateAgent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent..." />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_CODENAMES.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Task</label>
                  <Input
                    placeholder="Describe the task..."
                    value={delegateTask}
                    onChange={(e) => setDelegateTask(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Context (optional)</label>
                  <Textarea
                    placeholder="Additional context or instructions..."
                    value={delegateContext}
                    onChange={(e) => setDelegateContext(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  onClick={() => delegateMutation.mutate()}
                  disabled={!delegateAgent || !delegateTask || delegateMutation.isPending}
                >
                  <Send className="w-3.5 h-3.5 mr-2" />
                  {delegateMutation.isPending ? "Delegating..." : "Delegate Task"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Override Tab */}
          <TabsContent value="override" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Founder Override — CEO Authority</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Override an agent's decision. The feedback will be logged and used to train future decisions (v14 feedback loop).
                </p>
                <div>
                  <label className="text-sm font-medium mb-1 block">Agent</label>
                  <Select value={overrideAgent} onValueChange={setOverrideAgent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent..." />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_CODENAMES.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Override Action</label>
                  <Input
                    placeholder="What should the agent do instead?"
                    value={overrideAction}
                    onChange={(e) => setOverrideAction(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Reason</label>
                  <Textarea
                    placeholder="Why are you overriding this decision?"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={() => overrideMutation.mutate()}
                  disabled={!overrideAgent || !overrideAction || overrideMutation.isPending}
                >
                  <Crown className="w-3.5 h-3.5 mr-2" />
                  {overrideMutation.isPending ? "Overriding..." : "Execute Override"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Consensus Tab */}
          <TabsContent value="consensus" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Start Consensus Vote</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Start a multi-agent vote on a strategic decision. Each selected agent will receive a ballot.
                </p>
                <div>
                  <label className="text-sm font-medium mb-1 block">Topic</label>
                  <Input
                    placeholder="What should the team decide?"
                    value={consensusTopic}
                    onChange={(e) => setConsensusTopic(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Participants</label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_CODENAMES.map((name) => (
                      <Button
                        key={name}
                        variant={consensusParticipants.includes(name) ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setConsensusParticipants((prev) =>
                            prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                          );
                        }}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  onClick={() => consensusMutation.mutate()}
                  disabled={!consensusTopic || consensusParticipants.length < 2 || consensusMutation.isPending}
                >
                  <Vote className="w-3.5 h-3.5 mr-2" />
                  {consensusMutation.isPending ? "Starting vote..." : `Start Vote (${consensusParticipants.length} agents)`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
