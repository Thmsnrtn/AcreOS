import React, { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRoute } from "wouter";
import {
  Cpu, Heart, DollarSign, Megaphone, Server, BarChart3, ShieldAlert,
  BrainCircuit, Navigation, ScrollText, Bot, ArrowLeft, Send,
  CheckCircle2, XCircle, Clock, AlertTriangle, Loader2,
  MessageSquare, Target, TrendingUp, Activity, Play, Pause,
} from "lucide-react";
import { relative } from "@/lib/format";
import { describeTrust, trustLabel, trustBadgeColor } from "@/lib/trust-language";

const AGENT_ICONS: Record<string, React.ElementType> = {
  atlas_cto: Cpu, sophie_csm: Heart, forge_revenue: DollarSign,
  beacon_marketing: Megaphone, sentinel_devops: Server, ledger_finance: BarChart3,
  shield_legal: ShieldAlert, oracle_analytics: BrainCircuit,
  compass_pm: Navigation, crucible_qa: ScrollText,
};

const AGENT_COLORS: Record<string, string> = {
  atlas_cto: "text-blue-600", sophie_csm: "text-pink-500", forge_revenue: "text-green-600",
  beacon_marketing: "text-orange-500", sentinel_devops: "text-slate-600", ledger_finance: "text-emerald-600",
  shield_legal: "text-red-500", oracle_analytics: "text-purple-600",
  compass_pm: "text-cyan-600", crucible_qa: "text-amber-600",
};

const OUTCOME_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  success: { icon: CheckCircle2, color: "text-green-600" },
  failure: { icon: XCircle, color: "text-red-600" },
  escalated: { icon: AlertTriangle, color: "text-amber-600" },
  pending: { icon: Clock, color: "text-blue-600" },
};

export default function AgentDetailPage() {
  const [, params] = useRoute("/founder/agents/:codename");
  const codename = params?.codename || "";
  const { toast } = useToast();
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
      setChatHistory(prev => [...prev, { role: "assistant", content: "Error processing request." }]);
    }
  };

  if (isLoading) {
    return <PageShell><Skeleton className="h-96" /></PageShell>;
  }

  if (!data?.agent) {
    return <PageShell><p>No agent found with codename: {codename}</p></PageShell>;
  }

  const { agent, liveData, recentActions, goals, trustHistory, decisions } = data;
  const Icon = AGENT_ICONS[codename] || Bot;
  const color = AGENT_COLORS[codename] || "text-gray-500";
  const isPaused = agent.status === "paused";
  const trustPct = agent.trustScore || 50;

  return (
    <PageShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl bg-muted`}>
              <Icon className={`w-8 h-8 ${color}`} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{agent.title}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{agent.wing}</Badge>
                <Badge variant={isPaused ? "secondary" : "default"}>
                  {isPaused ? "Paused" : "Active"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Last active: {agent.lastActivityAt ? relative(agent.lastActivityAt) : "Never"}
                </span>
              </div>
            </div>
          </div>
          <Button
            variant={isPaused ? "default" : "outline"}
            onClick={() => statusMutation.mutate(isPaused ? "active" : "paused")}
          >
            {isPaused ? <><Play className="w-4 h-4 mr-1" /> Resume</> : <><Pause className="w-4 h-4 mr-1" /> Pause</>}
          </Button>
        </div>

        {/* Trust Score + Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Trust Level</div>
                <Badge className={`text-xs ${trustBadgeColor(trustPct)}`}>{trustLabel(trustPct)}</Badge>
              </div>
              <div className="h-2 bg-muted rounded-full mt-3 overflow-hidden">
                <div className={`h-full rounded-full ${trustPct >= 75 ? "bg-green-500" : trustPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${trustPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {describeTrust(trustPct, codename)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Actions Taken</div>
              <div className="text-3xl font-bold mt-1">{recentActions?.length || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {recentActions?.filter((a: any) => a.outcome === "success").length || 0} successful
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Active Goals</div>
              <div className="text-3xl font-bold mt-1">{goals?.filter((g: any) => g.status !== "completed" && g.status !== "cancelled").length || 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {goals?.filter((g: any) => g.status === "completed").length || 0} completed
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live Data from Services */}
        {liveData && Object.keys(liveData).length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Live Metrics</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(liveData).filter(([, v]) => typeof v === "number" || (typeof v === "string" && !v.includes("ISO"))).map(([key, val]) => (
                  <div key={key} className="p-2 rounded bg-muted/50">
                    <div className="text-xs text-muted-foreground">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</div>
                    <div className="text-sm font-semibold">{typeof val === "number" ? val.toLocaleString() : String(val)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Authority Config */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Authority Levels</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { level: 0, label: "Full Autonomy", color: "bg-green-500/10 border-green-500/30", req: 90 },
                { level: 1, label: "Auto + Notify", color: "bg-blue-500/10 border-blue-500/30", req: 70 },
                { level: 2, label: "Recommend + Wait", color: "bg-amber-500/10 border-amber-500/30", req: 40 },
                { level: 3, label: "Always Escalate", color: "bg-red-500/10 border-red-500/30", req: 0 },
              ].map(({ level, label, color, req }) => {
                const actions = (agent.authorityConfig as any)?.[`level${level}Actions`] || [];
                const active = trustPct >= req;
                return (
                  <div key={level} className={`p-3 rounded-lg border ${color} ${!active ? "opacity-40" : ""}`}>
                    <div className="text-xs font-semibold mb-1">{label}</div>
                    <div className="text-xs text-muted-foreground">
                      {actions.length > 0 ? actions.join(", ") : "None configured"}
                    </div>
                    {active && <Badge variant="outline" className="mt-1 text-[10px]">Active</Badge>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Action Audit Log */}
        {recentActions && recentActions.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Action Audit Log</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentActions.map((action: any) => {
                  const style = OUTCOME_STYLES[action.outcome] || OUTCOME_STYLES.pending;
                  const OutcomeIcon = style.icon;
                  return (
                    <div key={action.id} className="flex items-start gap-3 p-2 rounded hover:bg-muted/50">
                      <OutcomeIcon className={`w-4 h-4 mt-0.5 shrink-0 ${style.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{action.actionName}</div>
                        <div className="text-xs text-muted-foreground">{action.reasoning?.slice(0, 120)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {trustLabel(action.trustScoreAtTime)}
                          {action.createdAt && ` · ${relative(action.createdAt)}`}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{action.actionType}</Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Chat */}
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Talk to {codename.split("_")[0]}</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-3 p-3 bg-muted/30 rounded-lg">
              {chatHistory.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Ask a question grounded in live data.</p>}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder={`Ask ${codename.split("_")[0]}...`}
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
              />
              <Button onClick={sendChat} disabled={!chatMsg.trim()} size="sm"><Send className="w-4 h-4" /></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
