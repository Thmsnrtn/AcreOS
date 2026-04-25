import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  MessageSquare, Users, Send, ArrowRight,
  Vote, Crown, Bot,
} from "lucide-react";
import { relative } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
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
  const senderLabel = isFounder ? "You" : message.fromAgent ?? "Unknown";

  return (
    <li className={`flex ${isFounder ? "justify-end" : "justify-start"} list-none`}>
      <div className={`max-w-[75%] rounded-lg p-3 ${
        isFounder
          ? "bg-primary text-primary-foreground"
          : isDelegation
          ? "bg-yellow-50 border border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
          : isConsensus
          ? "bg-purple-50 border border-purple-200 dark:bg-purple-950 dark:border-purple-800"
          : "bg-muted"
      }`}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {isFounder ? (
            <Crown className="w-3 h-3" aria-label="Founder" />
          ) : (
            <Bot className="w-3 h-3" aria-label="Agent" />
          )}
          <span className="text-xs font-medium">
            {senderLabel} → {message.toAgent ?? "all"}
          </span>
          {isDelegation && <Badge variant="outline" className="text-xs py-0">Delegation</Badge>}
          {isConsensus && <Badge variant="outline" className="text-xs py-0">Consensus</Badge>}
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
        <p className="text-xs opacity-60 mt-1 tabular-nums">
          {message.createdAt && relative(message.createdAt)}
        </p>
      </div>
    </li>
  );
}

