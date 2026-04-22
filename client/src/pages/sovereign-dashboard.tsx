import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import {
  Crown, Bot, Activity, Shield, Brain, Zap, AlertTriangle,
  CheckCircle, Clock, TrendingUp, ChevronRight, RefreshCw,
  Network, Eye, Gauge, HeartPulse,
} from "lucide-react";
import { relative } from "@/lib/format";
import { InfoTooltip } from "@/components/info-tooltip";
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
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-400"}`} />
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, trend }: {
  title: React.ReactNode;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="p-3 bg-primary/10 rounded-xl">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
        {trend && (
          <div className="mt-2">
            <TrendingUp className={`w-3 h-3 inline ${trend === "up" ? "text-green-500" : trend === "down" ? "text-red-500 rotate-180" : "text-muted-foreground"}`} />
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
  const { data: agents = [], isLoading: agentsLoading } = useAgentRuntimeStates();
  const { data: meshStats, isLoading: meshLoading } = useEventMeshStats();
  const { data: autonomy, isLoading: autonomyLoading } = useAutonomyScore();
  const { data: healing, isLoading: healingLoading } = useSelfHealingStatus();
  const { data: jobs = [], isLoading: jobsLoading } = useJobHealthLogs();
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
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Crown className="w-6 h-6 text-primary" />
            Sovereign Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Complete visibility into your autonomous organization — agents, events, health, and autonomy score
          </p>
        </div>

        {/* Founder Intelligence Briefing */}
        {briefing && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Founder Intelligence</p>
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
            title={<InfoTooltip term="Autonomy Score" explanation="How much of your business runs automatically without needing your input. 100% means fully autonomous.">Autonomy Score</InfoTooltip>}
            value={`${Math.round(autonomyScore)}%`}
            subtitle="Self-running capability"
            icon={Gauge}
            trend={autonomyScore > 70 ? "up" : autonomyScore > 40 ? "neutral" : "down"}
          />
          <MetricCard
            title="Active Agents"
            value={`${activeAgents}/${totalAgents}`}
            subtitle="Running / Total"
            icon={Bot}
            trend={activeAgents >= totalAgents ? "up" : "neutral"}
          />
          <MetricCard
            title={<InfoTooltip term="Event Throughput" explanation="How many automated tasks your system is processing per minute.">Event Throughput</InfoTooltip>}
            value={meshStats?.recentEventsPerMinute ?? 0}
            subtitle="Events/min (5m avg)"
            icon={Zap}
          />
          <MetricCard
            title={<InfoTooltip term="System Health" explanation="Whether all background systems are running correctly.">System Health</InfoTooltip>}
            value={failedJobs === 0 ? "Healthy" : `${failedJobs} Failed`}
            subtitle={`${healthyJobs} jobs succeeded`}
            icon={HeartPulse}
            trend={failedJobs === 0 ? "up" : "down"}
          />
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="agents">
          <TabsList>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="events">Event Mesh</TabsTrigger>
            <TabsTrigger value="jobs">Job Health</TabsTrigger>
            <TabsTrigger value="healing">Self-Healing</TabsTrigger>
          </TabsList>

          {/* Agent Runtime States */}
          <TabsContent value="agents" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.isArray(agents) && agents.length > 0 ? agents.map((agent: any) => (
                <Card key={agent.id ?? agent.codename}>
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
                        <Badge variant={agent.status === "running" || agent.status === "active" ? "default" : "secondary"}>
                          {agent.status ?? "idle"}
                        </Badge>
                        {agent.trustScore != null && (
                          <span className="text-xs text-muted-foreground">
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
                          <Progress value={agent.resourceUsage} className="h-1.5 flex-1" />
                          <span>{Math.round(agent.resourceUsage)}%</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )) : (
                <Card className="col-span-full">
                  <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                    No agent runtime data available yet. Agents will appear here once the system initializes.
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="flex gap-2">
              <Link href="/board-of-directors">
                <Button variant="outline" size="sm">
                  Board of Directors <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
              <Link href="/agent-performance">
                <Button variant="outline" size="sm">
                  Performance Review <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </TabsContent>

          {/* Event Mesh */}
          <TabsContent value="events" className="space-y-4">
            {meshStats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Events</p>
                    <p className="text-xl font-bold">{meshStats.totalEvents?.toLocaleString() ?? 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Active Channels</p>
                    <p className="text-xl font-bold">{meshStats.channelsActive ?? 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Subscribers</p>
                    <p className="text-xl font-bold">{meshStats.activeSubscriptions ?? 0}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      Dead Letter Queue
                      {(meshStats.deadLetterDepth ?? 0) > 0 && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                    </p>
                    <p className="text-xl font-bold">{meshStats.deadLetterDepth ?? 0}</p>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  Event mesh statistics loading...
                </CardContent>
              </Card>
            )}

            {meshStats?.topChannels && meshStats.topChannels.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Top Channels</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {meshStats.topChannels.map((ch: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs">{ch.channel}</span>
                        <Badge variant="secondary">{ch.count}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Link href="/event-log">
              <Button variant="outline" size="sm">
                Full Event Log <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </TabsContent>

          {/* Job Health */}
          <TabsContent value="jobs" className="space-y-4">
            <Link href="/job-health">
              <Button variant="outline" size="sm">
                Full Job Dashboard <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent Job Runs</CardTitle>
              </CardHeader>
              <CardContent>
                {Array.isArray(jobs) && jobs.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {jobs.slice(0, 20).map((job: any, i: number) => (
                      <div key={job.id ?? i} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                        <div className="flex items-center gap-2">
                          {job.status === "success" ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          ) : job.status === "failed" ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <span className="font-mono text-xs">{job.jobName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {job.durationMs != null && (
                            <span className="text-xs text-muted-foreground">{job.durationMs}ms</span>
                          )}
                          {job.runCompletedAt && (
                            <span className="text-xs text-muted-foreground">
                              {relative(job.runCompletedAt)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Healing Status</p>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusIndicator status={healing.status ?? "healthy"} />
                        <p className="font-medium capitalize">{healing.status ?? "Healthy"}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Issues Detected</p>
                      <p className="text-xl font-bold">{healing.issuesDetected ?? 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Auto-Resolved</p>
                      <p className="text-xl font-bold">{healing.autoResolved ?? 0}</p>
                    </CardContent>
                  </Card>
                </div>

                {healing.recentActions && Array.isArray(healing.recentActions) && healing.recentActions.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Recent Healing Actions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {healing.recentActions.map((action: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <RefreshCw className="w-3 h-3 text-primary" />
                              <span>{action.description ?? action.type}</span>
                            </div>
                            <Badge variant={action.resolved ? "default" : "destructive"}>
                              {action.resolved ? "Resolved" : "Pending"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  Self-healing mesh data loading...
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Quick Navigation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sovereign Protocol Modules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Link href="/board-of-directors">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Shield className="w-3.5 h-3.5 mr-2" /> Board of Directors
                </Button>
              </Link>
              <Link href="/agent-performance">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <TrendingUp className="w-3.5 h-3.5 mr-2" /> Agent Performance
                </Button>
              </Link>
              <Link href="/memory-browser">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Brain className="w-3.5 h-3.5 mr-2" /> Memory Browser
                </Button>
              </Link>
              <Link href="/event-log">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Network className="w-3.5 h-3.5 mr-2" /> Event Log
                </Button>
              </Link>
              <Link href="/job-health">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <HeartPulse className="w-3.5 h-3.5 mr-2" /> Job Health
                </Button>
              </Link>
              <Link href="/founder">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Crown className="w-3.5 h-3.5 mr-2" /> Founder HQ
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
