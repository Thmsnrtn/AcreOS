import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Search, TrendingUp, BarChart3, Lightbulb, Loader2, GitBranch, Target, DollarSign, CheckCircle } from "lucide-react";

interface DealPattern {
  id: number;
  dealId: number;
  patternType: string;
  attributes: Record<string, any>;
  performanceData?: Record<string, any>;
  cloneCount?: number;
  successRate?: number;
  createdAt: string;
}

interface PatternStats {
  totalPatterns: number;
  avgSuccessRate: number;
  mostClonedPattern?: {
    patternType: string;
    cloneCount: number;
  };
}

interface PatternPerformance {
  totalPatterns: number;
  successfulPatterns: number;
  averageRoi: number;
  topPerformingPatterns: {
    patternId: number;
    matchCount: number;
    successRate: number;
    avgProfit: number;
  }[];
  patternsByOutcome: {
    success: number;
    partialSuccess: number;
    failure: number;
  };
}

function PatternCard({ pattern }: { pattern: DealPattern }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm capitalize">{pattern.patternType?.replace(/_/g, " ") || "Pattern"}</CardTitle>
          </div>
          {pattern.successRate !== undefined && (
            <Badge variant={pattern.successRate >= 0.7 ? "default" : "secondary"} className="text-xs">
              {Math.round(pattern.successRate * 100)}% success
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">Deal #{pattern.dealId}</div>

        {pattern.attributes && Object.keys(pattern.attributes).length > 0 && (
          <div className="space-y-1">
            {Object.entries(pattern.attributes).slice(0, 4).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {pattern.cloneCount !== undefined && pattern.cloneCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Copy className="w-3 h-3" />
            Used {pattern.cloneCount} time{pattern.cloneCount !== 1 ? "s" : ""}
          </div>
        )}

        <p className="text-xs text-muted-foreground">{new Date(pattern.createdAt).toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}

function PerformanceSection() {
  const { data, isLoading } = useQuery<{ performance: PatternPerformance }>({
    queryKey: ["/api/deal-patterns/performance"],
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const perf = data?.performance;
  if (!perf || perf.totalPatterns === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Close deals to start building your pattern library. Patterns are auto-extracted when deals close.
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = perf.patternsByOutcome.success + perf.patternsByOutcome.partialSuccess + perf.patternsByOutcome.failure;
  const successPct = total > 0 ? Math.round((perf.patternsByOutcome.success / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-primary" aria-hidden="true" />
        Pattern performance
      </h2>

      <dl className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Success rate</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{successPct}%</dd>
            <p className="text-xs text-muted-foreground tabular-nums">{perf.patternsByOutcome.success} of {total} deals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg ROI</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{perf.averageRoi.toFixed(1)}%</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Matches found</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">
              {perf.topPerformingPatterns.reduce((sum, p) => sum + p.matchCount, 0)}
            </dd>
          </CardContent>
        </Card>
      </dl>

      {perf.topPerformingPatterns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Top performing patterns</h3>
          <ol className="space-y-2" aria-label="Top performing deal patterns by match count">
            {perf.topPerformingPatterns.slice(0, 5).map((p) => (
              <li key={p.patternId} className="flex items-center justify-between p-3 rounded-lg border bg-card text-sm gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-primary" aria-hidden="true" />
                  <span>Pattern #<span className="tabular-nums">{p.patternId}</span></span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="tabular-nums">{p.matchCount} matches</span>
                  <Badge variant={p.successRate >= 0.7 ? "default" : "secondary"} className="text-xs tabular-nums">
                    {Math.round(p.successRate * 100)}% success
                  </Badge>
                  <span className="font-medium text-foreground tabular-nums">{usd(p.avgProfit)} avg profit</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Outcome distribution</span>
            <span className="tabular-nums">{total} patterns</span>
          </div>
          <div
            className="flex h-3 rounded-full overflow-hidden"
            role="img"
            aria-label={`Outcome distribution: ${perf.patternsByOutcome.success} success, ${perf.patternsByOutcome.partialSuccess} partial, ${perf.patternsByOutcome.failure} failed`}
          >
            <div className="bg-emerald-500" style={{ width: `${(perf.patternsByOutcome.success / total) * 100}%` }} />
            <div className="bg-amber-500" style={{ width: `${(perf.patternsByOutcome.partialSuccess / total) * 100}%` }} />
            <div className="bg-red-400" style={{ width: `${(perf.patternsByOutcome.failure / total) * 100}%` }} />
          </div>
          <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Outcome legend">
            <li className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />Success (<span className="tabular-nums">{perf.patternsByOutcome.success}</span>)</li>
            <li className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />Partial (<span className="tabular-nums">{perf.patternsByOutcome.partialSuccess}</span>)</li>
            <li className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" aria-hidden="true" />Failed (<span className="tabular-nums">{perf.patternsByOutcome.failure}</span>)</li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DealPatternsPage() {
  useDocumentTitle("Deal patterns");
  const { toast } = useToast();
  const qc = useQueryClient();
  const dealIdInput = useId();
  const propertyIdInput = useId();
  const [dealId, setDealId] = useState("");
  const [searchPropertyId, setSearchPropertyId] = useState("");

  const { data: stats } = useQuery<{ stats: PatternStats }>({
    queryKey: ["/api/deal-patterns/stats"],
    queryFn: () => fetch("/api/deal-patterns/stats").then(r => r.json()),
  });

  const { data: insights } = useQuery<{ insights: string[] }>({
    queryKey: ["/api/deal-patterns/insights"],
    queryFn: () => fetch("/api/deal-patterns/insights").then(r => r.json()),
  });

  const { data: similarPatterns, isLoading: searchLoading } = useQuery<{ patterns: DealPattern[] }>({
    queryKey: ["/api/deal-patterns/similar", searchPropertyId],
    queryFn: () =>
      fetch(`/api/deal-patterns/similar/${searchPropertyId}`).then(r => r.json()),
    enabled: !!searchPropertyId,
  });

  const extractMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/deal-patterns/extract/${id}`),
    onSuccess: () => {
      toast({ title: "Pattern extracted from deal" });
      qc.invalidateQueries({ queryKey: ["/api/deal-patterns/stats"] });
      qc.invalidateQueries({ queryKey: ["/api/deal-patterns/insights"] });
    },
    onError: () =>
      toast({
        title: "Couldn't extract pattern",
        description: "The deal is unchanged — try again, or check that the deal ID exists and is closed.",
        variant: "destructive",
      }),
  });

  const patternStats = stats?.stats;
  const insightsList = insights?.insights ?? [];
  const patterns = similarPatterns?.patterns ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-deal-patterns-title">
          Deal patterns
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Learn from closed deals and replicate what works.
        </p>
      </div>

      {patternStats && (
        <dl className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                <GitBranch className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Total patterns</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">{patternStats.totalPatterns}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Avg success rate</span>
              </dt>
              <dd className="text-2xl font-bold tabular-nums">{Math.round(patternStats.avgSuccessRate * 100)}%</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="flex items-center gap-2 text-muted-foreground mb-1">
                <Copy className="w-4 h-4" aria-hidden="true" />
                <span className="text-xs">Most cloned</span>
              </dt>
              <dd className="text-sm font-bold truncate capitalize">
                {patternStats.mostClonedPattern?.patternType?.replace(/_/g, " ") || "—"}
              </dd>
            </CardContent>
          </Card>
        </dl>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extract pattern from deal</CardTitle>
            <CardDescription>Analyze a closed deal to extract reusable patterns.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => { e.preventDefault(); if (dealId) extractMutation.mutate(dealId); }}
              className="flex gap-2"
            >
              <div>
                <Label htmlFor={dealIdInput} className="sr-only">Deal ID</Label>
                <Input
                  id={dealIdInput}
                  type="number"
                  placeholder="Deal ID"
                  value={dealId}
                  onChange={e => setDealId(e.target.value)}
                  className="w-32 tabular-nums"
                  inputMode="numeric"
                  min={1}
                />
              </div>
              <Button
                type="submit"
                disabled={!dealId || extractMutation.isPending}
                aria-label={dealId ? `Extract pattern from deal ${dealId}` : "Extract pattern"}
              >
                {extractMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Extracting…</>
                ) : (
                  "Extract"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Find similar patterns</CardTitle>
            <CardDescription>Find patterns matching a property you're evaluating.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <div>
              <Label htmlFor={propertyIdInput} className="sr-only">Property ID</Label>
              <Input
                id={propertyIdInput}
                type="number"
                placeholder="Property ID"
                value={searchPropertyId}
                onChange={e => setSearchPropertyId(e.target.value)}
                className="w-40 tabular-nums"
                inputMode="numeric"
                min={1}
              />
            </div>
            <Button variant="outline" disabled aria-label="Search (auto-runs as you type)">
              <Search className="w-4 h-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {insightsList.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" aria-hidden="true" />
            Pattern insights
          </h2>
          <ol className="space-y-2" aria-label="Pattern insights">
            {insightsList.map((insight, i) => (
              <li key={i} className="flex items-start gap-2 text-sm p-3 rounded-lg border bg-card">
                <span className="text-muted-foreground tabular-nums">#{i + 1}</span>
                <p>{insight}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {searchPropertyId && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Similar patterns for Property #<span className="tabular-nums">{searchPropertyId}</span></h2>
          {searchLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Searching…
            </div>
          ) : patterns.length === 0 ? (
            <p className="text-muted-foreground text-sm">No similar patterns found.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label={`Patterns matching property ${searchPropertyId}`}>
              {patterns.map(pattern => (
                <li key={pattern.id}><PatternCard pattern={pattern} /></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <PerformanceSection />
    </PageShell>
  );
}