export default function AgentCollaboration() {
  useDocumentTitle("Agent collaboration");
  const { toast } = useToast();
  const { data: messages = [], isLoading } = useAgentMessages();
  const queryClient = useQueryClient();

  const delegateAgentId = useId();
  const delegateTaskId = useId();
  const delegateContextId = useId();
  const overrideAgentId = useId();
  const overrideActionId = useId();
  const overrideReasonId = useId();
  const consensusTopicId = useId();

  const [delegateAgent, setDelegateAgent] = useState("");
  const [delegateTask, setDelegateTask] = useState("");
  const [delegateContext, setDelegateContext] = useState("");

  const [overrideAgent, setOverrideAgent] = useState("");
  const [overrideAction, setOverrideAction] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [pendingOverride, setPendingOverride] = useState(false);

  const [consensusTopic, setConsensusTopic] = useState("");
  const [consensusParticipants, setConsensusParticipants] = useState<string[]>([]);

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
      toast({ title: "Task delegated", description: `Sent to ${delegateAgent}.` });
    },
    onError: () =>
      toast({
        title: "Couldn't delegate task",
        description: "Your inputs are unchanged. Try again, or check that the agent is available.",
        variant: "destructive",
      }),
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
      setPendingOverride(false);
      toast({ title: "Override executed" });
    },
    onError: () =>
      toast({
        title: "Couldn't execute override",
        description: "The agent's existing decision is unchanged. Try again — your reason and override action are still here.",
        variant: "destructive",
      }),
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
      toast({ title: "Vote started" });
    },
    onError: () =>
      toast({
        title: "Couldn't start consensus vote",
        description: "Your topic and participants are unchanged. Try again.",
        variant: "destructive",
      }),
  });

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" aria-hidden="true" />
            Agent collaboration
          </h1>
          <p className="text-sm text-muted-foreground">
            Inter-agent messaging, task delegation, founder overrides, and consensus voting.
          </p>
        </div>

        <Tabs defaultValue="messages">
          <TabsList>
            <TabsTrigger value="messages">
              <MessageSquare className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Messages
            </TabsTrigger>
            <TabsTrigger value="delegate">
              <ArrowRight className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Delegate
            </TabsTrigger>
            <TabsTrigger value="override">
              <Crown className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Override
            </TabsTrigger>
            <TabsTrigger value="consensus">
              <Vote className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Consensus
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
                  Agent conversation thread
                  <Badge variant="secondary"><span className="tabular-nums">{Array.isArray(messages) ? messages.length : 0}</span> messages</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-y-auto p-2">
                  {Array.isArray(messages) && messages.length > 0 ? (
                    <ol className="space-y-3" aria-label="Agent conversation, oldest first" role="log" aria-live="polite">
                      {[...messages].reverse().map((msg: any, i: number) => (
                        <MessageBubble key={msg.id ?? i} message={msg} />
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-12">
                      No inter-agent messages yet. Use the Delegate tab to assign a task to an agent.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="delegate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Delegate task to agent</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); if (delegateAgent && delegateTask) delegateMutation.mutate(); }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor={delegateAgentId}>Agent</Label>
                    <Select value={delegateAgent} onValueChange={setDelegateAgent}>
                      <SelectTrigger id={delegateAgentId} aria-label="Pick the agent to delegate to">
                        <SelectValue placeholder="Select agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_CODENAMES.map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={delegateTaskId}>Task</Label>
                    <Input
                      id={delegateTaskId}
                      placeholder="Describe the task…"
                      value={delegateTask}
                      onChange={(e) => setDelegateTask(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={delegateContextId}>Context <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Textarea
                      id={delegateContextId}
                      placeholder="Additional context or instructions…"
                      value={delegateContext}
                      onChange={(e) => setDelegateContext(e.target.value)}
                      rows={3}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={!delegateAgent || !delegateTask || delegateMutation.isPending}
                    aria-label={delegateAgent ? `Delegate task to ${delegateAgent}` : "Delegate task"}
                  >
                    <Send className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                    {delegateMutation.isPending ? "Delegating…" : "Delegate task"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="override" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Founder override — CEO authority</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); if (overrideAgent && overrideAction) setPendingOverride(true); }}
                  className="space-y-4"
                >
                  <p className="text-sm text-muted-foreground">
                    Override an agent's decision. The feedback will be logged and used to train future decisions (v14 feedback loop).
                  </p>
                  <div>
                    <Label htmlFor={overrideAgentId}>Agent</Label>
                    <Select value={overrideAgent} onValueChange={setOverrideAgent}>
                      <SelectTrigger id={overrideAgentId} aria-label="Pick the agent to override">
                        <SelectValue placeholder="Select agent…" />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_CODENAMES.map((name) => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={overrideActionId}>Override action</Label>
                    <Input
                      id={overrideActionId}
                      placeholder="What should the agent do instead?"
                      value={overrideAction}
                      onChange={(e) => setOverrideAction(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={overrideReasonId}>Reason</Label>
                    <Textarea
                      id={overrideReasonId}
                      placeholder="Why are you overriding this decision?"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={!overrideAgent || !overrideAction || overrideMutation.isPending}
                    aria-label={overrideAgent ? `Execute override on ${overrideAgent}` : "Execute override"}
                  >
                    <Crown className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                    {overrideMutation.isPending ? "Overriding…" : "Execute override"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="consensus" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Start consensus vote</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); if (consensusTopic && consensusParticipants.length >= 2) consensusMutation.mutate(); }}
                  className="space-y-4"
                >
                  <p className="text-sm text-muted-foreground">
                    Start a multi-agent vote on a strategic decision. Each selected agent will receive a ballot.
                  </p>
                  <div>
                    <Label htmlFor={consensusTopicId}>Topic</Label>
                    <Input
                      id={consensusTopicId}
                      placeholder="What should the team decide?"
                      value={consensusTopic}
                      onChange={(e) => setConsensusTopic(e.target.value)}
                      required
                    />
                  </div>
                  <fieldset>
                    <legend className="text-sm font-medium mb-2">Participants</legend>
                    <ul className="flex flex-wrap gap-2" role="group" aria-label="Vote participants">
                      {AGENT_CODENAMES.map((name) => {
                        const isSelected = consensusParticipants.includes(name);
                        return (
                          <li key={name}>
                            <Button
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              aria-pressed={isSelected}
                              onClick={() => {
                                setConsensusParticipants((prev) =>
                                  prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                                );
                              }}
                            >
                              {name}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                  <Button
                    type="submit"
                    disabled={!consensusTopic || consensusParticipants.length < 2 || consensusMutation.isPending}
                  >
                    <Vote className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
                    {consensusMutation.isPending ? "Starting vote…" : `Start vote (${consensusParticipants.length} agents)`}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={pendingOverride}
        onOpenChange={(open) => { if (!open) setPendingOverride(false); }}
        title={`Override ${overrideAgent}?`}
        description={
          overrideAgent
            ? `${overrideAgent} will be told to do "${overrideAction}" instead of its planned action. The override and your reason are logged permanently and feed into the meta-agent's training data. This redirects the agent immediately — make sure your override action is what you want.`
            : ""
        }
        confirmLabel="Yes, execute override"
        variant="destructive"
        isLoading={overrideMutation.isPending}
        onConfirm={() => overrideMutation.mutate()}
      />
    </PageShell>
  );
}
