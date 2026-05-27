import React, { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { agentTextClass, agentBgClass, getAgentIdentity } from "@/lib/agent-identity";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useRoute } from "wouter";
import {
  Cpu, Heart, DollarSign, Megaphone, Server, BarChart3, ShieldAlert,
  BrainCircuit, Navigation, ScrollText, Bot, Send,
  CheckCircle2, XCircle, Clock, AlertTriangle,
  MessageSquare, Activity, Play, Pause,
} from "lucide-react";
import { relative } from "@/lib/format";
import { describeTrust, trustLabel, trustBadgeColor } from "@/lib/trust-language";

const AGENT_ICONS: Record<string, React.ElementType> = {
  atlas_cto: Cpu, sophie_csm: Heart, forge_revenue: DollarSign,
  beacon_marketing: Megaphone, sentinel_devops: Server, ledger_finance: BarChart3,
  shield_legal: ShieldAlert, oracle_analytics: BrainCircuit,
  compass_pm: Navigation, crucible_qa: ScrollText,
};

// Per-agent text color now sourced from the consolidated registry at
// client/src/lib/agent-identity.ts — see agentTextClass(). Migration of
// the remaining AGENT_COLORS literals across founder-dashboard /
// components/founder/* tracks the same registry.

// Outcome → semantic --acr-* tone (Tier 1 pattern). agentTextClass()
// handles the per-agent identity side; this remains outcome-only.
const OUTCOME_STYLES: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  success: { icon: CheckCircle2, color: "text-acr-pos", label: "Success" },
  failure: { icon: XCircle, color: "text-acr-neg", label: "Failure" },
  escalated: { icon: AlertTriangle, color: "text-acr-warn", label: "Escalated" },
  pending: { icon: Clock, color: "text-acr-brand", label: "Pending" },
};

