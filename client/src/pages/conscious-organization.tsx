import { useId, useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { Label } from "@/components/ui/label";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Activity,
  Heart,
  Target,
  Sparkles,
  Shield,
  Zap,
  Eye,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Play,
  RefreshCw,
  TrendingUp,
  BarChart3,
  Layers,
  Radio,
  Gauge,
} from "lucide-react";

// ─── Scenario War Room Tab ──────────────────────────────────────────────────

function ScenarioWarRoom() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [scenarioType, setScenarioType] = useState("custom");
  const titleId = useId();
  const typeId = useId();
  const hypothesisId = useId();

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/scenarios"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/scenarios").then(r => r.json()),
  });

  const simulateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v10/scenarios/simulate", {
      title, hypothesis, scenarioType, parameters: {},
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/scenarios"] });
      toast({ title: "Simulation complete", description: "All agents have modeled the scenario" });
      setTitle(""); setHypothesis("");
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't run simulation", description: "Your draft is preserved. Try again or check the system status." });
    },
  });

  const canSubmit = !!title && !!hypothesis && !simulateMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" aria-hidden="true" /> New scenario simulation</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (canSubmit) simulateMutation.mutate(); }}
          >
            <div className="space-y-1">
              <Label htmlFor={titleId}>Scenario title</Label>
              <Input id={titleId} placeholder="e.g., Raise prices 20%" value={title} onChange={e => setTitle(e.target.value)} autoCapitalize="sentences" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={typeId}>Scenario type</Label>
              <Select value={scenarioType} onValueChange={setScenarioType}>
                <SelectTrigger id={typeId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pricing">Pricing change</SelectItem>
                  <SelectItem value="hiring">Hiring decision</SelectItem>
                  <SelectItem value="market_shift">Market shift</SelectItem>
                  <SelectItem value="product_launch">Product launch</SelectItem>
                  <SelectItem value="cost_cut">Cost reduction</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={hypothesisId}>Hypothesis</Label>
              <Textarea id={hypothesisId} placeholder="What do you think will happen?" value={hypothesis} onChange={e => setHypothesis(e.target.value)} rows={3} autoCapitalize="sentences" />
            </div>
            <Button type="submit" disabled={!canSubmit}>
              {simulateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> Running simulation…</> : <><Play className="mr-2 h-4 w-4" aria-hidden="true" /> Launch war room</>}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {(scenarios || []).map((s: any) => (
            <Card key={s.id} className={s.status === "running" ? "border-acr-warn" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{s.title}</h3>
                  <Badge variant={s.status === "completed" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{s.hypothesis}</p>
                {s.consensusSummary && (
                  <div className="bg-muted/50 p-3 rounded-card mt-2">
                    <p className="text-sm font-medium mb-1">Consensus:</p>
                    <p className="text-sm">{s.consensusSummary}</p>
                    {s.consensusRecommendation && <p className="text-sm font-medium mt-2 text-primary">{s.consensusRecommendation}</p>}
                  </div>
                )}
                {s.confidenceInterval && (
                  <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Low: {s.confidenceInterval.low}%</span>
                    <span>Mid: {s.confidenceInterval.mid}%</span>
                    <span>High: {s.confidenceInterval.high}%</span>
                  </div>
                )}
                {(s.agentProjections || []).length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium">Agent projections:</p>
                    <ul className="space-y-1 list-none p-0 m-0">
                      {s.agentProjections.slice(0, 4).map((p: any, i: number) => (
                        <li key={i} className="text-xs flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{p.agentCodename}</Badge>
                          <span className="text-muted-foreground truncate">{p.projection?.slice(0, 80)}…</span>
                          <Badge variant="secondary" className="ml-auto tabular-nums" aria-label={`Confidence ${p.confidence} percent`}>{p.confidence}%</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Heartbeat Monitor Tab ──────────────────────────────────────────────────

function HeartbeatMonitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: heartbeat, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/heartbeat"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/heartbeat").then(r => r.json()),
  });

  const { data: anomalies } = useQuery({
    queryKey: ["/api/founder/v10/heartbeat/anomalies"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/heartbeat/anomalies").then(r => r.json()),
  });

  const snapshotMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v10/heartbeat/snapshot", { type: "hourly" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/heartbeat"] });
      toast({ title: "Heartbeat taken" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't take heartbeat snapshot", description: "Try again or check the system status." });
    },
  });

  const gradeColors: Record<string, string> = { A: "text-acr-pos", B: "text-acr-accent", C: "text-acr-warn", D: "text-acr-warn", F: "text-acr-neg" };

  if (isLoading) return <Skeleton className="h-60" />;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 m-0">
        <Card>
          <CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Health grade</dt>
            <dd className={`text-4xl font-bold tabular-nums m-0 ${gradeColors[heartbeat?.healthGrade || "?"] || ""}`}>{heartbeat?.healthGrade || "?"}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Decision queue</dt>
            <dd className="text-2xl font-bold tabular-nums m-0">{heartbeat?.decisionQueueDepth || 0}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Learning velocity</dt>
            <dd className="text-2xl font-bold tabular-nums m-0">{heartbeat?.learningVelocity || 0}<span className="text-sm text-muted-foreground">/wk</span></dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground mb-1">Coherence</dt>
            <dd className="text-2xl font-bold tabular-nums m-0">{heartbeat?.coherenceScore || 0}%</dd>
          </CardContent>
        </Card>
      </dl>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2">Escalation ratio</p>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 bg-muted rounded-full h-3"
                role="progressbar"
                aria-label="Escalation ratio"
                aria-valuenow={Number(heartbeat?.escalationRatio || 0)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="bg-primary h-3 rounded-full" style={{ width: `${Math.min(100, Number(heartbeat?.escalationRatio || 0))}%` }} />
              </div>
              <span className="text-sm font-mono tabular-nums">{Number(heartbeat?.escalationRatio || 0).toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2">Feedback closure rate</p>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 bg-muted rounded-full h-3"
                role="progressbar"
                aria-label="Feedback closure rate"
                aria-valuenow={Number(heartbeat?.feedbackClosureRate || 0)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="bg-acr-pos h-3 rounded-full" style={{ width: `${Math.min(100, Number(heartbeat?.feedbackClosureRate || 0))}%` }} />
              </div>
              <span className="text-sm font-mono tabular-nums">{Number(heartbeat?.feedbackClosureRate || 0).toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {(anomalies || []).length > 0 && (
        <Card className="border-acr-warn" role="alert">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-acr-warn" aria-hidden="true" /> Active anomalies</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-none p-0 m-0">
              {anomalies.map((a: any, i: number) => (
                <li key={i} className="flex items-center gap-2 py-1">
                  <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} aria-label={`Severity: ${a.severity}`}>{a.severity}</Badge>
                  <span className="text-sm">{a.description}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Button variant="outline" size="sm" onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending} aria-label="Take heartbeat snapshot">
        <RefreshCw className={`mr-2 h-3 w-3 ${snapshotMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" /> Take snapshot
      </Button>
    </div>
  );
}

// ─── Self-Calibration Tab ───────────────────────────────────────────────────

function SelfCalibration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: pending, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/calibration/pending"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/calibration/pending").then(r => r.json()),
  });

  const { data: recent } = useQuery({
    queryKey: ["/api/founder/v10/calibration"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/calibration?limit=10").then(r => r.json()),
  });

  const cycleMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v10/calibration/cycle").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/calibration"] });
      toast({ title: `Calibration cycle complete`, description: `${data.length} agents self-calibrated` });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't run calibration cycle", description: "No agents were calibrated. Try again or check the system status." });
    },
  });

  // Optimistic calibration status flip — pending list retires the row
  // instantly so the founder can move on to the next decision.
  const approveMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: ({ id }) => apiRequest("POST", `/api/founder/v10/calibration/${id}/approve`),
    listKeys: [["/api/founder/v10/calibration"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "approved" }),
    successToast: { title: "Calibration approved" },
  });

  const revertMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: ({ id }) => apiRequest("POST", `/api/founder/v10/calibration/${id}/revert`),
    listKeys: [["/api/founder/v10/calibration"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "reverted" }),
    successToast: { title: "Calibration reverted" },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Agent self-calibration</h3>
        <Button size="sm" onClick={() => cycleMutation.mutate()} disabled={cycleMutation.isPending}>
          {cycleMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-2 h-3 w-3" aria-hidden="true" />} Run calibration cycle
        </Button>
      </div>

      {(pending || []).length > 0 && (
        <Card className="border-acr-accent">
          <CardHeader><CardTitle className="text-sm">Pending approval ({pending.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0">
              {pending.map((c: any) => (
                <li key={c.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{c.agentCodename}</Badge>
                      <span className="text-xs text-muted-foreground">{c.calibrationType}</span>
                    </div>
                    <p className="text-sm mt-1">{c.triggerReason}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{c.parameterName}: {c.oldValue} → {c.newValue}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => approveMutation.mutate({ id: c.id })} aria-label={`Approve calibration for ${c.agentCodename}`}><CheckCircle className="h-3 w-3" aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => revertMutation.mutate({ id: c.id })} aria-label={`Revert calibration for ${c.agentCodename}`}><AlertCircle className="h-3 w-3" aria-hidden="true" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-2">
          {(recent || []).map((c: any) => (
            <Card key={c.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === "approved" ? "default" : c.status === "reverted" ? "destructive" : "secondary"}>{c.status}</Badge>
                  <Badge variant="outline">{c.agentCodename}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{c.calibrationType}</span>
                </div>
                <p className="text-sm mt-1">{c.triggerReason}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Decision Replay Tab ────────────────────────────────────────────────────

function DecisionReplay() {
  const { data: biases, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/decisions/biases"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/decisions/biases").then(r => r.json()),
  });

  const { data: replays } = useQuery({
    queryKey: ["/api/founder/v10/decisions/replays"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/decisions/replays?limit=10").then(r => r.json()),
  });

  if (isLoading) return <Skeleton className="h-60" />;

  return (
    <div className="space-y-4">
      {biases && biases.replayedDecisions > 0 && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 m-0">
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Decision quality</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{biases.overallQuality}%</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Optimal rate</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{biases.optimalRate}%</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Replayed</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{biases.replayedDecisions}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Biases found</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{(biases.biases || []).length}</dd>
            </CardContent>
          </Card>
        </dl>
      )}

      {(biases?.biases || []).length > 0 && (
        <Card className="border-acr-warn">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" aria-hidden="true" /> Detected biases</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0">
              {biases.biases.map((b: any, i: number) => (
                <li key={i} className="border-b pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={b.severity === "high" ? "destructive" : "secondary"} aria-label={`Bias type: ${b.biasType.replace(/_/g, " ")}`}>{b.biasType.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">({b.frequency}×)</span>
                  </div>
                  <p className="text-sm mt-1">{b.recommendation}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(biases?.agentTrustInsights || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Agent trust insights</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0">
              {biases.agentTrustInsights.map((a: any, i: number) => (
                <li key={i} className="text-sm flex items-center gap-2">
                  <Badge variant="outline">{a.agentCodename}</Badge>
                  <span className="text-muted-foreground tabular-nums">Overridden {a.timesOverridden}×, wrong {a.overrideWasWrong}×</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2 list-none p-0 m-0">
        {(replays || []).map((r: any) => (
          <li key={r.id}>
            <Card>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={r.wasOptimal ? "default" : "destructive"}>{r.wasOptimal ? "Optimal" : "Suboptimal"}</Badge>
                  <span className="text-sm font-medium">{r.decisionSummary?.slice(0, 60)}</span>
                  {r.qualityScore != null && <Badge variant="secondary" className="ml-auto tabular-nums" aria-label={`Quality score ${r.qualityScore} percent`}>{r.qualityScore}%</Badge>}
                </div>
                {r.hindsightAssessment && <p className="text-xs text-muted-foreground mt-1">{r.hindsightAssessment}</p>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Resilience Testing Tab ─────────────────────────────────────────────────

function ResilienceTesting() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tests, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/resilience"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/resilience").then(r => r.json()),
  });

  const { data: score } = useQuery({
    queryKey: ["/api/founder/v10/resilience/score"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/resilience/score").then(r => r.json()),
  });

  const suiteMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v10/resilience/full-suite").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/resilience"] });
      toast({ title: "Resilience suite complete", description: `Overall score: ${data.overallScore}, ${data.criticalSpofs.length} SPOFs found` });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't run resilience suite", description: "No tests were executed. Try again or check the system status." });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Resilience score</h3>
          {score && <Badge variant={score.grade === "A" || score.grade === "B" ? "default" : "destructive"} className="text-lg px-3 py-1 tabular-nums" aria-label={`Resilience grade ${score.grade}, score ${score.score}`}>{score.grade} ({score.score})</Badge>}
        </div>
        <Button size="sm" onClick={() => suiteMutation.mutate()} disabled={suiteMutation.isPending}>
          {suiteMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden="true" /> : <Shield className="mr-2 h-3 w-3" aria-hidden="true" />} Run full suite
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : (
        <ul className="space-y-2 list-none p-0 m-0">
          {(tests || []).map((t: any) => (
            <li key={t.id}>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline">{t.testType}</Badge>
                    <Badge variant={t.resilienceScore >= 70 ? "default" : t.resilienceScore >= 40 ? "secondary" : "destructive"} className="tabular-nums" aria-label={`Resilience score ${t.resilienceScore} of 100`}>{t.resilienceScore}/100</Badge>
                  </div>
                  <p className="text-sm">{t.testDescription}</p>
                  {(t.singlePointsOfFailure || []).length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-acr-neg">{t.singlePointsOfFailure.length} SPOF{t.singlePointsOfFailure.length === 1 ? "" : "s"}:</p>
                      <ul className="list-none p-0 m-0">
                        {t.singlePointsOfFailure.map((spof: any, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground">• {spof.component}: {spof.risk}</li>
                        ))}
                      </ul>
                    </div>
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

// ─── Nervous System Tab ─────────────────────────────────────────────────────

function NervousSystem() {
  const { data: events, isLoading } = useQuery({
    queryKey: ["/api/founder/v10/nervous-system/events"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/nervous-system/events?limit=30").then(r => r.json()),
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v10/nervous-system/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/nervous-system/stats").then(r => r.json()),
  });

  const eventIcons: Record<string, string> = {
    "agent.thinking": "🧠",
    "agent.action.started": "⚡",
    "agent.action.completed": "✅",
    "agent.escalation": "🚨",
    "agent.calibrated": "🔧",
    "goal.progress": "📈",
    "learning.propagated": "💡",
    "briefing.ready": "📋",
    "system.heartbeat": "💓",
    "system.anomaly": "⚠️",
  };

  return (
    <div className="space-y-4">
      {stats && Object.keys(stats).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats).map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-xs">
              {eventIcons[type] || "•"} {type.split(".").pop()}: {count as number}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Radio className="h-4 w-4 text-acr-pos animate-pulse" aria-hidden="true" /> Live event feed</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {isLoading ? <Skeleton className="h-40" /> : (
              <ol role="log" aria-live="polite" aria-label="Live nervous-system event feed" className="space-y-1 list-none p-0 m-0">
                {(events || []).map((e: any) => (
                  <li key={e.id} className="flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                    <span className="text-sm" aria-hidden="true">{eventIcons[e.eventType] || "•"}</span>
                    <Badge variant="outline" className="text-xs">{e.agentCodename || "system"}</Badge>
                    <span className="text-xs font-mono text-muted-foreground">{e.eventType}</span>
                    <time dateTime={new Date(e.createdAt).toISOString()} className="text-xs text-muted-foreground ml-auto tabular-nums">{new Date(e.createdAt).toLocaleTimeString()}</time>
                  </li>
                ))}
                {(!events || events.length === 0) && <li className="text-sm text-muted-foreground text-center py-8 list-none">No events yet. Start the nervous-system heartbeat to see activity.</li>}
              </ol>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Adaptive Surface Tab ───────────────────────────────────────────────────

function AdaptiveSurface() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: surface } = useQuery({
    queryKey: ["/api/founder/v10/surface"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/surface").then(r => r.json()),
  });

  const { data: layers } = useQuery({
    queryKey: ["/api/founder/v10/surface/layers"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/surface/layers").then(r => r.json()),
  });

  const { data: modes } = useQuery({
    queryKey: ["/api/founder/v10/surface/modes"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/surface/modes").then(r => r.json()),
  });

  const detectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v10/surface/detect").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/surface"] });
      toast({ title: `Context: ${data.contextMode}`, description: data.triggerReason });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't auto-detect mode", description: "The active context is unchanged. Try again." });
    },
  });

  const forceMutation = useMutation({
    mutationFn: (mode: string) => apiRequest("POST", "/api/founder/v10/surface/force", { mode }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/surface"] });
      toast({ title: `Forced mode: ${data.contextMode}` });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Couldn't switch mode", description: "The active context is unchanged. Try again." });
    },
  });

  const modeIcons: Record<string, string> = {
    morning: "🌅", crisis: "🚨", deep_work: "🎯", end_of_week: "📊", returning: "👋", default: "📱",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" aria-hidden="true" />
            Current mode: <Badge className="text-sm" aria-label={`Current mode ${surface?.contextMode || "default"}`}><span aria-hidden="true">{modeIcons[surface?.contextMode || "default"]} </span>{surface?.contextMode || "default"}</Badge>
          </h3>
          {surface?.triggerReason && <p className="text-xs text-muted-foreground mt-1">{surface.triggerReason}</p>}
        </div>
        <Button size="sm" onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending} aria-label="Auto-detect context mode">
          <Gauge className="mr-2 h-3 w-3" aria-hidden="true" /> Auto-detect
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Force context mode">
        {(modes || []).map((m: string) => (
          <Button key={m} size="sm" variant={surface?.contextMode === m ? "default" : "outline"} onClick={() => forceMutation.mutate(m)} aria-pressed={surface?.contextMode === m} aria-label={`Switch to ${m.replace(/_/g, " ")} mode`}>
            <span aria-hidden="true">{modeIcons[m] || "•"} </span>{m.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-acr-pos">Active layers</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-none p-0 m-0">
              {(surface?.activeLayers || []).map((l: string) => (
                <li key={l} className="flex items-center gap-2 py-1">
                  <CheckCircle className="h-3 w-3 text-acr-pos" aria-hidden="true" />
                  <span className="text-sm">{layers?.[l] || l}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Suppressed</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-none p-0 m-0">
              {(surface?.suppressedLayers || []).map((l: string) => (
                <li key={l} className="flex items-center gap-2 py-1">
                  <AlertCircle className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">{layers?.[l] || l}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Learning Engine Tab ────────────────────────────────────────────────────

function LearningEngine() {
  const { data: velocity } = useQuery({
    queryKey: ["/api/founder/v10/learning/velocity"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/learning/velocity").then(r => r.json()),
  });

  const { data: calibration } = useQuery({
    queryKey: ["/api/founder/v10/learning/calibration"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/learning/calibration").then(r => r.json()),
  });

  const { data: propagations } = useQuery({
    queryKey: ["/api/founder/v10/learning/propagations"],
    queryFn: () => apiRequest("GET", "/api/founder/v10/learning/propagations?limit=10").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      {velocity && (
        <dl className="grid grid-cols-3 gap-3 m-0">
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">This week</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{velocity.thisWeek}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Last week</dt>
              <dd className="text-2xl font-bold tabular-nums m-0">{velocity.lastWeek}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <dt className="text-xs text-muted-foreground mb-1">Trend</dt>
              <dd className="m-0"><Badge variant={velocity.trend === "accelerating" ? "default" : velocity.trend === "steady" ? "secondary" : "destructive"} aria-label={`Learning trend: ${velocity.trend}`}>{velocity.trend}</Badge></dd>
            </CardContent>
          </Card>
        </dl>
      )}

      {(calibration || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Agent calibration accuracy</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0">
              {calibration.map((c: any) => (
                <li key={c.agentCodename} className="flex items-center gap-2">
                  <Badge variant="outline" className="w-32">{c.agentCodename}</Badge>
                  <div
                    className="flex-1 bg-muted rounded-full h-2"
                    role="progressbar"
                    aria-label={`${c.agentCodename} actual success rate`}
                    aria-valuenow={Number(c.actualSuccessRate) || 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div className={`h-2 rounded-full ${c.isOverconfident ? "bg-acr-warn" : "bg-acr-pos"}`} style={{ width: `${c.actualSuccessRate}%` }} />
                  </div>
                  <span className="text-xs font-mono tabular-nums w-20 text-right">
                    {c.actualSuccessRate}% real / {c.averageConfidence}% pred
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent learning propagations</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 list-none p-0 m-0">
            {(propagations || []).map((p: any) => (
              <li key={p.id} className="border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{p.sourceAgent}</Badge>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">{(p.targetAgents || []).join(", ")}</span>
                </div>
                <p className="text-sm mt-1">{p.learning}</p>
                <Badge variant="secondary" className="text-xs mt-1">{p.learningType}</Badge>
              </li>
            ))}
            {(!propagations || propagations.length === 0) && <li className="text-sm text-muted-foreground text-center py-4 list-none">No learnings propagated yet. Measure outcomes to trigger the loop.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ConsciousOrganizationPage() {
  useDocumentTitle("Conscious organization");
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" aria-hidden="true" /> Conscious organization
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v10 — Organizational self-awareness, closed-loop learning, and adaptive intelligence
            </p>
          </div>

          <Tabs defaultValue="heartbeat" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="heartbeat" className="gap-1"><Heart className="h-3 w-3" aria-hidden="true" /> Heartbeat</TabsTrigger>
              <TabsTrigger value="war-room" className="gap-1"><Target className="h-3 w-3" aria-hidden="true" /> War room</TabsTrigger>
              <TabsTrigger value="learning" className="gap-1"><TrendingUp className="h-3 w-3" aria-hidden="true" /> Learning</TabsTrigger>
              <TabsTrigger value="calibration" className="gap-1"><Sparkles className="h-3 w-3" aria-hidden="true" /> Calibration</TabsTrigger>
              <TabsTrigger value="decisions" className="gap-1"><Eye className="h-3 w-3" aria-hidden="true" /> Decisions</TabsTrigger>
              <TabsTrigger value="resilience" className="gap-1"><Shield className="h-3 w-3" aria-hidden="true" /> Resilience</TabsTrigger>
              <TabsTrigger value="nervous" className="gap-1"><Zap className="h-3 w-3" aria-hidden="true" /> Nervous system</TabsTrigger>
              <TabsTrigger value="surface" className="gap-1"><Layers className="h-3 w-3" aria-hidden="true" /> Surface</TabsTrigger>
            </TabsList>

            <TabsContent value="heartbeat"><HeartbeatMonitor /></TabsContent>
            <TabsContent value="war-room"><ScenarioWarRoom /></TabsContent>
            <TabsContent value="learning"><LearningEngine /></TabsContent>
            <TabsContent value="calibration"><SelfCalibration /></TabsContent>
            <TabsContent value="decisions"><DecisionReplay /></TabsContent>
            <TabsContent value="resilience"><ResilienceTesting /></TabsContent>
            <TabsContent value="nervous"><NervousSystem /></TabsContent>
            <TabsContent value="surface"><AdaptiveSurface /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
