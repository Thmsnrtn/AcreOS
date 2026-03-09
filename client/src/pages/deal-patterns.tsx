import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Copy, Search, TrendingUp, BarChart3, Lightbulb, Loader2, GitBranch } from "lucide-react";

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

export default function DealPatternsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
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
    onError: () => toast({ title: "Failed to extract pattern", variant: "destructive" }),
  });

  const patternStats = stats?.stats;
  const insightsList = insights?.insights ?? [];
  const patterns = similarPatterns?.patterns ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-deal-patterns-title">
          Deal Patterns
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Learn from closed deals and replicate what works.
        </p>
      </div>

      {patternStats && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <GitBranch className="w-4 h-4" />
                <span className="text-xs">Total Patterns</span>
              </div>
              <p className="text-2xl font-bold">{patternStats.totalPatterns}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">Avg Success Rate</span>
              </div>
              <p className="text-2xl font-bold">{Math.round(patternStats.avgSuccessRate * 100)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Copy className="w-4 h-4" />
                <span className="text-xs">Most Cloned</span>
              </div>
              <p className="text-sm font-bold truncate capitalize">
                {patternStats.mostClonedPattern?.patternType?.replace(/_/g, " ") || "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Extract Pattern from Deal</CardTitle>
            <CardDescription>Analyze a closed deal to extract reusable patterns.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              type="number"
              placeholder="Deal ID"
              value={dealId}
              onChange={e => setDealId(e.target.value)}
              className="w-32"
            />
            <Button
              onClick={() => dealId && extractMutation.mutate(dealId)}
              disabled={!dealId || extractMutation.isPending}
            >
              {extractMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Extracting...</>
              ) : (
                "Extract"
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Find Similar Patterns</CardTitle>
            <CardDescription>Find patterns matching a property you're evaluating.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              type="number"
              placeholder="Property ID"
              value={searchPropertyId}
              onChange={e => setSearchPropertyId(e.target.value)}
              className="w-40"
            />
            <Button variant="outline" disabled>
              <Search className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {insightsList.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-500" />
            Pattern Insights
          </h2>
          <div className="space-y-2">
            {insightsList.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-sm p-3 rounded-lg border bg-card">
                <span className="text-muted-foreground">#{i + 1}</span>
                <p>{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {searchPropertyId && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Similar Patterns for Property #{searchPropertyId}</h2>
          {searchLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching...
            </div>
          ) : patterns.length === 0 ? (
            <p className="text-muted-foreground text-sm">No similar patterns found.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {patterns.map(pattern => (
                <PatternCard key={pattern.id} pattern={pattern} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
