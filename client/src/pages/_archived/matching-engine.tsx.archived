import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Zap, Target, Users, MapPin, DollarSign, Star, Loader2 } from "lucide-react";

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
  useDocumentTitle("Buyer matching engine");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [propertyId, setPropertyId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const propertyIdInputId = useId();
  const buyerIdInputId = useId();

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
      toast({ title: `${d.matchesFound ?? 0} matches found.` });
      qc.invalidateQueries({ queryKey: ["/api/matching"] });
    },
    onError: () =>
      toast({
        title: "Couldn't run matching",
        description: "No new matches were generated — your existing matches are unchanged.",
        variant: "destructive",
      }),
  });

  const notifyMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/matching/${id}/notify`),
    onSuccess: () => toast({ title: "Buyer notified." }),
    onError: () =>
      toast({
        title: "Couldn't notify buyer",
        description: "No email was sent. The match is unchanged — try again in a moment.",
        variant: "destructive",
      }),
  });

  const matches = data?.matches ?? [];

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-matching-engine-title">
          Buyer matching engine
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Matches properties with qualified buyers based on criteria fit.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Zap className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Active matches</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{data?.totalActive ?? 0}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Star className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg match score</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">
              {matches.length > 0
                ? Math.round(matches.reduce((s, m) => s + m.matchScore, 0) / matches.length)
                : "—"}
            </dd>
          </CardContent>
        </Card>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run matching</CardTitle>
          <CardDescription>Find buyer matches for a specific property or run matches for a buyer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (!runMutation.isPending) runMutation.mutate(); }}
          >
            <div className="flex flex-wrap gap-2">
              <div className="flex-1 min-w-[150px]">
                <Label htmlFor={propertyIdInputId} className="sr-only">Property ID (optional)</Label>
                <Input
                  id={propertyIdInputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="Property ID (optional)"
                  value={propertyId}
                  onChange={e => setPropertyId(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <Label htmlFor={buyerIdInputId} className="sr-only">Buyer ID (optional)</Label>
                <Input
                  id={buyerIdInputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="Buyer ID (optional)"
                  value={buyerId}
                  onChange={e => setBuyerId(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={runMutation.isPending} className="min-h-11">
                {runMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <><Zap className="w-4 h-4 mr-1" aria-hidden="true" />Match</>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading matches…
        </div>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="w-8 h-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
            <p className="text-muted-foreground text-sm">No active matches yet. Run the matching engine to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Top matches</h2>
          <ul className="space-y-3" aria-label="Top property-buyer matches">
            {matches.map(m => (
              <li key={m.id}>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="text-sm font-medium">{m.propertyAddress}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                          <span className="text-xs text-muted-foreground">{m.buyerName}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-lg font-bold text-primary tabular-nums"
                          aria-label={`Match score ${m.matchScore} percent`}
                        >
                          {m.matchScore}%
                        </div>
                        <div className="text-xs text-muted-foreground">match</div>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Deal probability</span>
                        <span className="tabular-nums">{m.estimatedDealProbability}%</span>
                      </div>
                      <Progress
                        value={m.estimatedDealProbability}
                        className="h-1.5"
                        aria-label={`Deal probability for ${m.propertyAddress} and ${m.buyerName}: ${m.estimatedDealProbability}%`}
                      />
                    </div>

                    {m.matchReasons.length > 0 && (
                      <ul className="flex flex-wrap gap-1" aria-label="Match reasons">
                        {m.matchReasons.map(r => (
                          <li key={r}>
                            <Badge variant="secondary" className="text-xs">{r}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}

                    {m.suggestedOfferCents && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <DollarSign className="w-3 h-3" aria-hidden="true" />
                        <span className="tabular-nums">Suggested offer: {usd(m.suggestedOfferCents / 100)}</span>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => notifyMutation.mutate(m.id)}
                        disabled={notifyMutation.isPending}
                        className="min-h-9"
                        aria-label={`Notify ${m.buyerName} about ${m.propertyAddress}`}
                      >
                        Notify buyer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
