import { Sidebar } from "@/components/layout-sidebar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, Radio, CheckCircle2, GitMerge, GitBranch, Shield, Plug, Building2,
  AlertTriangle, Play, XCircle, Heart, Eye,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

const reassurance = "The runtime view will update on the next refresh — try again.";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/runtime"] });
      toast({ title: "Runtime initialized" });
    },
    onError: (e: any) => toast({ title: "Couldn't initialize runtime", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  const healthMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v12/runtime/health-check").then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/runtime"] });
      toast({ title: `Health check: ${data.unhealthy} unhealthy, ${data.restarted} restarted` });
    },
    onError: (e: any) => toast({ title: "Couldn't run health check", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
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
          <Play className="mr-2 h-3 w-3" aria-hidden="true" /> Initialize
        </Button>
        <Button size="sm" variant="outline" onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
          <Heart className="mr-2 h-3 w-3" aria-hidden="true" /> Health check
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-60" /> : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 list-none p-0 m-0" aria-label="Agent lifecycle states">
          {(states || []).map((s: any) => (
            <li key={s.id}>
              <Card className={s.lifecycleState === "crashed" ? "border-red-500" : ""}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg" role="img" aria-label={`Lifecycle state: ${s.lifecycleState}`}>{stateIcons[s.lifecycleState] || "?"}</span>
                      <span className="font-mono text-sm font-bold">{s.agentCodename}</span>
                    </div>
                    <Badge className={`${stateColors[s.lifecycleState] || "bg-gray-500"} text-white`} aria-label={`State: ${s.lifecycleState}`}>{s.lifecycleState}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground inline">Restarts:</dt>
                      <dd className="inline tabular-nums"> {s.restartCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground inline">Failures:</dt>
                      <dd className="inline tabular-nums"> {s.consecutiveFailures}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground inline">Policy:</dt>
                      <dd className="inline"> {s.restartPolicy}</dd>
                    </div>
                  </dl>
                  {s.currentTask && <p className="text-xs text-muted-foreground mt-1">Task: {s.currentTask}</p>}
                  {s.waitingFor && <p className="text-xs text-yellow-600 mt-1" role="status">Waiting: {s.waitingFor}</p>}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total events</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalEvents || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Channels</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.activeChannels || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground text-red-500">Dead letter</dt>
            <dd className="text-2xl font-bold text-red-500 tabular-nums">{stats.deadLetterCount || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Subscribers</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalSubscribers || 0}</dd>
          </CardContent></Card>
        </dl>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Active subscriptions</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1 list-none p-0 m-0" aria-label="Active event subscriptions">
            {(subs || []).map((s: any) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{s.subscriber}</Badge>
                <span className="text-xs font-mono text-muted-foreground">{s.channelPattern}</span>
                <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                  <span className="sr-only">Events processed: </span>{s.eventsProcessed} processed
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {(dlq || []).length > 0 && (
        <Card className="border-red-500">
          <CardHeader><CardTitle className="text-sm text-red-500">Dead-letter queue ({dlq.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Dead-letter events">
              {dlq.slice(0, 10).map((e: any) => (
                <li key={e.id} className="text-xs border-b pb-1" role="alert">
                  <span className="font-mono">{e.eventType}</span> on <span className="font-mono">{e.channel}</span>
                  <p className="text-muted-foreground">{e.deadLetterReason}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/verification"] });
      toast({ title: `Verified ${data.verified} contracts` });
    },
    onError: (e: any) => toast({ title: "Couldn't verify outcomes", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Outcome verification</h3>
        <Button size="sm" onClick={() => processMutation.mutate()} disabled={processMutation.isPending}>
          <Eye className="mr-2 h-3 w-3" aria-hidden="true" /> Process verifications
        </Button>
      </div>

      {stats && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalContracts || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Verified</dt>
            <dd className="text-2xl font-bold text-green-500 tabular-nums">{stats.verified || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground text-red-500">Discrepancies</dt>
            <dd className="text-2xl font-bold text-red-500 tabular-nums">{stats.discrepancies || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Accuracy</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.accuracyRate || 0}%</dd>
          </CardContent></Card>
        </dl>
      )}

      {(discrepancies || []).length > 0 && (
        <Card className="border-red-500">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" /> Discrepancies</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0" aria-label="Outcome discrepancies">
              {discrepancies.map((d: any) => (
                <li key={d.id} className="border-b pb-2 last:border-0" role="alert">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.agentCodename}</Badge>
                    <Badge variant="destructive">discrepancy</Badge>
                  </div>
                  <p className="text-sm mt-1">Claimed: {d.claimedOutcome}</p>
                  <p className="text-sm text-red-500">Verified: {d.verifiedOutcome || "Failed verification"}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
      <h3 className="font-semibold flex items-center gap-2"><GitMerge className="h-5 w-5" aria-hidden="true" /> Saga orchestrator</h3>
      {sagas && sagas.length > 0 ? (
        <ul className="space-y-4 list-none p-0 m-0" aria-label="Distributed sagas">
          {sagas.map((s: any) => (
            <li key={s.id}>
              <Card>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{s.sagaName}</span>
                    <div className="flex items-center gap-2">
                      <Badge className={`${statusColors[s.status] || "bg-gray-500"} text-white`} aria-label={`Saga status: ${s.status}`}>{s.status}</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums" aria-label={`Step ${s.currentStep} of ${s.totalSteps}`}>Step {s.currentStep}/{s.totalSteps}</span>
                    </div>
                  </div>
                  <div
                    className="flex gap-1"
                    role="progressbar"
                    aria-valuenow={s.currentStep}
                    aria-valuemin={0}
                    aria-valuemax={s.totalSteps}
                    aria-label={`Saga ${s.sagaName} progress`}
                  >
                    {(s.steps || []).map((step: any, i: number) => (
                      <div
                        key={i}
                        className={`h-2 flex-1 rounded ${step.status === "completed" ? "bg-green-500" : step.status === "failed" ? "bg-red-500" : step.status === "compensated" ? "bg-orange-500" : "bg-muted"}`}
                        title={`${step.agent}: ${step.action} (${step.status})`}
                        aria-label={`Step ${i + 1}: ${step.agent} ${step.action} — ${step.status}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">By {s.initiatorAgent}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">No sagas yet. Create multi-step workflows to see distributed transactions.</p>
      )}
    </div>
  );
}

function AgentVersions() {
  const { data: canaries } = useQuery({
    queryKey: ["/api/founder/v12/versions/canary/status"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/versions/canary/status").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><GitBranch className="h-5 w-5" aria-hidden="true" /> Agent version control</h3>
      {(canaries || []).length > 0 ? (
        <ul className="space-y-3 list-none p-0 m-0" aria-label="Active canary deployments">
          {canaries.map((v: any) => (
            <li key={v.id}>
              <Card className="border-blue-500">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{v.agentCodename}</Badge>
                      <Badge variant="secondary">v{v.versionNumber}</Badge>
                      <Badge className="bg-blue-500 text-white tabular-nums" aria-label={`${v.canaryWeight} percent canary traffic`}>{v.canaryWeight}% canary</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">{v.changeDescription}</span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">No canary deployments active. Create agent versions to enable gradual rollout.</p>
      )}
    </div>
  );
}

function TrustEnforcement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    onError: (e: any) => toast({ title: "Couldn't approve", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  const denyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/founder/v12/trust/${id}/deny`, { reason: "CEO denied" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v12/trust"] }),
    onError: (e: any) => toast({ title: "Couldn't deny", description: `${e.message}. ${reassurance}`, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {stats && (
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Allowed</dt>
            <dd className="text-2xl font-bold text-green-500 tabular-nums">{stats.allowed || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Blocked</dt>
            <dd className="text-2xl font-bold text-red-500 tabular-nums">{stats.blocked || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Pending</dt>
            <dd className="text-2xl font-bold text-yellow-500 tabular-nums">{stats.pendingApproval || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Approved</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.approved || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Denied</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.denied || 0}</dd>
          </CardContent></Card>
        </dl>
      )}

      {(pending || []).length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader><CardTitle className="text-sm">Awaiting CEO approval ({pending.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 list-none p-0 m-0" aria-label="Trust requests awaiting CEO approval">
              {pending.map((p: any) => (
                <li key={p.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{p.agentCodename}</Badge>
                      <span className="text-sm">{p.actionType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">Trust: {p.actualTrust} / required: {p.requiredTrust}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(p.id)}
                      aria-label={`Approve ${p.actionType} by ${p.agentCodename}`}
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => denyMutation.mutate(p.id)}
                      aria-label={`Deny ${p.actionType} by ${p.agentCodename}`}
                    >
                      <XCircle className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

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
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total calls</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalCalls || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Success rate</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.successRate || 0}%</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total cost</dt>
            <dd className="text-2xl font-bold tabular-nums">{usd((stats.totalCost || 0) / 100)}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground text-red-500">Open circuits</dt>
            <dd className="text-2xl font-bold text-red-500 tabular-nums">{stats.openCircuits || 0}</dd>
          </CardContent></Card>
        </dl>
      )}

      {(circuits || []).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Circuit breakers</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 list-none p-0 m-0" aria-label="Integration circuit breakers">
              {circuits.map((c: any) => (
                <li key={c.id} className="flex items-center gap-2">
                  <Badge variant={c.circuitBreakerOpen ? "destructive" : "default"}>{c.serviceName}</Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {c.circuitBreakerFailures}/{c.circuitBreakerThreshold} failures
                  </span>
                  {c.circuitBreakerOpen && <Badge variant="destructive" aria-label={`Circuit open for ${c.serviceName}`}>OPEN</Badge>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TenantFabric() {
  const { data: stats } = useQuery({
    queryKey: ["/api/founder/v12/tenants/stats"],
    queryFn: () => apiRequest("GET", "/api/founder/v12/tenants/stats").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-5 w-5" aria-hidden="true" /> Tenant fabric</h3>
      {stats && (
        <dl className="grid grid-cols-3 gap-3">
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Total tenants</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.totalTenants || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Avg agents</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.avgAgentsEnabled || 0}</dd>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-center">
            <dt className="text-xs text-muted-foreground">Avg trust</dt>
            <dd className="text-2xl font-bold tabular-nums">{stats.avgTrust || 0}</dd>
          </CardContent></Card>
        </dl>
      )}
      <p className="text-sm text-muted-foreground text-center py-4">Initialize tenants via API to see per-organization agent configurations with isolated trust scores, quotas, and permissions.</p>
    </div>
  );
}

export default function RealRuntimePage() {
  useDocumentTitle("Real runtime");
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cpu className="h-6 w-6" aria-hidden="true" /> The real runtime
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sovereign Company Protocol v12 — agent lifecycle, event mesh, outcome verification, sagas, versioning, trust enforcement, integrations, and tenant isolation
            </p>
          </div>

          <Tabs defaultValue="runtime" className="space-y-4">
            <TabsList className="flex flex-wrap h-auto gap-1">
              <TabsTrigger value="runtime" className="gap-1"><Cpu className="h-3 w-3" aria-hidden="true" /> Runtime</TabsTrigger>
              <TabsTrigger value="events" className="gap-1"><Radio className="h-3 w-3" aria-hidden="true" /> Events</TabsTrigger>
              <TabsTrigger value="verification" className="gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Verification</TabsTrigger>
              <TabsTrigger value="sagas" className="gap-1"><GitMerge className="h-3 w-3" aria-hidden="true" /> Sagas</TabsTrigger>
              <TabsTrigger value="versions" className="gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" /> Versions</TabsTrigger>
              <TabsTrigger value="trust" className="gap-1"><Shield className="h-3 w-3" aria-hidden="true" /> Trust</TabsTrigger>
              <TabsTrigger value="integrations" className="gap-1"><Plug className="h-3 w-3" aria-hidden="true" /> Integrations</TabsTrigger>
              <TabsTrigger value="tenants" className="gap-1"><Building2 className="h-3 w-3" aria-hidden="true" /> Tenants</TabsTrigger>
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
