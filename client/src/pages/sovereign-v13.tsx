import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Brain,
  Target,
  Users,
  HeartPulse,
  Shield,
  Lightbulb,
  Activity,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Zap,
  MessageSquare,
  FlaskConical,
  BookOpen,
  Sparkles,
  ArrowRight,
  RefreshCw,
  BarChart3,
  Eye,
  Network,
  Flame,
  FileText,
} from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

// ─── Types ───────────────────────────────────────────────────────────

type PillarTab = "memory" | "strategy" | "collaboration" | "healing" | "governance" | "intelligence";

// ─── Main Component ──────────────────────────────────────────────────

export default function SovereignV13Page() {
  const [activeTab, setActiveTab] = useState<PillarTab>("intelligence");
  const [pendingAction, setPendingAction] = useState<"consolidate" | "cleanup" | null>(null);
  const { toast } = useToast();

  // ─── Queries ─────────────────────────────────────────────────────

  const { data: memoryStats } = useQuery({
    queryKey: ["/api/founder/v13/memory/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/memory/stats").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: strategyStats } = useQuery({
    queryKey: ["/api/founder/v13/strategies/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/strategies/stats").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: collaborationStats } = useQuery({
    queryKey: ["/api/founder/v13/collaboration/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/collaboration/stats").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: healthDashboard } = useQuery({
    queryKey: ["/api/founder/v13/health/dashboard"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/health/dashboard").then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: healthStats } = useQuery({
    queryKey: ["/api/founder/v13/health/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/health/stats").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: governanceStats } = useQuery({
    queryKey: ["/api/founder/v13/governance/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/governance/stats").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: anomalies } = useQuery({
    queryKey: ["/api/founder/v13/health/anomalies"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/health/anomalies").then(r => r.json()),
    refetchInterval: 15000,
  });

  const { data: activeDialogues } = useQuery({
    queryKey: ["/api/founder/v13/dialogues"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/dialogues").then(r => r.json()),
    refetchInterval: 20000,
  });

  const { data: policies } = useQuery({
    queryKey: ["/api/founder/v13/governance/policies"],
    queryFn: () => apiRequest("GET", "/api/founder/v13/governance/policies").then(r => r.json()),
    refetchInterval: 60000,
  });

  // ─── Mutations ───────────────────────────────────────────────────

  const consolidateMutation = useMutation({
    mutationFn: (codename: string) => apiRequest("POST", `/api/founder/v13/memory/consolidate/${codename}`).then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Memory Consolidated", description: `${data.factsCreated} facts created, ${data.episodesDecayed} episodes decayed, ${data.episodesArchived} archived` });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v13/memory/stats"] });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v13/memory/cleanup").then(r => r.json()),
    onSuccess: (data) => {
      toast({ title: "Working Memory Cleaned", description: `${data.deleted} expired entries removed` });
    },
  });

  // ─── Pillar Summary Cards ───────────────────────────────────────

  const pillars = [
    {
      id: "memory" as PillarTab,
      icon: Brain,
      title: "Cognitive Memory",
      subtitle: "Remember, learn, forget",
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      stats: memoryStats ? [
        { label: "Episodic", value: memoryStats.episodicCount ?? 0 },
        { label: "Semantic", value: memoryStats.semanticCount ?? 0 },
        { label: "Working", value: memoryStats.workingCount ?? 0 },
      ] : [],
    },
    {
      id: "strategy" as PillarTab,
      icon: Target,
      title: "Adaptive Strategy",
      subtitle: "Evolve & optimize",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      stats: strategyStats ? [
        { label: "Strategies", value: strategyStats.totalStrategies ?? 0 },
        { label: "Active", value: strategyStats.activeStrategies ?? 0 },
        { label: "Proposals", value: strategyStats.pendingProposals ?? 0 },
      ] : [],
    },
    {
      id: "collaboration" as PillarTab,
      icon: Users,
      title: "Collaboration",
      subtitle: "Negotiate & delegate",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      stats: collaborationStats ? [
        { label: "Dialogues", value: collaborationStats.activeDialogues ?? 0 },
        { label: "Delegations", value: collaborationStats.totalDelegations ?? 0 },
        { label: "Skills", value: collaborationStats.skillsRegistered ?? 0 },
      ] : [],
    },
    {
      id: "healing" as PillarTab,
      icon: HeartPulse,
      title: "Self-Healing",
      subtitle: "Detect, heal, harden",
      color: "text-red-500",
      bgColor: "bg-red-500/10",
      stats: healthStats ? [
        { label: "Anomalies", value: healthStats.unresolvedAnomalies ?? 0 },
        { label: "Playbooks", value: healthStats.playbooksCount ?? 0 },
        { label: "Experiments", value: healthStats.chaosExperiments ?? 0 },
      ] : [],
    },
    {
      id: "governance" as PillarTab,
      icon: Shield,
      title: "Governance",
      subtitle: "Comply & explain",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      stats: governanceStats ? [
        { label: "Policies", value: governanceStats.activePolicies ?? 0 },
        { label: "Evaluations", value: governanceStats.totalEvaluations ?? 0 },
        { label: "Score", value: governanceStats.avgScore ?? 100 },
      ] : [],
    },
    {
      id: "intelligence" as PillarTab,
      icon: Lightbulb,
      title: "Founder Intelligence",
      subtitle: "Insights & foresight",
      color: "text-cyan-500",
      bgColor: "bg-cyan-500/10",
      stats: [],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-gradient-to-r from-background via-background to-purple-500/5">
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Sovereign Company Protocol v13</h1>
              <p className="text-sm text-muted-foreground">The Sentient Enterprise — Agents that remember, adapt, collaborate, heal, comply, and explain</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6 space-y-6">

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Advanced system monitoring</AlertTitle>
          <AlertDescription>
            This page is for technical review only — your system manages these automatically. No action is needed from you.
          </AlertDescription>
        </Alert>

        {/* Pillar Summary Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {pillars.map((pillar) => (
            <Card
              key={pillar.id}
              className={`cursor-pointer transition-all hover:shadow-md ${activeTab === pillar.id ? "ring-2 ring-primary shadow-md" : ""}`}
              onClick={() => setActiveTab(pillar.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-1.5 rounded-lg ${pillar.bgColor}`}>
                    <pillar.icon className={`h-4 w-4 ${pillar.color}`} />
                  </div>
                  <span className="text-xs font-semibold truncate">{pillar.title}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{pillar.subtitle}</p>
                <div className="space-y-1">
                  {pillar.stats.map((s) => (
                    <div key={s.label} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="font-mono font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Active Tab Content */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PillarTab)}>
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="memory"><Brain className="h-3 w-3 mr-1" />Memory</TabsTrigger>
            <TabsTrigger value="strategy"><Target className="h-3 w-3 mr-1" />Strategy</TabsTrigger>
            <TabsTrigger value="collaboration"><Users className="h-3 w-3 mr-1" />Collab</TabsTrigger>
            <TabsTrigger value="healing"><HeartPulse className="h-3 w-3 mr-1" />Healing</TabsTrigger>
            <TabsTrigger value="governance"><Shield className="h-3 w-3 mr-1" />Governance</TabsTrigger>
            <TabsTrigger value="intelligence"><Lightbulb className="h-3 w-3 mr-1" />Intel</TabsTrigger>
          </TabsList>

          {/* ─── Memory Tab ─────────────────────────────────────────── */}
          <TabsContent value="memory" className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-purple-500" />
                    <InfoTooltip term="Episodic Memory" explanation="Timestamped records of things your system has done.">Episodic Memory</InfoTooltip>
                  </CardTitle>
                  <CardDescription>Timestamped experiences</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{memoryStats?.episodicCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Avg relevance: {memoryStats?.avgRelevance ?? 0}%
                  </p>
                  <div className="mt-3 space-y-2">
                    {(memoryStats?.topCategories ?? []).slice(0, 3).map((cat: any) => (
                      <div key={cat.category} className="flex justify-between text-xs">
                        <span>{cat.category}</span>
                        <Badge variant="secondary" className="text-[10px]">{cat.count}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="h-4 w-4 text-purple-500" />
                    <InfoTooltip term="Semantic Memory" explanation="Facts and knowledge your system has learned over time.">Semantic Memory</InfoTooltip>
                  </CardTitle>
                  <CardDescription>Distilled facts & patterns</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{memoryStats?.semanticCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Shared facts: {memoryStats?.sharedFacts ?? 0}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-500" />
                    <InfoTooltip term="Working Memory" explanation="Information your system is actively thinking about right now.">Working Memory</InfoTooltip>
                  </CardTitle>
                  <CardDescription>Active scratchpads</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{memoryStats?.workingCount ?? 0}</div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPendingAction("consolidate")}>
                      <RefreshCw className="h-3 w-3 mr-1" /><InfoTooltip term="Consolidate" explanation="Archive and organize old records to keep the system fast.">Consolidate</InfoTooltip>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPendingAction("cleanup")}>
                      Cleanup Expired
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Strategy Tab ───────────────────────────────────────── */}
          <TabsContent value="strategy" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-amber-500" />
                    Strategy Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Total Strategies</span>
                      <span className="font-mono font-bold">{strategyStats?.totalStrategies ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Active</span>
                      <span className="font-mono font-bold text-green-500">{strategyStats?.activeStrategies ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Avg Success Rate</span>
                      <span className="font-mono font-bold">{Number(strategyStats?.avgSuccessRate ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Total Assignments</span>
                      <span className="font-mono">{strategyStats?.totalAssignments ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-amber-500" />
                    Strategy Proposals
                  </CardTitle>
                  <CardDescription>Agent-proposed strategy mutations</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{strategyStats?.pendingProposals ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">pending review</p>
                  {strategyStats?.topPerformingStrategy && (
                    <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-xs font-medium text-amber-600">Top Strategy</p>
                      <p className="text-xs">{strategyStats.topPerformingStrategy}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Collaboration Tab ──────────────────────────────────── */}
          <TabsContent value="collaboration" className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-500" />
                    Active Dialogues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{collaborationStats?.activeDialogues ?? 0}</div>
                  <div className="mt-3 space-y-2">
                    {(Array.isArray(activeDialogues) ? activeDialogues : []).slice(0, 3).map((d: any) => (
                      <div key={d.dialogueId} className="p-2 rounded border text-xs">
                        <p className="font-medium truncate">{d.topic}</p>
                        <div className="flex gap-1 mt-1">
                          {(d.participants ?? []).map((p: string) => (
                            <Badge key={p} variant="outline" className="text-[9px]">{p}</Badge>
                          ))}
                        </div>
                        <Badge className="mt-1 text-[9px]" variant={d.status === "open" ? "default" : "secondary"}>{d.status}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowRight className="h-4 w-4 text-blue-500" />
                    Delegations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{collaborationStats?.totalDelegations ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Avg quality: {Number(collaborationStats?.avgDelegationQuality ?? 0).toFixed(0)}%
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Network className="h-4 w-4 text-blue-500" />
                    Skill Registry
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{collaborationStats?.skillsRegistered ?? 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">skills across all agents</p>
                  <p className="text-xs text-muted-foreground">
                    Reputation votes: {collaborationStats?.reputationVotes ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Self-Healing Tab ───────────────────────────────────── */}
          <TabsContent value="healing" className="space-y-4">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    Anomalies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{healthStats?.unresolvedAnomalies ?? 0}</div>
                  <p className="text-xs text-muted-foreground">unresolved</p>
                  <div className="mt-2 space-y-1">
                    {healthDashboard?.anomaliesBySeverity && Object.entries(healthDashboard.anomaliesBySeverity).map(([sev, count]: [string, any]) => (
                      <div key={sev} className="flex justify-between text-xs">
                        <Badge variant={sev === "critical" ? "destructive" : sev === "warning" ? "default" : "secondary"} className="text-[9px]">
                          {sev}
                        </Badge>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-red-500" />
                    Agent Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{healthStats?.totalBaselines ?? 0}</div>
                  <p className="text-xs text-muted-foreground">metrics tracked</p>
                  <div className="mt-2">
                    <p className="text-xs">
                      <span className="text-muted-foreground">Degraded agents: </span>
                      <span className="font-bold">{healthDashboard?.agentsInDegradedMode ?? 0}</span>
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-red-500" />
                    Playbooks
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{healthStats?.playbooksCount ?? 0}</div>
                  <p className="text-xs text-muted-foreground">incident response playbooks</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Flame className="h-4 w-4 text-red-500" />
                    Chaos Engineering
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{healthStats?.chaosExperiments ?? 0}</div>
                  <p className="text-xs text-muted-foreground">experiments run</p>
                  {healthStats?.avgRecoveryTime && (
                    <p className="text-xs mt-1">
                      Avg recovery: <span className="font-mono">{(healthStats.avgRecoveryTime / 1000).toFixed(1)}s</span>
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Anomaly List */}
            {Array.isArray(anomalies) && anomalies.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Active Anomalies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {anomalies.slice(0, 5).map((a: any) => (
                      <div key={a.anomalyId} className="flex items-center justify-between p-2 rounded border">
                        <div className="flex items-center gap-2">
                          <Badge variant={a.severity === "critical" ? "destructive" : "default"} className="text-[10px]">
                            {a.severity}
                          </Badge>
                          <span className="text-xs font-medium">{a.agentCodename}</span>
                          <span className="text-xs text-muted-foreground">{a.metric}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Expected: {Number(a.expectedValue).toFixed(1)}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span className="font-bold text-red-500">Actual: {Number(a.actualValue).toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ─── Governance Tab ─────────────────────────────────────── */}
          <TabsContent value="governance" className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-emerald-500" />
                    Policy Engine
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{governanceStats?.activePolicies ?? 0}</div>
                  <p className="text-xs text-muted-foreground">active policies</p>
                  <div className="mt-3 space-y-2">
                    {(Array.isArray(policies) ? policies : []).slice(0, 4).map((p: any) => (
                      <div key={p.policyId} className="flex items-center justify-between text-xs">
                        <span className="truncate mr-2">{p.name}</span>
                        <Badge variant={p.severity === "block" ? "destructive" : p.severity === "warning" ? "default" : "secondary"} className="text-[9px] shrink-0">
                          {p.severity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Eye className="h-4 w-4 text-emerald-500" />
                    Evaluations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total evaluated</span>
                      <span className="font-mono font-bold">{governanceStats?.totalEvaluations ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />Pass
                      </span>
                      <span className="font-mono text-green-500">{governanceStats?.passCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-yellow-500" />Warning
                      </span>
                      <span className="font-mono text-yellow-500">{governanceStats?.warningCount ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500" />Blocked
                      </span>
                      <span className="font-mono text-red-500">{governanceStats?.blockedCount ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Compliance Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-emerald-500">{governanceStats?.avgScore ?? 100}</div>
                  <Progress value={governanceStats?.avgScore ?? 100} className="mt-2" />
                  <p className="text-xs text-muted-foreground mt-2">
                    Sandbox runs: {governanceStats?.sandboxRuns ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Intelligence Tab ──────────────────────────────────── */}
          <TabsContent value="intelligence" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="md:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-500" />
                    Founder Intelligence Center
                  </CardTitle>
                  <CardDescription>
                    Your AI-powered executive briefing, what-if simulator, and strategic advisor
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg border bg-cyan-500/5">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="h-4 w-4 text-cyan-500" />
                        <h3 className="text-sm font-semibold">Daily Briefings</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI-generated executive summaries with key insights, agent highlights, and actionable recommendations.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border bg-cyan-500/5">
                      <div className="flex items-center gap-2 mb-2">
                        <FlaskConical className="h-4 w-4 text-cyan-500" />
                        <h3 className="text-sm font-semibold">What-If Simulator</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Run Monte Carlo simulations on scenarios like full autonomy, trust adjustments, and strategy changes.
                      </p>
                    </div>

                    <div className="p-4 rounded-lg border bg-cyan-500/5">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-cyan-500" />
                        <h3 className="text-sm font-semibold">Strategic Recommendations</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Data-driven suggestions for growth, efficiency, risk mitigation, and compliance improvements.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* System Status Footer */}
        <Card className="border-dashed">
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  V13 Sentient Enterprise Online
                </span>
                <span>6 Cognitive Pillars Active</span>
              </div>
              <div className="flex items-center gap-4">
                <span>
                  <Clock className="h-3 w-3 inline mr-1" />
                  Last refresh: {new Date().toLocaleTimeString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "consolidate" ? "Consolidate memory?" : "Clean up expired entries?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === "consolidate"
                ? "This will reorganize your system's memory records. Old episodes will be archived and key facts will be extracted. This is safe but may take a few minutes."
                : "This will remove expired entries from working memory. This is safe and helps keep the system running efficiently."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingAction === "consolidate") {
                consolidateMutation.mutate("oracle");
              } else if (pendingAction === "cleanup") {
                cleanupMutation.mutate();
              }
              setPendingAction(null);
            }}>
              Yes, proceed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
