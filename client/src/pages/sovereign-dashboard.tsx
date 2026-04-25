import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import {
  Crown, Bot, Shield, Brain, Zap, AlertTriangle,
  CheckCircle, Clock, TrendingUp, ChevronRight, RefreshCw,
  Network, Gauge, HeartPulse,
} from "lucide-react";
import { relative } from "@/lib/format";
import { InfoTooltip } from "@/components/info-tooltip";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  useAgentRuntimeStates,
  useEventMeshStats,
  useAutonomyScore,
  useSelfHealingStatus,
  useJobHealthLogs,
  useFounderIntelligence,
} from "@/hooks/use-sovereign-dashboard";

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-500",
    active: "bg-green-500",
    healthy: "bg-green-500",
    idle: "bg-yellow-500",
    paused: "bg-yellow-500",
    warning: "bg-yellow-500",
    error: "bg-red-500",
    failed: "bg-red-500",
    critical: "bg-red-500",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-400"}`}
      role="img"
      aria-label={`Status: ${status}`}
    />
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, trend }: {
  title: React.ReactNode;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="p-3 bg-primary/10 rounded-xl">
            <Icon className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
        </div>
        {trend && (
          <div className="mt-2" role="status">
            <TrendingUp
              className={`w-3 h-3 inline ${trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500 rotate-180" : "text-muted-foreground"}`}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground ml-1">
              {trend === "up" ? "Improving" : trend === "down" ? "Declining" : "Stable"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SovereignDashboard() {
  useDocumentTitle("Sovereign dashboard");
  const { data: agents = [], isLoading: agentsLoading } = useAgentRuntimeStates();
  const { data: meshStats, isLoading: meshLoading } = useEventMeshStats();
  const { data: autonomy, isLoading: autonomyLoading } = useAutonomyScore();
  const { data: healing } = useSelfHealingStatus();
  const { data: jobs = [] } = useJobHealthLogs();
  const { data: briefing } = useFounderIntelligence();

  const isLoading = agentsLoading || meshLoading || autonomyLoading;

  const activeAgents = Array.isArray(agents) ? agents.filter((a: any) => a.status === "running" || a.status === "active").length : 0;
  const totalAgents = Array.isArray(agents) ? agents.length : 0;
  const autonomyScore = autonomy?.score ?? autonomy?.overallScore ?? 0;
  const healthyJobs = Array.isArray(jobs) ? jobs.filter((j: any) => j.status === "success").length : 0;
  const failedJobs = Array.isArray(jobs) ? jobs.filter((j: any) => j.status === "failed").length : 0;

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Crown className="w-6 h-6 text-primary" aria-hidden="true" />
            Sovereign dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Complete visibility into your autonomous organization — agents, events, health, and autonomy score
          </p>
        </div>

        {briefing && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium text-sm">Founder intelligence</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {briefing.summary ?? briefing.message ?? "System operating within normal parameters."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top-Level Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title={<InfoTooltip term="Autonomy score" explanation="How much of your business runs automatically without needing your input. 100% means fully autonomous.">Autonomy score</InfoTooltip>}
            value={`${Math.round(autonomyScore)}%`}
            subtitle="Self-running capability"
            icon={Gauge}
            trend={autonomyScore > 70 ? "up" : autonomyScore > 40 ? "neutral" : "down"}
          />
          <MetricCard
            title="Active agents"
            value={`${activeAgents}/${totalAgents}`}
            subtitle="Running / total"
            icon={Bot}
            trend={activeAgents >= totalAgents ? "up" : "neutral"}
          />
          <MetricCard
            title={<InfoTooltip term="Event throughput" explanation="How many automated tasks your system is processing per minute.">Event throughput</InfoTooltip>}
            value={meshStats?.recentEventsPerMinute ?? 0}
            subtitle="Events per minute (5-minute average)"
            icon={Zap}
          />
          <MetricCard
            title={<InfoTooltip term="System health" explanation="Whether all background systems are running correctly.">System health</InfoTooltip>}
            value={failedJobs === 0 ? "Healthy" : `${failedJobs} failed`}
            subtitle={`${healthyJobs} jobs succeeded`}
            icon={HeartPulse}
            trend={failedJobs === 0 ? "up" : "down"}
          />
        </div>

        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="events">Event mesh</TabsTrigger>
            <TabsTrigger value="jobs">Job health</TabsTrigger>
            <TabsTrigger value="healing">Self-healing</TabsTrigger>
          </TabsList>

          {/* Agent Runtime States */}
          <TabsContent value="agents" className="space-y-4">
            {Array.isArray(agents) && agents.length > 0 ? (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0 m-0" aria-label="Agent runtime states">
                {agents.map((agent: any) => (
                  <li key={agent.id ?? agent.codename}>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <StatusIndicator status={agent.status ?? "idle"} />
                            <div>
                              <p className="font-medium text-sm">{agent.name ?? agent.codename ?? "Agent"}</p>
                              <p className="text-xs text-muted-foreground">{agent.role ?? agent.codename}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={agent.status === "running" || agent.status === "active" ? "default" : "secondary"}
                              aria-label={`Agent status: ${agent.status ?? "idle"}`}
                            >
                              {agent.status ?? "idle"}
                            </Badge>
                            {agent.trustScore != null && (
                              <span className="text-xs text-muted-foreground tabular-nums" aria-label={`Trust score ${Math.round(agent.trustScore)} percent`}>
                                Trust: {Math.round(agent.trustScore)}%
                              </span>
                            )}
                          </div>
                        </div>
                        {agent.lastAction && (
                          <p className="text-xs text-muted-foreground mt-2 pl-5">
                            Last: {agent.lastAction}
                            {agent.lastActionAt && ` · ${relative(agent.lastActionAt)}`}
                          </p>
                        )}
                        {agent.resourceUsage != null && (
                          <div className="mt-2 pl-5">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Resources</span>
                              <Progress
                                value={agent.resourceUsage}
                                className="h-1.5 flex-1"
                                role="progressbar"
                                aria-valuenow={Math.round(agent.resourceUsage)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`Resource usage for ${agent.name ?? agent.codename ?? "agent"}`}
                              />
                              <span className="tabular-nums">{Math.round(agent.resourceUsage)}%</span>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No agent runtime data available yet. Agents will appear here once the system initializes.
                </CardContent>
              </Card>
            )}

            <div className="flex gap-2">
              <Link href="/board-of-directors">
                <Button variant="outline" size="sm">
                  Board of directors <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
                </Button>
              </Link>
              <Link href="/agent-performance">
                <Button variant="outline" size="sm">
                  Performance review <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
                </Button>
              </Link>
            </div>
          </TabsContent>

          {/* Event Mesh */}
          <TabsContent value="events" className="space-y-4">
            {meshStats ? (
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <dt className="text-xs text-muted-foreground">Total events</dt>
                    <dd className="text-xl font-bold tabular-nums">{(meshStats.totalEvents ?? 0).toLocaleString()}</dd>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <dt className="text-xs text-muted-foreground">Active channels</dt>
                    <dd className="text-xl font-bold tabular-nums">{meshStats.channelsActive ?? 0}</dd>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <dt className="text-xs text-muted-foreground">Subscribers</dt>
                    <dd className="text-xl font-bold tabular-nums">{meshStats.activeSubscriptions ?? 0}</dd>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <dt className="text-xs text-muted-foreground flex items-center gap-1">
                      Dead-letter queue
                      {(meshStats.deadLetterDepth ?? 0) > 0 && <AlertTriangle className="w-3 h-3 text-yellow-500" aria-label="Dead-letter queue has events awaiting review" />}
                    </dt>
                    <dd className="text-xl font-bold tabular-nums">{meshStats.deadLetterDepth ?? 0}</dd>
                  </CardContent>
                </Card>
              </dl>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground" role="status" aria-label="Loading event mesh">
                  Event mesh statistics loading…
                </CardContent>
              </Card>
            )}

            {meshStats?.topChannels && meshStats.topChannels.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top channels</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 list-none p-0 m-0" aria-label="Most active event channels">
                    {meshStats.topChannels.map((ch: any, i: number) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{ch.channel}</span>
                        <Badge variant="secondary" className="tabular-nums" aria-label={`${ch.count} events on ${ch.channel}`}>{ch.count}</Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Link href="/event-log">
              <Button variant="outline" size="sm">
                Full event log <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
              </Button>
            </Link>
          </TabsContent>

          {/* Job Health */}
          <TabsContent value="jobs" className="space-y-4">
            <Link href="/job-health">
              <Button variant="outline" size="sm">
                Full job dashboard <ChevronRight className="w-3 h-3 ml-1" aria-hidden="true" />
              </Button>
            </Link>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent job runs</CardTitle>
              </CardHeader>
              <CardContent>
                {Array.isArray(jobs) && jobs.length > 0 ? (
                  <ul className="space-y-2 max-h-96 overflow-y-auto list-none p-0 m-0" aria-label="Recent background job runs">
                    {jobs.slice(0, 20).map((job: any, i: number) => (
                      <li key={job.id ?? i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                        <div className="flex items-center gap-2">
                          {job.status === "success" ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" aria-label="Succeeded" />
                          ) : job.status === "failed" ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" aria-label="Failed" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" aria-label={`Status: ${job.status ?? "pending"}`} />
                          )}
                          <span className="font-mono text-xs">{job.jobName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {job.durationMs != null && (
                            <span className="text-xs text-muted-foreground tabular-nums">{job.durationMs}ms</span>
                          )}
                          {job.runCompletedAt && (
                            <span className="text-xs text-muted-foreground">
                              {relative(job.runCompletedAt)}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No job health logs available yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Self-Healing */}
          <TabsContent value="healing" className="space-y-4">
            {healing ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Healing status</dt>
                      <dd className="flex items-center gap-2 mt-1">
                        <StatusIndicator status={healing.status ?? "healthy"} />
                        <span className="font-medium capitalize">{healing.status ?? "Healthy"}</span>
                      </dd>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Issues detected</dt>
                      <dd className="text-xl font-bold tabular-nums">{healing.issuesDetected ?? 0}</dd>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Auto-resolved</dt>
                      <dd className="text-xl font-bold tabular-nums">{healing.autoResolved ?? 0}</dd>
                    </CardContent>
                  </Card>
                </dl>

                {healing.recentActions && Array.isArray(healing.recentActions) && healing.recentActions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Recent healing actions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 list-none p-0 m-0" aria-label="Recent self-healing actions">
                        {healing.recentActions.map((action: any, i: number) => (
                          <li key={i} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <RefreshCw className="w-3 h-3 text-primary" aria-hidden="true" />
                              <span>{action.description ?? action.type}</span>
                            </div>
                            <Badge
                              variant={action.resolved ? "default" : "destructive"}
                              aria-label={action.resolved ? "Healing action resolved" : "Healing action pending"}
                            >
                              {action.resolved ? "Resolved" : "Pending"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground" role="status" aria-label="Loading self-healing data">
                  Self-healing mesh data loading…
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Quick Navigation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sovereign protocol modules</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 md:grid-cols-4 gap-2 list-none p-0 m-0" aria-label="Sovereign protocol modules">
              <li>
                <Link href="/board-of-directors">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Shield className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Board of directors
                  </Button>
                </Link>
              </li>
              <li>
                <Link href="/agent-performance">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <TrendingUp className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Agent performance
                  </Button>
                </Link>
              </li>
              <li>
                <Link href="/memory-browser">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Brain className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Memory browser
                  </Button>
                </Link>
              </li>
              <li>
                <Link href="/event-log">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Network className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Event log
                  </Button>
                </Link>
              </li>
              <li>
                <Link href="/job-health">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <HeartPulse className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Job health
                  </Button>
                </Link>
              </li>
              <li>
                <Link href="/founder">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Crown className="w-3.5 h-3.5 mr-2" aria-hidden="true" /> Founder HQ
                  </Button>
                </Link>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
