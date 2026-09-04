import { PageShell } from "@/components/page-shell";
import { QueryErrorState } from "@/components/query-error-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp, Bot, DollarSign, Target,
} from "lucide-react";
import { relative, usd } from "@/lib/format";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  useAgentRuntimeStates,
  useRevenueAttribution,
} from "@/hooks/use-sovereign-dashboard";

function TrustScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "bg-acr-pos" : score >= 50 ? "bg-acr-warn" : "bg-acr-neg";
  const rounded = Math.round(score);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{rounded}%</span>
      </div>
      <div
        className="h-2 bg-muted rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${rounded}%`}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

export default function AgentPerformance() {
  useDocumentTitle("Agent performance");
  const {
    data: agents = [],
    isLoading: agentsLoading,
    isError: agentsFailed,
    error: agentsError,
    refetch: refetchAgents,
    isRefetching: agentsRefetching,
  } = useAgentRuntimeStates();
  const { data: revenue } = useRevenueAttribution();

  const isLoading = agentsLoading;

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        <PageHeader
          title="Agent performance"
          icon={<TrendingUp className="w-5 h-5 text-muted-foreground" aria-hidden="true" />}
          description="Trust scores, revenue attribution, and decision accuracy."
        />

        <Tabs defaultValue="trust">
          <TabsList>
            <TabsTrigger value="trust">Trust scores</TabsTrigger>
            <TabsTrigger value="revenue">Revenue attribution</TabsTrigger>
            
          </TabsList>

          <TabsContent value="trust" className="space-y-4">
            {agentsFailed ? (
              // BEFORE the empty branch. That branch says "Agents will appear
              // once the system initializes" — a claim about the fleet's state
              // that a failed read has no business making.
              <QueryErrorState
                error={agentsError}
                onRetry={() => void refetchAgents()}
                isRetrying={agentsRefetching}
                title="Couldn't load agent trust scores"
                description="We couldn't read the agent runtime just now. This isn't an idle fleet — try again."
                testId="agent-performance-error"
              />
            ) : Array.isArray(agents) && agents.length > 0 ? (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Agent trust scores">
                {agents.map((agent: any) => (
                  <li key={agent.id ?? agent.codename}>
                    <Card>
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Bot className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                            <span className="font-medium text-sm truncate">{agent.name ?? agent.codename}</span>
                          </div>
                          <Badge
                            variant={
                              (agent.trustScore ?? 0) >= 80 ? "default" :
                              (agent.trustScore ?? 0) >= 50 ? "secondary" :
                              "destructive"
                            }
                            className="tabular-nums"
                            aria-label={agent.trustScore != null ? `Overall trust ${Math.round(agent.trustScore)}%` : "Trust score not available"}
                          >
                            {agent.trustScore != null ? `${Math.round(agent.trustScore)}%` : "N/A"}
                          </Badge>
                        </div>

                        <TrustScoreBar
                          score={agent.trustScore ?? agent.trust ?? 0}
                          label="Overall trust"
                        />

                        {agent.decisionAccuracy != null && (
                          <TrustScoreBar
                            score={agent.decisionAccuracy}
                            label="Decision accuracy"
                          />
                        )}

                        {agent.taskCompletionRate != null && (
                          <TrustScoreBar
                            score={agent.taskCompletionRate}
                            label="Task completion"
                          />
                        )}

                        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 flex-wrap gap-2">
                          <span>
                            <span className="tabular-nums">{agent.decisionsCount ?? agent.totalDecisions ?? 0}</span> decisions made
                          </span>
                          {agent.lastDecisionAt && (
                            <span className="tabular-nums">Last: {relative(agent.lastDecisionAt)}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No agent data available yet. Agents will appear once the system initializes.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="revenue" className="space-y-4">
            {revenue ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Total attributed revenue</dt>
                      <dd className="text-2xl font-bold tabular-nums">
                        {usd((revenue.totalRevenue ?? revenue.total ?? 0) / 100)}
                      </dd>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Attribution nodes</dt>
                      <dd className="text-2xl font-bold tabular-nums">{revenue.nodeCount ?? revenue.nodes?.length ?? 0}</dd>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <dt className="text-xs text-muted-foreground">Top contributor</dt>
                      <dd className="text-lg font-bold">{revenue.topContributor ?? "N/A"}</dd>
                    </CardContent>
                  </Card>
                </dl>

                {revenue.agents && Array.isArray(revenue.agents) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Revenue by agent</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-3" aria-label="Revenue contribution per agent">
                        {revenue.agents.map((a: any, i: number) => {
                          const sharePct = Math.round(a.share ?? a.percentage ?? 0);
                          return (
                            <li key={i} className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2 min-w-0">
                                <DollarSign className="w-3.5 h-3.5 text-acr-pos shrink-0" aria-hidden="true" />
                                <span className="text-sm font-medium truncate">{a.agent ?? a.name}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="w-32">
                                  <Progress
                                    value={sharePct}
                                    className="h-2"
                                    aria-label={`${a.agent ?? a.name} contributes ${sharePct}% of attributed revenue`}
                                  />
                                </div>
                                <span className="text-sm font-medium w-20 text-right tabular-nums">
                                  {usd((a.revenue ?? a.amount ?? 0) / 100)}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No revenue attribution data available yet.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* The Strategies tab was removed 2026-08-29 (turn 18, Decision F):
              it fetched /api/founder/v13/strategy/active, a route that never
              existed — the tab always rendered its empty state. */}
        </Tabs>
      </div>
    </PageShell>
  );
}
