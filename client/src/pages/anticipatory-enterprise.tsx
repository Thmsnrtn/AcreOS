import { useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Swords, DollarSign, Brain, Clock, Gauge, GitBranch, Key, Radar,
  Loader2, CheckCircle, AlertTriangle, ArrowRight, Play, RefreshCw,
  TrendingUp, Shield, Zap, Eye, BarChart3, XCircle,
} from "lucide-react";

// ─── Agent Negotiation Tab ──────────────────────────────────────────────────

function NegotiationProtocol() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [initiator, setInitiator] = useState("forge_revenue");
  const [respondent, setRespondent] = useState("shield_compliance");
  const [position, setPosition] = useState("");

  const { data: negotiations, isLoading } = useQuery({
    queryKey: ["/api/founder/v11/negotiations"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/negotiations").then(r => r.json()),
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v11/negotiations/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/negotiations/stats").then(r => r.json()),
  });

  const initiateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/negotiations", {
      initiatorAgent: initiator, respondentAgent: respondent,
      conflictType: "strategy_disagreement", subject, initiatorPosition: position, initiatorEvidence: [],
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/negotiations"] });
      toast({ title: "Negotiation complete" });
      setSubject(""); setPosition("");
    },
  });

  const resolutionColors: Record<string, string> = {
    compromise: "bg-green-500", initiator_wins: "bg-blue-500",
    respondent_wins: "bg-purple-500", deadlocked: "bg-red-500", escalated: "bg-orange-500",
  };

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Resolved</p><p className="text-2xl font-bold text-green-500">{stats.resolved}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Escalated</p><p className="text-2xl font-bold text-orange-500">{stats.escalated}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Compromise Rate</p><p className="text-2xl font-bold">{stats.compromiseRate}%</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Swords className="h-4 w-4" /> Initiate Negotiation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={initiator} onValueChange={setInitiator}>
              <SelectTrigger><SelectValue placeholder="Initiator" /></SelectTrigger>
              <SelectContent>
                {["forge_revenue","sophie_support","beacon_marketing","ledger_finance","shield_compliance","oracle_analytics"].map(a => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={respondent} onValueChange={setRespondent}>
              <SelectTrigger><SelectValue placeholder="Respondent" /></SelectTrigger>
              <SelectContent>
                {["forge_revenue","sophie_support","beacon_marketing","ledger_finance","shield_compliance","oracle_analytics"].map(a => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input placeholder="Subject of conflict" value={subject} onChange={e => setSubject(e.target.value)} />
          <Textarea placeholder="Initiator's position" value={position} onChange={e => setPosition(e.target.value)} rows={2} />
          <Button onClick={() => initiateMutation.mutate()} disabled={!subject || !position || initiateMutation.isPending} size="sm">
            {initiateMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Swords className="mr-2 h-3 w-3" />} Start Negotiation
          </Button>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40" /> : (negotiations || []).map((n: any) => (
        <Card key={n.id} className={n.status === "escalated" ? "border-orange-500" : ""}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline">{n.initiatorAgent}</Badge>
              <Swords className="h-3 w-3" />
              <Badge variant="outline">{n.respondentAgent}</Badge>
              <Badge variant={n.status === "resolved" ? "default" : n.status === "escalated" ? "destructive" : "secondary"}>{n.status}</Badge>
              {n.resolutionType && <Badge className={`${resolutionColors[n.resolutionType] || ""} text-white text-xs`}>{n.resolutionType}</Badge>}
            </div>
            <p className="text-sm font-medium">{n.subject}</p>
            {n.resolution && <p className="text-xs text-muted-foreground mt-1">{n.resolution}</p>}
            {(n.negotiationRounds || []).length > 0 && <p className="text-xs text-muted-foreground">{n.negotiationRounds.length} rounds</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Revenue Attribution Tab ────────────────────────────────────────────────

function RevenueAttribution() {
  const { data: reports } = useQuery({
    queryKey: ["/api/founder/v11/attribution/reports"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/attribution/reports").then(r => r.json()),
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reportMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/attribution/report", { period: "weekly" }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/attribution/reports"] }); toast({ title: "Report generated" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5" /> Revenue Attribution</h3>
        <Button size="sm" onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending}>
          <BarChart3 className="mr-2 h-3 w-3" /> Generate Report
        </Button>
      </div>

      {(reports || []).map((r: any) => (
        <Card key={r.id}>
          <CardHeader><CardTitle className="text-sm">{r.reportPeriod} — ${(r.totalAttributedRevenue / 100).toFixed(2)} attributed</CardTitle></CardHeader>
          <CardContent>
            {(r.agentContributions || []).map((c: any) => (
              <div key={c.agentCodename} className="flex items-center gap-2 py-1">
                <Badge variant="outline" className="w-32">{c.agentCodename}</Badge>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(100, c.avgAttribution)}%` }} />
                </div>
                <span className="text-xs font-mono w-24 text-right">${(c.totalRevenue / 100).toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">{c.actionCount} actions</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      {(!reports || reports.length === 0) && <p className="text-sm text-muted-foreground text-center py-8">No attribution reports yet. Record agent actions and attribute revenue to generate reports.</p>}
    </div>
  );
}

// ─── CEO Cognitive Model Tab ────────────────────────────────────────────────

function CognitiveModel() {
  const { data: models } = useQuery({
    queryKey: ["/api/founder/v11/cognitive/models"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/cognitive/models").then(r => r.json()),
  });

  const { data: eligible } = useQuery({
    queryKey: ["/api/founder/v11/cognitive/autopilot-eligible"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/cognitive/autopilot-eligible").then(r => r.json()),
  });

  const queryClient = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: ({ category, enabled }: { category: string; enabled: boolean }) =>
      apiRequest("POST", `/api/founder/v11/cognitive/${category}/autopilot`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/cognitive/models"] }),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Brain className="h-5 w-5" /> CEO Cognitive Model</h3>

      {(eligible || []).length > 0 && (
        <Card className="border-green-500">
          <CardHeader><CardTitle className="text-sm text-green-600">Autopilot Eligible</CardTitle></CardHeader>
          <CardContent>
            {eligible.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between py-1">
                <span className="text-sm">{m.decisionCategory}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{Number(m.shadowAccuracy).toFixed(1)}% accuracy ({m.shadowPredictions} predictions)</span>
                  <Button size="sm" variant={m.autopilotEnabled ? "default" : "outline"}
                    onClick={() => toggleMutation.mutate({ category: m.decisionCategory, enabled: !m.autopilotEnabled })}>
                    {m.autopilotEnabled ? "Autopilot ON" : "Enable Autopilot"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(models || []).map((m: any) => (
        <Card key={m.id}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="outline">{m.decisionCategory}</Badge>
                <span className="text-xs text-muted-foreground ml-2">v{m.modelVersion}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono">{Number(m.shadowAccuracy).toFixed(1)}% accuracy</span>
                <span className="text-xs text-muted-foreground">{m.shadowCorrect}/{m.shadowPredictions} correct</span>
                {m.autopilotEnabled && <Badge className="bg-green-500 text-white">Autopilot</Badge>}
              </div>
            </div>
            {(m.decisionPatterns || []).length > 0 && (
              <div className="mt-2 space-y-1">
                {(m.decisionPatterns as any[]).slice(0, 3).map((p: any, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">• {p.pattern}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Knowledge Decay Tab ────────────────────────────────────────────────────

function KnowledgeDecay() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v11/knowledge/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/knowledge/stats").then(r => r.json()),
  });

  const { data: zombies } = useQuery({
    queryKey: ["/api/founder/v11/knowledge/zombies"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/knowledge/zombies").then(r => r.json()),
  });

  const decayMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/knowledge/decay-cycle").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/knowledge"] });
      toast({ title: "Decay cycle complete", description: `${data.decayed} decayed, ${data.zombiesDetected} zombies found` });
    },
  });

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Patterns</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Avg Freshness</p><p className="text-2xl font-bold">{stats.avgFreshness}%</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground text-red-500">Zombies</p><p className="text-2xl font-bold text-red-500">{stats.zombies}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Stale</p><p className="text-2xl font-bold text-orange-500">{stats.stale}</p></CardContent></Card>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={() => decayMutation.mutate()} disabled={decayMutation.isPending}>
        <Clock className="mr-2 h-3 w-3" /> Run Decay Cycle
      </Button>

      {(zombies || []).length > 0 && (
        <Card className="border-red-500">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /> Zombie Patterns</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {zombies.map((z: any) => (
              <div key={z.id} className="flex items-center justify-between border-b pb-1 last:border-0">
                <div>
                  <p className="text-sm font-medium">{z.patternName}</p>
                  <p className="text-xs text-muted-foreground">Used {z.usageCount}x but not validated in 6+ months</p>
                </div>
                <Badge variant="destructive">{Number(z.freshnessScore).toFixed(0)}%</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Resource Governor Tab ──────────────────────────────────────────────────

function ResourceGovernor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: quotas, isLoading } = useQuery({
    queryKey: ["/api/founder/v11/governor"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/governor").then(r => r.json()),
  });

  const initMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/governor/initialize").then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/governor"] }); toast({ title: "Quotas initialized" }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><Gauge className="h-5 w-5" /> Resource Governor</h3>
        <Button size="sm" variant="outline" onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>Initialize Quotas</Button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : (quotas || []).map((q: any) => (
        <Card key={q.id} className={q.circuitBreakerTripped ? "border-red-500" : q.burstDetected ? "border-orange-500" : ""}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between mb-2">
              <Badge variant="outline">{q.agentCodename}</Badge>
              <div className="flex gap-1">
                {q.circuitBreakerTripped && <Badge variant="destructive">CIRCUIT BREAKER</Badge>}
                {q.burstDetected && <Badge className="bg-orange-500 text-white">BURST</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Actions</p>
                <p className="font-mono">{q.dailyActionsUsed}/{q.dailyActionLimit}</p>
                <div className="bg-muted rounded-full h-1.5 mt-1">
                  <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(100, (q.dailyActionsUsed / q.dailyActionLimit) * 100)}%` }} />
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Cost</p>
                <p className="font-mono">${(q.dailyCostUsedCents / 100).toFixed(2)}/${(q.dailyCostLimitCents / 100).toFixed(2)}</p>
                <div className="bg-muted rounded-full h-1.5 mt-1">
                  <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (q.dailyCostUsedCents / q.dailyCostLimitCents) * 100)}%` }} />
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Hourly</p>
                <p className="font-mono">{q.hourlyActionsUsed}/{q.hourlyRateLimit}</p>
                <div className="bg-muted rounded-full h-1.5 mt-1">
                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (q.hourlyActionsUsed / q.hourlyRateLimit) * 100)}%` }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Delegation Tokens Tab ──────────────────────────────────────────────────

function DelegationTokens() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [agent, setAgent] = useState("sophie_support");
  const [scope, setScope] = useState("refunds");
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState("50000");

  const { data: active } = useQuery({
    queryKey: ["/api/founder/v11/delegations/active"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/delegations/active").then(r => r.json()),
  });

  const grantMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/delegations", {
      agentCodename: agent, scope, reason,
      spendingLimitCents: parseInt(limit),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/delegations"] });
      toast({ title: "Delegation granted" }); setReason("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v11/delegations/${id}/revoke`, { reason: "CEO revoked" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/delegations"] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4" /> Grant Delegation</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["sophie_support","forge_revenue","beacon_marketing","ledger_finance","shield_compliance"].map(a => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["refunds","discounts","billing","escalation","custom"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Spending limit (cents)" value={limit} onChange={e => setLimit(e.target.value)} />
          </div>
          <Input placeholder="Reason for delegation" value={reason} onChange={e => setReason(e.target.value)} />
          <Button size="sm" onClick={() => grantMutation.mutate()} disabled={!reason || grantMutation.isPending}>
            <Key className="mr-2 h-3 w-3" /> Grant (7 days)
          </Button>
        </CardContent>
      </Card>

      {(active || []).map((t: any) => (
        <Card key={t.id}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{t.agentCodename}</Badge>
                <Badge>{t.scope}</Badge>
                {t.isStanding && <Badge variant="secondary">Standing</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t.actionsSucceeded}✓ {t.actionsFailed}✗ of {t.actionsTaken}
                </span>
                <Button size="sm" variant="ghost" onClick={() => revokeMutation.mutate(t.id)}>
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t.reason}</p>
            <p className="text-xs text-muted-foreground">Expires: {new Date(t.expiresAt).toLocaleDateString()}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Predictive Orchestration Tab ───────────────────────────────────────────

function PredictiveOrchestration() {
  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v11/predictions/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/predictions/stats").then(r => r.json()),
  });

  const { data: staged } = useQuery({
    queryKey: ["/api/founder/v11/predictions/staged"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/predictions/staged").then(r => r.json()),
  });

  const { data: patterns } = useQuery({
    queryKey: ["/api/founder/v11/predictions/patterns"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/predictions/patterns").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Patterns</p><p className="text-2xl font-bold">{stats.totalPatterns}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Staged</p><p className="text-2xl font-bold text-blue-500">{stats.stagedActions}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Triggered</p><p className="text-2xl font-bold text-green-500">{stats.triggered}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Accuracy</p><p className="text-2xl font-bold">{stats.avgAccuracy}%</p></CardContent></Card>
        </div>
      )}

      {(staged || []).length > 0 && (
        <Card className="border-blue-500">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Radar className="h-4 w-4 text-blue-500 animate-pulse" /> Pre-Staged Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {staged.map((s: any) => (
              <div key={s.id} className="border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{s.stagedAgent}</Badge>
                  <Badge variant="secondary">{s.triggerConfidence}% confidence</Badge>
                </div>
                <p className="text-sm mt-1">{s.stagedAction}</p>
                <p className="text-xs text-muted-foreground">Waiting for: {s.triggerPattern}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Temporal Prediction Patterns</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(patterns || []).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 border-b pb-1 last:border-0">
              <Badge variant="outline">{p.causeAgent}</Badge>
              <ArrowRight className="h-3 w-3" />
              <Badge variant="outline">{p.effectAgent}</Badge>
              <span className="text-xs text-muted-foreground ml-auto">
                ~{Number(p.avgDelayHours).toFixed(0)}h delay | {(Number(p.correlationStrength) * 100).toFixed(0)}% correlation
              </span>
              {p.autoStageEnabled && <Badge className="bg-green-500 text-white text-xs">Auto</Badge>}
            </div>
          ))}
          {(!patterns || patterns.length === 0) && <p className="text-sm text-muted-foreground text-center py-4">No patterns yet. Register cause-effect pairs to enable predictive orchestration.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Decision Causality Tab ─────────────────────────────────────────────────

function DecisionCausality() {
  const { data: deepest } = useQuery({
    queryKey: ["/api/founder/v11/causality/deepest"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/causality/deepest").then(r => r.json()),
  });

  const { data: cascading } = useQuery({
    queryKey: ["/api/founder/v11/causality/cascading"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/causality/cascading").then(r => r.json()),
  });

  const outcomeColors: Record<string, string> = {
    success: "text-green-500", failure: "text-red-500", pending: "text-yellow-500", rolled_back: "text-orange-500",
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><GitBranch className="h-5 w-5" /> Decision Causality Graph</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Deepest Chains</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(deepest || []).map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{d.agentCodename}</Badge>
                <span className="text-xs text-muted-foreground truncate">{d.decisionSummary?.slice(0, 40)}</span>
                <Badge variant="secondary" className="ml-auto">depth {d.depth}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Most Cascading</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(cascading || []).map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{d.agentCodename}</Badge>
                <span className="text-xs text-muted-foreground truncate">{d.decisionSummary?.slice(0, 40)}</span>
                <Badge variant="secondary" className="ml-auto">{d.blastRadius} downstream</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AnticipatoryEnterprisePage() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radar className="h-6 w-6" /> Anticipatory Enterprise
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v11 — Agent negotiation, revenue attribution, cognitive modeling, and predictive orchestration
            </p>
          </div>

          <Tabs defaultValue="negotiations" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="negotiations" className="gap-1"><Swords className="h-3 w-3" /> Negotiations</TabsTrigger>
              <TabsTrigger value="attribution" className="gap-1"><DollarSign className="h-3 w-3" /> Attribution</TabsTrigger>
              <TabsTrigger value="cognitive" className="gap-1"><Brain className="h-3 w-3" /> Cognitive</TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-1"><Clock className="h-3 w-3" /> Knowledge</TabsTrigger>
              <TabsTrigger value="governor" className="gap-1"><Gauge className="h-3 w-3" /> Governor</TabsTrigger>
              <TabsTrigger value="causality" className="gap-1"><GitBranch className="h-3 w-3" /> Causality</TabsTrigger>
              <TabsTrigger value="delegation" className="gap-1"><Key className="h-3 w-3" /> Delegation</TabsTrigger>
              <TabsTrigger value="predictions" className="gap-1"><Radar className="h-3 w-3" /> Predictions</TabsTrigger>
            </TabsList>

            <TabsContent value="negotiations"><NegotiationProtocol /></TabsContent>
            <TabsContent value="attribution"><RevenueAttribution /></TabsContent>
            <TabsContent value="cognitive"><CognitiveModel /></TabsContent>
            <TabsContent value="knowledge"><KnowledgeDecay /></TabsContent>
            <TabsContent value="governor"><ResourceGovernor /></TabsContent>
            <TabsContent value="causality"><DecisionCausality /></TabsContent>
            <TabsContent value="delegation"><DelegationTokens /></TabsContent>
            <TabsContent value="predictions"><PredictiveOrchestration /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