export default function AgentDetailPage() {
  const [, params] = useRoute("/founder/agents/:codename");
  const codename = params?.codename || "";
  useDocumentTitle(codename ? `Agent: ${codename}` : "Agent detail");
  const { toast } = useToast();
  const chatInputId = useId();
  const [chatMsg, setChatMsg] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [convId, setConvId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [`/api/founder/intelligence/company-agents/${codename}/detail`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/founder/intelligence/company-agents/${codename}/detail`);
      return res.json();
    },
    enabled: !!codename,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/founder/intelligence/company-agents/${codename}/status`, { status });
      return res.json();
    },
    onSuccess: (_, status) => toast({ title: `Agent ${status}` }),
    onError: () =>
      toast({
        title: "Couldn't update agent status",
        description: "The agent's previous on/off state is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const sendChat = async () => {
    if (!chatMsg.trim()) return;
    const msg = chatMsg;
    setChatMsg("");
    setChatHistory(prev => [...prev, { role: "user", content: msg }]);

    try {
      const res = await apiRequest("POST", "/api/founder/intelligence/agent-chat", {
        message: msg, targetAgent: codename, conversationId: convId,
      });
      const d = await res.json();
      if (d.conversationId && !convId) setConvId(d.conversationId);
      setChatHistory(prev => [...prev, { role: "assistant", content: d.response }]);
    } catch {
      setChatHistory(prev => [...prev, { role: "assistant", content: "Error processing request. Your message wasn't sent — try again." }]);
    }
  };

  if (isLoading) {
    return (
      <PageShell>
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading agent detail…</span>
          <Skeleton className="h-96" />
        </div>
      </PageShell>
    );
  }

  if (!data?.agent) {
    return <PageShell><p>No agent found with codename: <span className="font-mono">{codename}</span></p></PageShell>;
  }

  const { agent, liveData, recentActions, goals } = data;
  const Icon = AGENT_ICONS[codename] || Bot;
  const color = agentTextClass(codename);
  const identity = getAgentIdentity(codename);
  const letterClass = agentBgClass(codename);
  const isPaused = agent.status === "paused";
  const trustPct = agent.trustScore || 50;
  const successCount = recentActions?.filter((a: any) => a.outcome === "success").length || 0;
  const completedGoals = goals?.filter((g: any) => g.status === "completed").length || 0;
  const activeGoals = goals?.filter((g: any) => g.status !== "completed" && g.status !== "cancelled").length || 0;

  return (
    <PageShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="relative p-3 rounded-xl bg-muted">
              <Icon className={`w-8 h-8 ${color}`} aria-hidden="true" />
              {/* Letter mark — design-system §1.3. Soft tint matches the
                  agent's tone so it reads as part of the identity, not as
                  a separate badge. */}
              <span
                className={`absolute -top-1 -right-1 w-5 h-5 rounded-full text-[11px] font-semibold flex items-center justify-center ${letterClass}`}
                aria-label={`${identity.friendlyName} letter mark`}
              >
                {identity.letter}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">{agent.title}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline">{agent.wing}</Badge>
                <Badge variant={isPaused ? "secondary" : "default"}>
                  {isPaused ? "Paused" : "Active"}
                </Badge>
                <span className="text-sm text-muted-foreground tabular-nums">
                  Last active: {agent.lastActivityAt ? relative(agent.lastActivityAt) : "Never"}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant={isPaused ? "default" : "outline"}
            onClick={() => statusMutation.mutate(isPaused ? "active" : "paused")}
            disabled={statusMutation.isPending}
            aria-label={isPaused ? `Resume ${agent.title}` : `Pause ${agent.title}`}
          >
            {isPaused ? <><Play className="w-4 h-4 mr-1" aria-hidden="true" /> Resume</> : <><Pause className="w-4 h-4 mr-1" aria-hidden="true" /> Pause</>}
          </Button>
        </div>

        <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">Trust level</dt>
                <Badge className={`text-xs ${trustBadgeColor(trustPct)}`}>{trustLabel(trustPct)}</Badge>
              </div>
              <div
                className="h-2 bg-muted rounded-full mt-3 overflow-hidden"
                role="progressbar"
                aria-valuenow={trustPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Trust level ${trustPct}%, ${trustLabel(trustPct)}`}
              >
                <div
                  className={`h-full rounded-full ${trustPct >= 75 ? "bg-acr-pos" : trustPct >= 50 ? "bg-acr-warn" : "bg-acr-neg"}`}
                  style={{ width: `${trustPct}%` }}
                />
              </div>
              <dd className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {describeTrust(trustPct, codename)}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-sm text-muted-foreground">Actions taken</dt>
              <dd className="text-3xl font-bold mt-1 tabular-nums">{recentActions?.length || 0}</dd>
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                {successCount} successful
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-sm text-muted-foreground">Active goals</dt>
              <dd className="text-3xl font-bold mt-1 tabular-nums">{activeGoals}</dd>
              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                {completedGoals} completed
              </p>
            </CardContent>
          </Card>
        </dl>

        {liveData && Object.keys(liveData).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" aria-hidden="true" /> Live metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(liveData)
                  .filter(([, v]) => typeof v === "number" || (typeof v === "string" && !v.includes("ISO")))
                  .map(([key, val]) => (
                    <div key={key} className="p-2 rounded bg-muted/50">
                      <dt className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{typeof val === "number" ? val.toLocaleString() : String(val)}</dd>
                    </div>
                  ))}
              </dl>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm">Authority levels</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 md:grid-cols-4 gap-3" aria-label="Authority levels by trust threshold">
              {[
                { level: 0, label: "Full autonomy", color: "bg-acr-pos-soft border-[color:var(--acr-pos)]/30", req: 90 },
                { level: 1, label: "Auto + notify", color: "bg-acr-brand-soft border-[color:var(--acr-brand)]/30", req: 70 },
                { level: 2, label: "Recommend + wait", color: "bg-acr-warn-soft border-[color:var(--acr-warn)]/30", req: 40 },
                { level: 3, label: "Always escalate", color: "bg-acr-neg-soft border-[color:var(--acr-neg)]/30", req: 0 },
              ].map(({ level, label, color, req }) => {
                const actions = (agent.authorityConfig as any)?.[`level${level}Actions`] || [];
                const active = trustPct >= req;
                return (
                  <li
                    key={level}
                    className={`p-3 rounded-card border ${color} ${!active ? "opacity-40" : ""}`}
                    aria-label={`${label}, ${active ? "active at current trust" : `requires ${req}% trust`}`}
                  >
                    <div className="text-xs font-semibold mb-1">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      {actions.length > 0 ? actions.join(", ") : "None configured"}
                    </div>
                    {active && <Badge variant="outline" className="mt-1 text-[10px]">Active</Badge>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {recentActions && recentActions.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Action audit log</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-2 max-h-[400px] overflow-y-auto" aria-label="Recent agent actions, newest first">
                {recentActions.map((action: any) => {
                  const style = OUTCOME_STYLES[action.outcome] || OUTCOME_STYLES.pending;
                  const OutcomeIcon = style.icon;
                  return (
                    <li key={action.id} className="flex items-start gap-3 p-2 rounded hover:bg-muted/50">
                      <OutcomeIcon
                        className={`w-4 h-4 mt-0.5 shrink-0 ${style.color}`}
                        aria-label={`Outcome: ${style.label}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{action.actionName}</div>
                        <div className="text-xs text-muted-foreground">{action.reasoning?.slice(0, 120)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {trustLabel(action.trustScoreAtTime)}
                          {action.createdAt && ` · ${relative(action.createdAt)}`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{action.actionType}</Badge>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4" aria-hidden="true" /> Talk to {codename.split("_")[0]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="max-h-[300px] overflow-y-auto space-y-2 mb-3 p-3 bg-muted/30 rounded-card"
              role="log"
              aria-live="polite"
              aria-label={`Chat with ${codename}`}
            >
              {chatHistory.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Ask a question grounded in live data.</p>}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                    <span className="sr-only">{msg.role === "user" ? "You: " : `${codename}: `}</span>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); sendChat(); }}
              className="flex gap-2"
            >
              <Label htmlFor={chatInputId} className="sr-only">Message {codename}</Label>
              <Input
                id={chatInputId}
                placeholder={`Ask ${codename.split("_")[0]}…`}
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
              />
              <Button type="submit" disabled={!chatMsg.trim()} size="sm" aria-label={`Send message to ${codename}`}>
                <Send className="w-4 h-4" aria-hidden="true" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
