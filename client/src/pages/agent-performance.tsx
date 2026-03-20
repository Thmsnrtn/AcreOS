import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TrendingUp, Bot, DollarSign, Brain,
  Target, Award, BarChart2, Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useAgentRuntimeStates,
  useRevenueAttribution,
  useAdaptiveStrategies,
} from "@/hooks/use-sovereign-dashboard";

function TrustScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(score)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
    </div>
  );
}

export default function AgentPerformance() {
  const { data: agents = [], isLoading: agentsLoading } = useAgentRuntimeStates();
  const { data: revenue, isLoading: revenueLoading } = useRevenueAttribution();
  const { data: strategies = [], isLoading: strategiesLoading } = useAdaptiveStrategies();

  const isLoading = agentsLoading;

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Agent Performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Trust scores, revenue attribution, decision accuracy, and adaptive strategies
          </p>
        </div>

        <Tabs defaultValue="trust">
          <TabsList>
            <TabsTrigger value="trust">Trust Scores</TabsTrigger>
            <TabsTrigger value="revenue">Revenue Attribution</TabsTrigger>
            <TabsTrigger value="strategies">Strategies</TabsTrigger>
          </TabsList>

          {/* Trust Scores */}
          <TabsContent value="trust" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.isArray(agents) && agents.length > 0 ? agents.map((agent: any) => (
                <Card key={agent.id ?? agent.codename}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">{agent.name ?? agent.codename}</span>
                      </div>
                      <Badge variant={
                        (agent.trustScore ?? 0) >= 80 ? "default" :
                        (agent.trustScore ?? 0) >= 50 ? "secondary" :
                        "destructive"
                      }>
                        {agent.trustScore != null ? `${Math.round(agent.trustScore)}%` : "N/A"}
                      </Badge>
                    </div>

                    <TrustScoreBar
                      score={agent.trustScore ?? agent.trust ?? 0}
                      label="Overall Trust"
                    />

                    {agent.decisionAccuracy != null && (
                      <TrustScoreBar
                        score={agent.decisionAccuracy}
                        label="Decision Accuracy"
                      />
                    )}

                    {agent.taskCompletionRate != null && (
                      <TrustScoreBar
                        score={agent.taskCompletionRate}
                        label="Task Completion"
                      />
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                      <span>
                        {agent.decisionsCount ?? agent.totalDecisions ?? 0} decisions made
                      </span>
                      {agent.lastDecisionAt && (
                        <span>Last: {formatDistanceToNow(new Date(agent.lastDecisionAt), { addSuffix: true })}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )) : (
                <Card className="col-span-full">
                  <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                    No agent data available yet. Agents will appear once the system initializes.
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Revenue Attribution */}
          <TabsContent value="revenue" className="space-y-4">
            {revenue ? (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Total Attributed Revenue</p>
                      <p className="text-2xl font-bold">
                        ${((revenue.totalRevenue ?? revenue.total ?? 0) / 100).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Attribution Nodes</p>
                      <p className="text-2xl font-bold">{revenue.nodeCount ?? revenue.nodes?.length ?? 0}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Top Contributor</p>
                      <p className="text-lg font-bold">{revenue.topContributor ?? "N/A"}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Per-Agent Revenue */}
                {revenue.agents && Array.isArray(revenue.agents) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Revenue by Agent</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {revenue.agents.map((a: any, i: number) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-3.5 h-3.5 text-green-500" />
                              <span className="text-sm font-medium">{a.agent ?? a.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-32">
                                <Progress value={(a.share ?? a.percentage ?? 0)} className="h-2" />
                              </div>
                              <span className="text-sm font-medium w-20 text-right">
                                ${((a.revenue ?? a.amount ?? 0) / 100).toLocaleString()}
                              </span>
                            </div>
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
                  No revenue attribution data available yet.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Adaptive Strategies */}
          <TabsContent value="strategies" className="space-y-4">
            {Array.isArray(strategies) && strategies.length > 0 ? (
              strategies.map((strategy: any, i: number) => (
                <Card key={strategy.id ?? i}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-primary" />
                        <span className="font-medium text-sm">{strategy.name ?? strategy.title ?? "Strategy"}</span>
                      </div>
                      <Badge variant={strategy.status === "active" ? "default" : "secondary"}>
                        {strategy.status ?? "draft"}
                      </Badge>
                    </div>
                    {strategy.description && (
                      <p className="text-sm text-muted-foreground mt-2">{strategy.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      {strategy.confidence != null && (
                        <span>Confidence: {Math.round(strategy.confidence * 100)}%</span>
                      )}
                      {strategy.adoptedBy && (
                        <span>Adopted by: {Array.isArray(strategy.adoptedBy) ? strategy.adoptedBy.join(", ") : strategy.adoptedBy}</span>
                      )}
                      {strategy.updatedAt && (
                        <span>Updated {formatDistanceToNow(new Date(strategy.updatedAt), { addSuffix: true })}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                  No adaptive strategies active yet. The system will develop strategies as it learns from your business patterns.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
