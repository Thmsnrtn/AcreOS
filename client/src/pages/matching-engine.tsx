import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Zap, Target, Users, MapPin, DollarSign, Star, Loader2, RefreshCw } from "lucide-react";

interface Match {
  id: number;
  propertyId: number;
  buyerId: number;
  propertyAddress: string;
  buyerName: string;
  matchScore: number;
  matchReasons: string[];
  estimatedDealProbability: number;
  suggestedOfferCents?: number;
  createdAt: string;
}

export default function MatchingEnginePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propertyId, setPropertyId] = useState("");
  const [buyerId, setBuyerId] = useState("");

  const { data, isLoading } = useQuery<{ matches: Match[]; totalActive: number }>({
    queryKey: ["/api/matching/top-matches"],
    queryFn: () => fetch("/api/matching/top-matches").then(r => r.json()),
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/matching/run", {
      propertyId: propertyId ? parseInt(propertyId) : undefined,
      buyerId: buyerId ? parseInt(buyerId) : undefined,
    }),
    onSuccess: async (res) => {
      const d = await res.json();
      toast({ title: `${d.matchesFound ?? 0} matches found` });
      qc.invalidateQueries({ queryKey: ["/api/matching"] });
    },
    onError: () => toast({ title: "Matching failed", variant: "destructive" }),
  });

  const notifyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/matching/${id}/notify`),
    onSuccess: () => toast({ title: "Buyer notified" }),
    onError: () => toast({ title: "Notification failed", variant: "destructive" }),
  });

  const matches = data?.matches ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-matching-engine-title">
          Buyer Matching Engine
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-powered matching between properties and qualified buyers based on criteria fit.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="w-4 h-4" />
              <span className="text-xs">Active Matches</span>
            </div>
            <p className="text-2xl font-bold">{data?.totalActive ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Star className="w-4 h-4" />
              <span className="text-xs">Avg Match Score</span>
            </div>
            <p className="text-2xl font-bold">
              {matches.length > 0
                ? Math.round(matches.reduce((s, m) => s + m.matchScore, 0) / matches.length)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Matching</CardTitle>
          <CardDescription>Find buyer matches for a specific property or run matches for a buyer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                type="number"
                placeholder="Property ID (optional)"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <Input
                type="number"
                placeholder="Buyer ID (optional)"
                value={buyerId}
                onChange={e => setBuyerId(e.target.value)}
              />
            </div>
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
              {runMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <><Zap className="w-4 h-4 mr-1" />Match</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading matches...
        </div>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No active matches yet. Run the matching engine to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Top Matches</h2>
          {matches.map(m => (
            <Card key={m.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{m.propertyAddress}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{m.buyerName}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-primary">{m.matchScore}%</div>
                    <div className="text-xs text-muted-foreground">match</div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Deal Probability</span>
                    <span>{m.estimatedDealProbability}%</span>
                  </div>
                  <Progress value={m.estimatedDealProbability} className="h-1.5" />
                </div>

                <div className="flex flex-wrap gap-1">
                  {m.matchReasons.map(r => (
                    <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                  ))}
                </div>

                {m.suggestedOfferCents && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <DollarSign className="w-3 h-3" />
                    Suggested offer: ${(m.suggestedOfferCents / 100).toLocaleString()}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => notifyMutation.mutate(m.id)}>
                    Notify Buyer
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
