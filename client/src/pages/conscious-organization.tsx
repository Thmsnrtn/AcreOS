import { useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5" /> New Scenario Simulation</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Scenario title (e.g., 'Raise prices 20%')" value={title} onChange={e => setTitle(e.target.value)} />
          <Select value={scenarioType} onValueChange={setScenarioType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pricing">Pricing Change</SelectItem>
              <SelectItem value="hiring">Hiring Decision</SelectItem>
              <SelectItem value="market_shift">Market Shift</SelectItem>
              <SelectItem value="product_launch">Product Launch</SelectItem>
              <SelectItem value="cost_cut">Cost Reduction</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder="Hypothesis — what do you think will happen?" value={hypothesis} onChange={e => setHypothesis(e.target.value)} rows={3} />
          <Button onClick={() => simulateMutation.mutate()} disabled={!title || !hypothesis || simulateMutation.isPending}>
            {simulateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running Simulation...</> : <><Play className="mr-2 h-4 w-4" /> Launch War Room</>}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {(scenarios || []).map((s: any) => (
            <Card key={s.id} className={s.status === "running" ? "border-yellow-500" : ""}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">{s.title}</h3>
                  <Badge variant={s.status === "completed" ? "default" : "secondary"}>{s.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{s.hypothesis}</p>
                {s.consensusSummary && (
                  <div className="bg-muted/50 p-3 rounded-lg mt-2">
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
                    <p className="text-xs font-medium">Agent Projections:</p>
                    {s.agentProjections.slice(0, 4).map((p: any, i: number) => (
                      <div key={i} className="text-xs flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{p.agentCodename}</Badge>
                        <span className="text-muted-foreground truncate">{p.projection?.slice(0, 80)}...</span>
                        <Badge variant="secondary" className="ml-auto">{p.confidence}%</Badge>
                      </div>
                    ))}
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
  });

  const gradeColors: Record<string, string> = { A: "text-green-500", B: "text-blue-500", C: "text-yellow-500", D: "text-orange-500", F: "text-red-500" };

  if (isLoading) return <Skeleton className="h-60" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Health Grade</p>
            <p className={`text-4xl font-bold ${gradeColors[heartbeat?.healthGrade || "?"] || ""}`}>{heartbeat?.healthGrade || "?"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Decision Queue</p>
            <p className="text-2xl font-bold">{heartbeat?.decisionQueueDepth || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Learning Velocity</p>
            <p className="text-2xl font-bold">{heartbeat?.learningVelocity || 0}<span className="text-sm text-muted-foreground">/wk</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Coherence</p>
            <p className="text-2xl font-bold">{heartbeat?.coherenceScore || 0}%</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2">Escalation Ratio</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-full h-3">
                <div className="bg-primary h-3 rounded-full" style={{ width: `${Math.min(100, Number(heartbeat?.escalationRatio || 0))}%` }} />
              </div>
              <span className="text-sm font-mono">{Number(heartbeat?.escalationRatio || 0).toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-medium mb-2">Feedback Closure Rate</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-muted rounded-full h-3">
                <div className="bg-green-500 h-3 rounded-full" style={{ width: `${Math.min(100, Number(heartbeat?.feedbackClosureRate || 0))}%` }} />
              </div>
              <span className="text-sm font-mono">{Number(heartbeat?.feedbackClosureRate || 0).toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {(anomalies || []).length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-yellow-500" /> Active Anomalies</CardTitle></CardHeader>
          <CardContent>
            {anomalies.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 py-1">
                <Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge>
                <span className="text-sm">{a.description}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button variant="outline" size="sm" onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}>
        <RefreshCw className={`mr-2 h-3 w-3 ${snapshotMutation.isPending ? "animate-spin" : ""}`} /> Take Snapshot
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
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v10/calibration/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/calibration"] }),
  });

  const revertMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v10/calibration/${id}/revert`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/calibration"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Agent Self-Calibration</h3>
        <Button size="sm" onClick={() => cycleMutation.mutate()} disabled={cycleMutation.isPending}>
          {cycleMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />} Run Calibration Cycle
        </Button>
      </div>

      {(pending || []).length > 0 && (
        <Card className="border-blue-500">
          <CardHeader><CardTitle className="text-sm">Pending Approval ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.map((c: any) => (
              <div key={c.id} className="flex items-start justify-between border-b pb-2 last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{c.agentCodename}</Badge>
                    <span className="text-xs text-muted-foreground">{c.calibrationType}</span>
                  </div>
                  <p className="text-sm mt-1">{c.triggerReason}</p>
                  <p className="text-xs text-muted-foreground">{c.parameterName}: {c.oldValue} → {c.newValue}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(c.id)}><CheckCircle className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => revertMutation.mutate(c.id)}><AlertCircle className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Decision Quality</p>
              <p className="text-2xl font-bold">{biases.overallQuality}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Optimal Rate</p>
              <p className="text-2xl font-bold">{biases.optimalRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Replayed</p>
              <p className="text-2xl font-bold">{biases.replayedDecisions}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Biases Found</p>
              <p className="text-2xl font-bold">{(biases.biases || []).length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {(biases?.biases || []).length > 0 && (
        <Card className="border-orange-500">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" /> Detected Biases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {biases.biases.map((b: any, i: number) => (
              <div key={i} className="border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant={b.severity === "high" ? "destructive" : "secondary"}>{b.biasType.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">({b.frequency}x)</span>
                </div>
                <p className="text-sm mt-1">{b.recommendation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(biases?.agentTrustInsights || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Agent Trust Insights</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {biases.agentTrustInsights.map((a: any, i: number) => (
              <div key={i} className="text-sm flex items-center gap-2">
                <Badge variant="outline">{a.agentCodename}</Badge>
                <span className="text-muted-foreground">Overridden {a.timesOverridden}x, wrong {a.overrideWasWrong}x</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {(replays || []).map((r: any) => (
          <Card key={r.id}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2">
                <Badge variant={r.wasOptimal ? "default" : "destructive"}>{r.wasOptimal ? "Optimal" : "Suboptimal"}</Badge>
                <span className="text-sm font-medium">{r.decisionSummary?.slice(0, 60)}</span>
                {r.qualityScore != null && <Badge variant="secondary" className="ml-auto">{r.qualityScore}%</Badge>}
              </div>
              {r.hindsightAssessment && <p className="text-xs text-muted-foreground mt-1">{r.hindsightAssessment}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
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
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Resilience Score</h3>
          {score && <Badge variant={score.grade === "A" || score.grade === "B" ? "default" : "destructive"} className="text-lg px-3 py-1">{score.grade} ({score.score})</Badge>}
        </div>
        <Button size="sm" onClick={() => suiteMutation.mutate()} disabled={suiteMutation.isPending}>
          {suiteMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Shield className="mr-2 h-3 w-3" />} Run Full Suite
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-2">
          {(tests || []).map((t: any) => (
            <Card key={t.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{t.testType}</Badge>
                  <Badge variant={t.resilienceScore >= 70 ? "default" : t.resilienceScore >= 40 ? "secondary" : "destructive"}>{t.resilienceScore}/100</Badge>
                </div>
                <p className="text-sm">{t.testDescription}</p>
                {(t.singlePointsOfFailure || []).length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-red-500">{t.singlePointsOfFailure.length} SPOF(s):</p>
                    {t.singlePointsOfFailure.map((spof: any, i: number) => (
                      <p key={i} className="text-xs text-muted-foreground">• {spof.component}: {spof.risk}</p>
                    ))}
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
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Radio className="h-4 w-4 text-green-500 animate-pulse" /> Live Event Feed</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {isLoading ? <Skeleton className="h-40" /> : (
              <div className="space-y-1">
                {(events || []).map((e: any) => (
                  <div key={e.id} className="flex items-center gap-2 py-1 border-b border-border/50 last:border-0">
                    <span className="text-sm">{eventIcons[e.eventType] || "•"}</span>
                    <Badge variant="outline" className="text-xs">{e.agentCodename || "system"}</Badge>
                    <span className="text-xs font-mono text-muted-foreground">{e.eventType}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
                {(!events || events.length === 0) && <p className="text-sm text-muted-foreground text-center py-8">No events yet. Start the nervous system heartbeat to see activity.</p>}
              </div>
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
  });

  const forceMutation = useMutation({
    mutationFn: (mode: string) => apiRequest("POST", "/api/founder/v10/surface/force", { mode }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v10/surface"] });
      toast({ title: `Forced mode: ${data.contextMode}` });
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
            <Layers className="h-5 w-5" />
            Current Mode: <Badge className="text-sm">{modeIcons[surface?.contextMode || "default"]} {surface?.contextMode || "default"}</Badge>
          </h3>
          {surface?.triggerReason && <p className="text-xs text-muted-foreground mt-1">{surface.triggerReason}</p>}
        </div>
        <Button size="sm" onClick={() => detectMutation.mutate()} disabled={detectMutation.isPending}>
          <Gauge className="mr-2 h-3 w-3" /> Auto-Detect
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(modes || []).map((m: string) => (
          <Button key={m} size="sm" variant={surface?.contextMode === m ? "default" : "outline"} onClick={() => forceMutation.mutate(m)}>
            {modeIcons[m] || "•"} {m.replace(/_/g, " ")}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-green-600">Active Layers</CardTitle></CardHeader>
          <CardContent>
            {(surface?.activeLayers || []).map((l: string) => (
              <div key={l} className="flex items-center gap-2 py-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                <span className="text-sm">{layers?.[l] || l}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Suppressed</CardTitle></CardHeader>
          <CardContent>
            {(surface?.suppressedLayers || []).map((l: string) => (
              <div key={l} className="flex items-center gap-2 py-1">
                <AlertCircle className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{layers?.[l] || l}</span>
              </div>
            ))}
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
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">This Week</p>
              <p className="text-2xl font-bold">{velocity.thisWeek}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Last Week</p>
              <p className="text-2xl font-bold">{velocity.lastWeek}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Trend</p>
              <Badge variant={velocity.trend === "accelerating" ? "default" : velocity.trend === "steady" ? "secondary" : "destructive"}>{velocity.trend}</Badge>
            </CardContent>
          </Card>
        </div>
      )}

      {(calibration || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Agent Calibration Accuracy</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {calibration.map((c: any) => (
              <div key={c.agentCodename} className="flex items-center gap-2">
                <Badge variant="outline" className="w-32">{c.agentCodename}</Badge>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className={`h-2 rounded-full ${c.isOverconfident ? "bg-orange-500" : "bg-green-500"}`} style={{ width: `${c.actualSuccessRate}%` }} />
                </div>
                <span className="text-xs font-mono w-20 text-right">
                  {c.actualSuccessRate}% real / {c.averageConfidence}% pred
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent Learning Propagations</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(propagations || []).map((p: any) => (
            <div key={p.id} className="border-b pb-2 last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{p.sourceAgent}</Badge>
                <ArrowRight className="h-3 w-3" />
                <span className="text-xs text-muted-foreground">{(p.targetAgents || []).join(", ")}</span>
              </div>
              <p className="text-sm mt-1">{p.learning}</p>
              <Badge variant="secondary" className="text-xs mt-1">{p.learningType}</Badge>
            </div>
          ))}
          {(!propagations || propagations.length === 0) && <p className="text-sm text-muted-foreground text-center py-4">No learnings propagated yet. Measure outcomes to trigger the loop.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ConsciousOrganizationPage() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" /> Conscious Organization
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v10 — Organizational self-awareness, closed-loop learning, and adaptive intelligence
            </p>
          </div>

          <Tabs defaultValue="heartbeat" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="heartbeat" className="gap-1"><Heart className="h-3 w-3" /> Heartbeat</TabsTrigger>
              <TabsTrigger value="war-room" className="gap-1"><Target className="h-3 w-3" /> War Room</TabsTrigger>
              <TabsTrigger value="learning" className="gap-1"><TrendingUp className="h-3 w-3" /> Learning</TabsTrigger>
              <TabsTrigger value="calibration" className="gap-1"><Sparkles className="h-3 w-3" /> Calibration</TabsTrigger>
              <TabsTrigger value="decisions" className="gap-1"><Eye className="h-3 w-3" /> Decisions</TabsTrigger>
              <TabsTrigger value="resilience" className="gap-1"><Shield className="h-3 w-3" /> Resilience</TabsTrigger>
              <TabsTrigger value="nervous" className="gap-1"><Zap className="h-3 w-3" /> Nervous System</TabsTrigger>
              <TabsTrigger value="surface" className="gap-1"><Layers className="h-3 w-3" /> Surface</TabsTrigger>
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
