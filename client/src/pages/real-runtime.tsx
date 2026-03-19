import { useState } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, Radio, CheckCircle2, GitMerge, GitBranch, Shield, Plug, Building2,
  Loader2, AlertTriangle, Play, RefreshCw, XCircle, Heart, Zap, Eye,
} from "lucide-react";

// ─── Agent Runtime Tab ──────────────────────────────────────────────────────

function AgentRuntime() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: states, isLoading } = useQuery({
    queryKey: ["/api/founder/v12/runtime"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/runtime").then(r => r.json()),
    refetchInterval: 5000,
  });

  const initMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v12/runtime/initialize").then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/runtime"] }); toast({ title: "Runtime initialized" }); },
  });

  const healthMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v12/runtime/health-check").then(r => r.json()),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/runtime"] }); toast({ title: `Health check: ${data.unhealthy} unhealthy, ${data.restarted} restarted` }); },
  });

  const stateColors: Record<string, string> = {
    ready: "bg-green-500", thinking: "bg-blue-500", acting: "bg-purple-500",
    waiting: "bg-yellow-500", sleeping: "bg-gray-500", crashed: "bg-red-500",
    initializing: "bg-cyan-500", terminated: "bg-gray-800",
  };

  const stateIcons: Record<string, string> = {
    ready: "●", thinking: "◉", acting: "⚡", waiting: "◌", sleeping: "◑", crashed: "✕", initializing: "○", terminated: "□",
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>
          <Play className="mr-2 h-3 w-3" /> Initialize
        </Button>
        <Button size="sm" variant="outline" onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
          <Heart className="mr-2 h-3 w-3" /> Health Check
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-60" /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(states || []).map((s: any) => (
            <Card key={s.id} className={s.lifecycleState === "crashed" ? "border-red-500" : ""}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{stateIcons[s.lifecycleState] || "?"}</span>
                    <span className="font-mono text-sm font-bold">{s.agentCodename}</span>
                  </div>
                  <Badge className={`${stateColors[s.lifecycleState] || "bg-gray-500"} text-white`}>{s.lifecycleState}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Restarts:</span> {s.restartCount}</div>
                  <div><span className="text-muted-foreground">Failures:</span> {s.consecutiveFailures}</div>
                  <div><span className="text-muted-foreground">Policy:</span> {s.restartPolicy}</div>
                </div>
                {s.currentTask && <p className="text-xs text-muted-foreground mt-1">Task: {s.currentTask}</p>}
                {s.waitingFor && <p className="text-xs text-yellow-600 mt-1">Waiting: {s.waitingFor}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Event Mesh Tab ─────────────────────────────────────────────────────────

function EventMesh() {
  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/events/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/events/stats").then(r => r.json()),
  });

  const { data: dlq } = useQuery({
    queryKey: ["/api/founder/v12/events/dead-letter"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/events/dead-letter").then(r => r.json()),
  });

  const { data: subs } = useQuery({
    queryKey: ["/api/founder/v12/events/subscriptions"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/events/subscriptions").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Events</p><p className="text-2xl font-bold">{stats.totalEvents || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Channels</p><p className="text-2xl font-bold">{stats.activeChannels || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground text-red-500">Dead Letter</p><p className="text-2xl font-bold text-red-500">{stats.deadLetterCount || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Subscribers</p><p className="text-2xl font-bold">{stats.totalSubscribers || 0}</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Active Subscriptions</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(subs || []).map((s: any) => (
            <div key={s.id} className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{s.subscriber}</Badge>
              <span className="text-xs font-mono text-muted-foreground">{s.channelPattern}</span>
              <span className="text-xs text-muted-foreground ml-auto">{s.eventsProcessed} processed</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {(dlq || []).length > 0 && (
        <Card className="border-red-500">
          <CardHeader><CardTitle className="text-sm text-red-500">Dead Letter Queue ({dlq.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {dlq.slice(0, 10).map((e: any) => (
              <div key={e.id} className="text-xs border-b pb-1">
                <span className="font-mono">{e.eventType}</span> on <span className="font-mono">{e.channel}</span>
                <p className="text-muted-foreground">{e.deadLetterReason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Outcome Verification Tab ───────────────────────────────────────────────

function OutcomeVerification() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/verification/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/verification/stats").then(r => r.json()),
  });

  const { data: discrepancies } = useQuery({
    queryKey: ["/api/founder/v12/verification/discrepancies"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/verification/discrepancies").then(r => r.json()),
  });

  const processMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v12/verification/process").then(r => r.json()),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/verification"] }); toast({ title: `Verified ${data.verified} contracts` }); },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5" /> Outcome Verification</h3>
        <Button size="sm" onClick={() => processMutation.mutate()} disabled={processMutation.isPending}>
          <Eye className="mr-2 h-3 w-3" /> Process Verifications
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{stats.totalContracts || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Verified</p><p className="text-2xl font-bold text-green-500">{stats.verified || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground text-red-500">Discrepancies</p><p className="text-2xl font-bold text-red-500">{stats.discrepancies || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Accuracy</p><p className="text-2xl font-bold">{stats.accuracyRate || 0}%</p></CardContent></Card>
        </div>
      )}

      {(discrepancies || []).length > 0 && (
        <Card className="border-red-500">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" /> Discrepancies</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {discrepancies.map((d: any) => (
              <div key={d.id} className="border-b pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{d.agentCodename}</Badge>
                  <Badge variant="destructive">discrepancy</Badge>
                </div>
                <p className="text-sm mt-1">Claimed: {d.claimedOutcome}</p>
                <p className="text-sm text-red-500">Verified: {d.verifiedOutcome || "Failed verification"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Saga Orchestrator Tab ──────────────────────────────────────────────────

function SagaOrchestrator() {
  const { data: sagas } = useQuery({
    queryKey: ["/api/founder/v12/sagas"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/sagas").then(r => r.json()),
  });

  const statusColors: Record<string, string> = {
    running: "bg-blue-500", completed: "bg-green-500", rolled_back: "bg-red-500",
    compensating: "bg-orange-500", partially_compensated: "bg-yellow-500", timed_out: "bg-gray-500",
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><GitMerge className="h-5 w-5" /> Saga Orchestrator</h3>
      {(sagas || []).map((s: any) => (
        <Card key={s.id}>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{s.sagaName}</span>
              <div className="flex items-center gap-2">
                <Badge className={`${statusColors[s.status] || "bg-gray-500"} text-white`}>{s.status}</Badge>
                <span className="text-xs text-muted-foreground">Step {s.currentStep}/{s.totalSteps}</span>
              </div>
            </div>
            <div className="flex gap-1">
              {(s.steps || []).map((step: any, i: number) => (
                <div key={i} className={`h-2 flex-1 rounded ${step.status === "completed" ? "bg-green-500" : step.status === "failed" ? "bg-red-500" : step.status === "compensated" ? "bg-orange-500" : "bg-muted"}`} title={`${step.agent}: ${step.action} (${step.status})`} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">By {s.initiatorAgent}</p>
          </CardContent>
        </Card>
      ))}
      {(!sagas || sagas.length === 0) && <p className="text-sm text-muted-foreground text-center py-8">No sagas yet. Create multi-step workflows to see distributed transactions.</p>}
    </div>
  );
}

// ─── Agent Versions Tab ─────────────────────────────────────────────────────

function AgentVersions() {
  const { data: canaries } = useQuery({
    queryKey: ["/api/founder/v12/versions/canary/status"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/versions/canary/status").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><GitBranch className="h-5 w-5" /> Agent Version Control</h3>
      {(canaries || []).length > 0 ? (
        canaries.map((v: any) => (
          <Card key={v.id} className="border-blue-500">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{v.agentCodename}</Badge>
                  <Badge variant="secondary">v{v.versionNumber}</Badge>
                  <Badge className="bg-blue-500 text-white">{v.canaryWeight}% canary</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{v.changeDescription}</span>
              </div>
            </CardContent>
          </Card>
        ))
      ) : <p className="text-sm text-muted-foreground text-center py-8">No canary deployments active. Create agent versions to enable gradual rollout.</p>}
    </div>
  );
}

// ─── Trust Enforcement Tab ──────────────────────────────────────────────────

function TrustEnforcement() {
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/trust/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/trust/stats").then(r => r.json()),
  });

  const { data: pending } = useQuery({
    queryKey: ["/api/founder/v12/trust/pending"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/trust/pending").then(r => r.json()),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v12/trust/${id}/approve`, { approvedBy: "ceo" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/trust"] }),
  });

  const denyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v12/trust/${id}/deny`, { reason: "CEO denied" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/trust"] }),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Allowed</p><p className="text-2xl font-bold text-green-500">{stats.allowed || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Blocked</p><p className="text-2xl font-bold text-red-500">{stats.blocked || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold text-yellow-500">{stats.pendingApproval || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Approved</p><p className="text-2xl font-bold">{stats.approved || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Denied</p><p className="text-2xl font-bold">{stats.denied || 0}</p></CardContent></Card>
        </div>
      )}

      {(pending || []).length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader><CardTitle className="text-sm">Awaiting CEO Approval ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{p.agentCodename}</Badge>
                    <span className="text-sm">{p.actionType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Trust: {p.actualTrust} / Required: {p.requiredTrust}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => approveMutation.mutate(p.id)}><CheckCircle2 className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => denyMutation.mutate(p.id)}><XCircle className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Integration Framework Tab ──────────────────────────────────────────────

function IntegrationFramework() {
  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/integrations/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/integrations/stats").then(r => r.json()),
  });

  const { data: circuits } = useQuery({
    queryKey: ["/api/founder/v12/integrations/circuit-breakers"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/integrations/circuit-breakers").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Calls</p><p className="text-2xl font-bold">{stats.totalCalls || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Success Rate</p><p className="text-2xl font-bold">{stats.successRate || 0}%</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Cost</p><p className="text-2xl font-bold">${((stats.totalCost || 0) / 100).toFixed(2)}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground text-red-500">Open Circuits</p><p className="text-2xl font-bold text-red-500">{stats.openCircuits || 0}</p></CardContent></Card>
        </div>
      )}

      {(circuits || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Circuit Breakers</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {circuits.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2">
                <Badge variant={c.circuitBreakerOpen ? "destructive" : "default"}>{c.serviceName}</Badge>
                <span className="text-xs text-muted-foreground">
                  {c.circuitBreakerFailures}/{c.circuitBreakerThreshold} failures
                </span>
                {c.circuitBreakerOpen && <Badge variant="destructive">OPEN</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Tenant Fabric Tab ──────────────────────────────────────────────────────

function TenantFabric() {
  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/tenants/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/tenants/stats").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-5 w-5" /> Tenant Fabric</h3>
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Total Tenants</p><p className="text-2xl font-bold">{stats.totalTenants || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Avg Agents</p><p className="text-2xl font-bold">{stats.avgAgentsEnabled || 0}</p></CardContent></Card>
          <Card><CardContent className="pt-4 text-center"><p className="text-xs text-muted-foreground">Avg Trust</p><p className="text-2xl font-bold">{stats.avgTrust || 0}</p></CardContent></Card>
        </div>
      )}
      <p className="text-sm text-muted-foreground text-center py-4">Initialize tenants via API to see per-organization agent configurations with isolated trust scores, quotas, and permissions.</p>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function RealRuntimePage() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cpu className="h-6 w-6" /> The Real Runtime
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v12 — Agent lifecycle, event mesh, outcome verification, sagas, versioning, trust enforcement, integrations, and tenant isolation
            </p>
          </div>

          <Tabs defaultValue="runtime" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="runtime" className="gap-1"><Cpu className="h-3 w-3" /> Runtime</TabsTrigger>
              <TabsTrigger value="events" className="gap-1"><Radio className="h-3 w-3" /> Events</TabsTrigger>
              <TabsTrigger value="verification" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verification</TabsTrigger>
              <TabsTrigger value="sagas" className="gap-1"><GitMerge className="h-3 w-3" /> Sagas</TabsTrigger>
              <TabsTrigger value="versions" className="gap-1"><GitBranch className="h-3 w-3" /> Versions</TabsTrigger>
              <TabsTrigger value="trust" className="gap-1"><Shield className="h-3 w-3" /> Trust</TabsTrigger>
              <TabsTrigger value="integrations" className="gap-1"><Plug className="h-3 w-3" /> Integrations</TabsTrigger>
              <TabsTrigger value="tenants" className="gap-1"><Building2 className="h-3 w-3" /> Tenants</TabsTrigger>
            </TabsList>

            <TabsContent value="runtime"><AgentRuntime /></TabsContent>
            <TabsContent value="events"><EventMesh /></TabsContent>
            <TabsContent value="verification"><OutcomeVerification /></TabsContent>
            <TabsContent value="sagas"><SagaOrchestrator /></TabsContent>
            <TabsContent value="versions"><AgentVersions /></TabsContent>
            <TabsContent value="trust"><TrustEnforcement /></TabsContent>
            <TabsContent value="integrations"><IntegrationFramework /></TabsContent>
            <TabsContent value="tenants"><TenantFabric /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
