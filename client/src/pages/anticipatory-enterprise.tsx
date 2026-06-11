import { useId, useState, type FormEvent } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd, formatDate } from "@/lib/format";
import {
  Swords, DollarSign, Brain, Clock, Gauge, GitBranch, Key, Radar,
  Loader2, AlertTriangle, ArrowRight,
  BarChart3, XCircle,
} from "lucide-react";

const reassurance = "Your inputs are still in the form — try again.";

const AGENT_CODENAMES = [
  "forge_revenue",
  "sophie_support",
  "beacon_marketing",
  "ledger_finance",
  "shield_compliance",
  "oracle_analytics",
];

function NegotiationProtocol() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [initiator, setInitiator] = useState("forge_revenue");
  const [respondent, setRespondent] = useState("shield_compliance");
  const [position, setPosition] = useState("");
  const initiatorId = useId();
  const respondentId = useId();
  const subjectId = useId();
  const positionId = useId();

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
    onError: (e: any) => toast({ title: "Couldn't initiate negotiation", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!subject || !position || initiateMutation.isPending) return;
    initiateMutation.mutate();
  }

  const resolutionColors: Record<string, string> = {
    compromise: "bg-acr-pos", initiator_wins: "bg-acr-accent",
    respondent_wins: "bg-acr-brand", deadlocked: "bg-acr-neg", escalated: "bg-acr-warn",
  };

  return (
    <div className="space-y-4">
      {stats && (
        <dl className="grid grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.total}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Resolved</dt>
            <dd className="text-2xl font-bold text-acr-pos tabular-nums">{stats.resolved}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Escalated</dt>
            <dd className="text-2xl font-bold text-acr-warn tabular-nums">{stats.escalated}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Compromise rate</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.compromiseRate}%</dd>
          </CardContent></Card>
        </dl>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Swords className="h-4 w-4" aria-hidden="true" /> Initiate negotiation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={initiatorId} className="text-xs">Initiator</Label>
                <Select value={initiator} onValueChange={setInitiator}>
                  <SelectTrigger id={initiatorId}><SelectValue placeholder="Initiator" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_CODENAMES.map(a => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={respondentId} className="text-xs">Respondent</Label>
                <Select value={respondent} onValueChange={setRespondent}>
                  <SelectTrigger id={respondentId}><SelectValue placeholder="Respondent" /></SelectTrigger>
                  <SelectContent>
                    {AGENT_CODENAMES.map(a => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor={subjectId} className="text-xs">Subject of conflict</Label>
              <Input id={subjectId} placeholder="Subject of conflict" value={subject} onChange={e => setSubject(e.target.value)} autoCapitalize="sentences" />
            </div>
            <div>
              <Label htmlFor={positionId} className="text-xs">Initiator&apos;s position</Label>
              <Textarea id={positionId} placeholder="Initiator's position" value={position} onChange={e => setPosition(e.target.value)} rows={2} autoCapitalize="sentences" />
            </div>
            <Button type="submit" disabled={!subject || !position || initiateMutation.isPending} size="sm">
              {initiateMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" /> : <Swords className="mr-2 h-3 w-3" aria-hidden="true" />} Start negotiation
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40" /> : negotiations && negotiations.length > 0 ? (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Recent agent negotiations">
          {negotiations.map((n: any) => (
            <li key={n.id}>
              <Card className={n.status === "escalated" ? "border-acr-warn" : ""}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline" aria-label={`Initiator: ${n.initiatorAgent}`}>{n.initiatorAgent}</Badge>
                    <Swords className="h-3 w-3" aria-label="versus" />
                    <Badge variant="outline" aria-label={`Respondent: ${n.respondentAgent}`}>{n.respondentAgent}</Badge>
                    <Badge
                      variant={n.status === "resolved" ? "default" : n.status === "escalated" ? "destructive" : "secondary"}
                      aria-label={`Status: ${n.status}`}
                    >
                      {n.status}
                    </Badge>
                    {n.resolutionType && (
                      <Badge
                        className={`${resolutionColors[n.resolutionType] || ""} text-white text-xs`}
                        aria-label={`Resolution: ${n.resolutionType.replace(/_/g, " ")}`}
                      >
                        {n.resolutionType}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{n.subject}</p>
                  {n.resolution && <p className="text-xs text-muted-foreground mt-1">{n.resolution}</p>}
                  {(n.negotiationRounds || []).length > 0 && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {n.negotiationRounds.length} round{n.negotiationRounds.length === 1 ? "" : "s"}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

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
    onError: (e: any) => toast({ title: "Couldn't generate report", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5" aria-hidden="true" /> Revenue attribution</h3>
        <Button size="sm" onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending}>
          <BarChart3 className="mr-2 h-3 w-3" aria-hidden="true" /> Generate report
        </Button>
      </div>

      {reports && reports.length > 0 ? (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Revenue attribution reports">
          {reports.map((r: any) => (
            <li key={r.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {r.reportPeriod} — <span className="tabular-nums">{usd(r.totalAttributedRevenue / 100)}</span> attributed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 list-none p-0 m-0" aria-label={`Agent contributions for ${r.reportPeriod}`}>
                    {(r.agentContributions || []).map((c: any) => (
                      <li key={c.agentCodename} className="flex items-center gap-2 py-1">
                        <Badge variant="outline" className="w-32" aria-label={`Agent: ${c.agentCodename}`}>{c.agentCodename}</Badge>
                        <div
                          className="flex-1 bg-muted rounded-full h-2"
                          role="progressbar"
                          aria-valuenow={Math.round(c.avgAttribution)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${c.agentCodename}: ${Math.round(c.avgAttribution)}% average attribution`}
                        >
                          <div className="bg-acr-pos h-2 rounded-full" style={{ width: `${Math.min(100, c.avgAttribution)}%` }} />
                        </div>
                        <span className="text-xs font-mono w-24 text-right tabular-nums">{usd(c.totalRevenue / 100)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{c.actionCount} action{c.actionCount === 1 ? "" : "s"}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">No attribution reports yet. Record agent actions and attribute revenue to generate reports.</p>
      )}
    </div>
  );
}

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
  const { toast } = useToast();
  // Optimistic autopilot toggle — flips autopilotEnabled on the row so
  // the Switch + badge reflect new state instantly. Carries the row id
  // so the cached list can match by id-equality.
  const toggleMutation = useOptimisticUpdate<{ id: number; category: string; enabled: boolean }>({
    mutationFn: ({ category, enabled }) =>
      apiRequest("POST", `/api/founder/v11/cognitive/${category}/autopilot`, { enabled }),
    listKeys: [["/api/founder/v11/cognitive/models"], ["/api/founder/v11/cognitive/autopilot-eligible"]],
    getId: ({ id }) => id,
    buildPatch: ({ enabled }) => ({ autopilotEnabled: enabled }),
    successToast: false,
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Brain className="h-5 w-5" aria-hidden="true" /> CEO cognitive model</h3>

      {(eligible || []).length > 0 && (
        <Card className="border-acr-pos">
          <CardHeader><CardTitle className="text-sm text-acr-pos">Autopilot eligible</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Decision categories eligible for autopilot">
              {eligible.map((m: any) => (
                <li key={m.id} className="flex items-center justify-between py-1">
                  <span className="text-sm">{m.decisionCategory}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {Number(m.shadowAccuracy).toFixed(1)}% accuracy ({m.shadowPredictions} predictions)
                    </span>
                    <Button
                      size="sm"
                      variant={m.autopilotEnabled ? "default" : "outline"}
                      onClick={() => toggleMutation.mutate({ id: m.id, category: m.decisionCategory, enabled: !m.autopilotEnabled })}
                      aria-label={m.autopilotEnabled ? `Disable autopilot for ${m.decisionCategory}` : `Enable autopilot for ${m.decisionCategory}`}
                      aria-pressed={m.autopilotEnabled}
                    >
                      {m.autopilotEnabled ? "Autopilot on" : "Enable autopilot"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {models && models.length > 0 && (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Cognitive models per decision category">
          {models.map((m: any) => (
            <li key={m.id}>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <Badge variant="outline">{m.decisionCategory}</Badge>
                      <span className="text-xs text-muted-foreground ml-2 tabular-nums">v{m.modelVersion}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono tabular-nums">{Number(m.shadowAccuracy).toFixed(1)}% accuracy</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{m.shadowCorrect}/{m.shadowPredictions} correct</span>
                      {m.autopilotEnabled && <Badge className="bg-acr-pos text-white" aria-label="Autopilot active">Autopilot</Badge>}
                    </div>
                  </div>
                  {(m.decisionPatterns || []).length > 0 && (
                    <ul className="mt-2 space-y-1 list-none p-0 m-0" aria-label="Decision patterns">
                      {(m.decisionPatterns as any[]).slice(0, 3).map((p: any, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground">• {p.pattern}</li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
    onError: (e: any) => toast({ title: "Couldn't run decay cycle", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total patterns</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.total}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Average freshness</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.avgFreshness}%</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground text-acr-neg">Zombies</dt>
            <dd className="text-2xl font-bold text-acr-neg tabular-nums">{stats.zombies}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Stale</dt>
            <dd className="text-2xl font-bold text-acr-warn tabular-nums">{stats.stale}</dd>
          </CardContent></Card>
        </dl>
      )}

      <Button size="sm" variant="outline" onClick={() => decayMutation.mutate()} disabled={decayMutation.isPending}>
        <Clock className="mr-2 h-3 w-3" aria-hidden="true" /> Run decay cycle
      </Button>

      {(zombies || []).length > 0 && (
        <Card className="border-acr-neg">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-acr-neg" aria-hidden="true" /> Zombie patterns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0" aria-label="Stale knowledge patterns flagged as zombies">
              {zombies.map((z: any) => (
                <li key={z.id} className="flex items-center justify-between border-b pb-1 last:border-0" role="alert">
                  <div>
                    <p className="text-sm font-medium">{z.patternName}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">Used {z.usageCount}× but not validated in 6+ months</p>
                  </div>
                  <Badge variant="destructive" className="tabular-nums" aria-label={`Freshness ${Number(z.freshnessScore).toFixed(0)} percent`}>
                    {Number(z.freshnessScore).toFixed(0)}%
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
    onError: (e: any) => toast({ title: "Couldn't initialize quotas", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><Gauge className="h-5 w-5" aria-hidden="true" /> Resource governor</h3>
        <Button size="sm" variant="outline" onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>Initialize quotas</Button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : quotas && quotas.length > 0 ? (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Resource quotas per agent">
          {quotas.map((q: any) => {
            const actionsPct = Math.min(100, (q.dailyActionsUsed / q.dailyActionLimit) * 100);
            const costPct = Math.min(100, (q.dailyCostUsedCents / q.dailyCostLimitCents) * 100);
            const hourlyPct = Math.min(100, (q.hourlyActionsUsed / q.hourlyRateLimit) * 100);
            return (
              <li key={q.id}>
                <Card className={q.circuitBreakerTripped ? "border-acr-neg" : q.burstDetected ? "border-acr-warn" : ""}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" aria-label={`Agent: ${q.agentCodename}`}>{q.agentCodename}</Badge>
                      <div className="flex gap-1">
                        {q.circuitBreakerTripped && <Badge variant="destructive" aria-label="Circuit breaker tripped">CIRCUIT BREAKER</Badge>}
                        {q.burstDetected && <Badge className="bg-acr-warn text-white" aria-label="Burst detected">BURST</Badge>}
                      </div>
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Actions</dt>
                        <dd className="font-mono tabular-nums">{q.dailyActionsUsed}/{q.dailyActionLimit}</dd>
                        <div
                          className="bg-muted rounded-full h-1.5 mt-1"
                          role="progressbar"
                          aria-valuenow={Math.round(actionsPct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${q.agentCodename} daily actions used`}
                        >
                          <div className="bg-primary h-1.5 rounded-full" style={{ width: `${actionsPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Cost</dt>
                        <dd className="font-mono tabular-nums">{usd(q.dailyCostUsedCents / 100)}/{usd(q.dailyCostLimitCents / 100)}</dd>
                        <div
                          className="bg-muted rounded-full h-1.5 mt-1"
                          role="progressbar"
                          aria-valuenow={Math.round(costPct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${q.agentCodename} daily cost used`}
                        >
                          <div className="bg-acr-pos h-1.5 rounded-full" style={{ width: `${costPct}%` }} />
                        </div>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Hourly</dt>
                        <dd className="font-mono tabular-nums">{q.hourlyActionsUsed}/{q.hourlyRateLimit}</dd>
                        <div
                          className="bg-muted rounded-full h-1.5 mt-1"
                          role="progressbar"
                          aria-valuenow={Math.round(hourlyPct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${q.agentCodename} hourly rate used`}
                        >
                          <div className="bg-acr-accent h-1.5 rounded-full" style={{ width: `${hourlyPct}%` }} />
                        </div>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function DelegationTokens() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [agent, setAgent] = useState("sophie_support");
  const [scope, setScope] = useState("refunds");
  const [reason, setReason] = useState("");
  const [limitDollars, setLimitDollars] = useState("500");
  const agentId = useId();
  const scopeId = useId();
  const limitId = useId();
  const reasonId = useId();

  const { data: active } = useQuery({
    queryKey: ["/api/founder/v11/delegations/active"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/delegations/active").then(r => r.json()),
  });

  const grantMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v11/delegations", {
      agentCodename: agent, scope, reason,
      spendingLimitCents: Math.round(parseFloat(limitDollars) * 100),
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v11/delegations"] });
      toast({ title: "Delegation granted" }); setReason("");
    },
    onError: (e: any) => toast({ title: "Couldn't grant delegation", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  // Optimistic revoke — delegation status flips to revoked instantly.
  const revokeMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: ({ id }) => apiRequest("POST", `/api/founder/v11/delegations/${id}/revoke`, { reason: "CEO revoked" }),
    listKeys: [["/api/founder/v11/delegations/active"], ["/api/founder/v11/delegations"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "revoked" }),
    successToast: false,
  });

  function handleGrant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason || grantMutation.isPending || !parseFloat(limitDollars)) return;
    grantMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Key className="h-4 w-4" aria-hidden="true" /> Grant delegation</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGrant} className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor={agentId} className="text-xs">Agent</Label>
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger id={agentId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["sophie_support","forge_revenue","beacon_marketing","ledger_finance","shield_compliance"].map(a => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={scopeId} className="text-xs">Scope</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger id={scopeId}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["refunds","discounts","billing","escalation","custom"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={limitId} className="text-xs">Spending limit ($)</Label>
                <Input
                  id={limitId}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="500.00"
                  value={limitDollars}
                  onChange={e => setLimitDollars(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor={reasonId} className="text-xs">Reason for delegation</Label>
              <Input
                id={reasonId}
                placeholder="Reason for delegation"
                value={reason}
                onChange={e => setReason(e.target.value)}
                autoCapitalize="sentences"
              />
            </div>
            <Button type="submit" size="sm" disabled={!reason || grantMutation.isPending}>
              <Key className="mr-2 h-3 w-3" aria-hidden="true" /> Grant (7 days)
            </Button>
          </form>
        </CardContent>
      </Card>

      {active && active.length > 0 && (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Active delegation tokens">
          {active.map((t: any) => (
            <li key={t.id}>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{t.agentCodename}</Badge>
                      <Badge>{t.scope}</Badge>
                      {t.isStanding && <Badge variant="secondary">Standing</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums" aria-label={`${t.actionsSucceeded} succeeded, ${t.actionsFailed} failed of ${t.actionsTaken} total`}>
                        <span aria-hidden="true">{t.actionsSucceeded}✓ {t.actionsFailed}✗ of {t.actionsTaken}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeMutation.mutate({ id: t.id })}
                        aria-label={`Revoke delegation: ${t.scope} for ${t.agentCodename}`}
                      >
                        <XCircle className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires: <time dateTime={t.expiresAt}>{formatDate(t.expiresAt)}</time>
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Patterns</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalPatterns}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Staged</dt>
            <dd className="text-2xl font-bold text-acr-accent tabular-nums">{stats.stagedActions}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Triggered</dt>
            <dd className="text-2xl font-bold text-acr-pos tabular-nums">{stats.triggered}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Accuracy</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.avgAccuracy}%</dd>
          </CardContent></Card>
        </dl>
      )}

      {(staged || []).length > 0 && (
        <Card className="border-acr-accent">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Radar className="h-4 w-4 text-acr-accent animate-pulse" aria-hidden="true" /> Pre-staged actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0" aria-label="Pre-staged actions waiting on triggers">
              {staged.map((s: any) => (
                <li key={s.id} className="border-b pb-2 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{s.stagedAgent}</Badge>
                    <Badge variant="secondary" className="tabular-nums">{s.triggerConfidence}% confidence</Badge>
                  </div>
                  <p className="text-sm mt-1">{s.stagedAction}</p>
                  <p className="text-xs text-muted-foreground">Waiting for: {s.triggerPattern}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Temporal prediction patterns</CardTitle></CardHeader>
        <CardContent>
          {patterns && patterns.length > 0 ? (
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Cause-effect prediction patterns">
              {patterns.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2 border-b pb-1 last:border-0 flex-wrap">
                  <Badge variant="outline">{p.causeAgent}</Badge>
                  <ArrowRight className="h-3 w-3" aria-label="leads to" />
                  <Badge variant="outline">{p.effectAgent}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                    ~{Number(p.avgDelayHours).toFixed(0)}h delay · {(Number(p.correlationStrength) * 100).toFixed(0)}% correlation
                  </span>
                  {p.autoStageEnabled && <Badge className="bg-acr-pos text-white text-xs" aria-label="Auto-stage enabled">Auto</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No patterns yet. Register cause-effect pairs to enable predictive orchestration.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionCausality() {
  const { data: deepest } = useQuery({
    queryKey: ["/api/founder/v11/causality/deepest"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/causality/deepest").then(r => r.json()),
  });

  const { data: cascading } = useQuery({
    queryKey: ["/api/founder/v11/causality/cascading"],
    queryFn: () => apiRequest("GET", "/api/founder/v11/causality/cascading").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><GitBranch className="h-5 w-5" aria-hidden="true" /> Decision causality graph</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Deepest chains</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Decisions with the deepest causal chain">
              {(deepest || []).map((d: any) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{d.agentCodename}</Badge>
                  <span className="text-xs text-muted-foreground truncate">{d.decisionSummary?.slice(0, 40)}</span>
                  <Badge variant="secondary" className="ml-auto tabular-nums" aria-label={`Chain depth: ${d.depth}`}>depth {d.depth}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Most cascading</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Decisions with the largest blast radius">
              {(cascading || []).map((d: any) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">{d.agentCodename}</Badge>
                  <span className="text-xs text-muted-foreground truncate">{d.decisionSummary?.slice(0, 40)}</span>
                  <Badge variant="secondary" className="ml-auto tabular-nums" aria-label={`${d.blastRadius} downstream decisions`}>{d.blastRadius} downstream</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AnticipatoryEnterprisePage() {
  useDocumentTitle("Anticipatory enterprise");
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radar className="h-6 w-6" aria-hidden="true" /> Anticipatory enterprise
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v11 — agent negotiation, revenue attribution, cognitive modeling, and predictive orchestration
            </p>
          </div>

          <Tabs defaultValue="negotiations" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="negotiations" className="gap-1"><Swords className="h-3 w-3" aria-hidden="true" /> Negotiations</TabsTrigger>
              <TabsTrigger value="attribution" className="gap-1"><DollarSign className="h-3 w-3" aria-hidden="true" /> Attribution</TabsTrigger>
              <TabsTrigger value="cognitive" className="gap-1"><Brain className="h-3 w-3" aria-hidden="true" /> Cognitive</TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> Knowledge</TabsTrigger>
              <TabsTrigger value="governor" className="gap-1"><Gauge className="h-3 w-3" aria-hidden="true" /> Governor</TabsTrigger>
              <TabsTrigger value="causality" className="gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" /> Causality</TabsTrigger>
              <TabsTrigger value="delegation" className="gap-1"><Key className="h-3 w-3" aria-hidden="true" /> Delegation</TabsTrigger>
              <TabsTrigger value="predictions" className="gap-1"><Radar className="h-3 w-3" aria-hidden="true" /> Predictions</TabsTrigger>
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
