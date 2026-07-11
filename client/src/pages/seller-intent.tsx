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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { usd, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Thermometer, Wind, Snowflake, Loader2, TrendingUp, DollarSign, Clock } from "lucide-react";

interface SellerIntentPrediction {
  id: number;
  leadId: number;
  intentScore: number;
  intentLevel: string;
  urgencyScore?: number;
  signals?: {
    hasRecentEnquiry?: boolean;
    hasCallBack?: boolean;
    hasMultipleContacts?: boolean;
    hasExpressedTimeframe?: boolean;
    hasAskedForOffer?: boolean;
    hasNegotiatedPrice?: boolean;
  };
  recommendedApproach?: string;
  offerRange?: {
    min: number;
    max: number;
  };
  createdAt: string;
}

const INTENT_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  hot: { icon: Flame, color: "text-acr-neg", label: "Hot" },
  warm: { icon: Thermometer, color: "text-acr-warn", label: "Warm" },
  cool: { icon: Wind, color: "text-acr-accent", label: "Cool" },
  cold: { icon: Snowflake, color: "text-acr-accent", label: "Cold" },
};

const SIGNAL_LABELS: Record<string, string> = {
  hasRecentEnquiry: "Recent enquiry",
  hasCallBack: "Called back",
  hasMultipleContacts: "Multiple contacts",
  hasExpressedTimeframe: "Expressed timeframe",
  hasAskedForOffer: "Asked for offer",
  hasNegotiatedPrice: "Negotiated price",
};

function IntentCard({ prediction }: { prediction: SellerIntentPrediction }) {
  const config = INTENT_CONFIG[prediction.intentLevel] || INTENT_CONFIG.cool;
  const Icon = config.icon;
  const signals = prediction.signals ?? {};
  const activeSignals = Object.entries(signals).filter(([, v]) => v === true);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-5 h-5 shrink-0 ${config.color}`} aria-label={`${config.label} intent`} />
            <CardTitle className="text-sm truncate">Lead #<span className="tabular-nums">{prediction.leadId}</span></CardTitle>
          </div>
          <Badge variant={prediction.intentLevel === "hot" ? "destructive" : "outline"} className="capitalize">
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Intent score</span>
            <span className="font-medium tabular-nums">{prediction.intentScore}/100</span>
          </div>
          <Progress
            value={prediction.intentScore}
            className="h-2"
            aria-label={`Intent score ${prediction.intentScore} of 100`}
          />
        </div>

        {prediction.urgencyScore !== undefined && (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Urgency score</span>
              <span className="font-medium tabular-nums">{prediction.urgencyScore}/100</span>
            </div>
            <Progress
              value={prediction.urgencyScore}
              className="h-1.5"
              aria-label={`Urgency score ${prediction.urgencyScore} of 100`}
            />
          </div>
        )}

        {activeSignals.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Active intent signals">
            {activeSignals.map(([key]) => (
              <li key={key}>
                <Badge variant="secondary" className="text-xs">
                  {SIGNAL_LABELS[key] || key}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {prediction.recommendedApproach && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
            {prediction.recommendedApproach}
          </p>
        )}

        {prediction.offerRange && (
          <div className="flex items-center gap-1 text-xs">
            <DollarSign className="w-3 h-3 text-acr-pos" aria-hidden="true" />
            <span className="text-muted-foreground">
              Offer range: <span className="tabular-nums">{usd(prediction.offerRange.min)}</span> – <span className="tabular-nums">{usd(prediction.offerRange.max)}</span>
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground tabular-nums">{formatDate(prediction.createdAt)}</p>
      </CardContent>
    </Card>
  );
}

export default function SellerIntentPage() {
  useDocumentTitle("Seller intent");
  const { toast } = useToast();
  const qc = useQueryClient();
  const leadIdInputId = useId();
  const [leadId, setLeadId] = useState("");

  const { data: hotLeads, isLoading } = useQuery<{ predictions: SellerIntentPrediction[] }>({
    queryKey: ["/api/seller-intent/hot-leads"],
    queryFn: () => fetch("/api/seller-intent/hot-leads").then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); }),
  });

  const { data: prediction } = useQuery<{ prediction: SellerIntentPrediction }>({
    queryKey: ["/api/seller-intent", leadId],
    queryFn: () => fetch(`/api/seller-intent/${leadId}`).then(r => { if (!r.ok) throw new Error(`Failed (${r.status})`); return r.json(); }),
    enabled: !!leadId,
  });

  const predictMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/seller-intent/${id}/predict`),
    onSuccess: () => {
      toast({ title: "Seller intent analysis complete" });
      qc.invalidateQueries({ queryKey: ["/api/seller-intent", leadId] });
      qc.invalidateQueries({ queryKey: ["/api/seller-intent/hot-leads"] });
    },
    onError: () =>
      toast({
        title: "Analysis didn't run",
        description: "The lead's previous intent score is unchanged. Try again in a moment.",
        variant: "destructive",
      }),
  });

  const onAnalyzeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (leadId) predictMutation.mutate(leadId);
  };

  const hotPredictions = hotLeads?.predictions ?? [];
  const hotCount = hotPredictions.filter(p => p.intentLevel === "hot").length;
  const warmCount = hotPredictions.filter(p => p.intentLevel === "warm").length;
  const avgIntent = hotPredictions.length > 0
    ? Math.round(hotPredictions.reduce((s, p) => s + p.intentScore, 0) / hotPredictions.length)
    : null;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-seller-intent-title">
          Seller intent
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-predicted seller motivation and recommended outreach approach.
        </p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-acr-neg mb-1">
              <Flame className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Hot leads</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{hotCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-acr-warn mb-1">
              <Thermometer className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Warm leads</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{warmCount}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Total tracked</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{hotPredictions.length}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg intent score</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">
              {avgIntent ?? "—"}
            </dd>
          </CardContent>
        </Card>
      </dl>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze lead intent</CardTitle>
          <CardDescription>Enter a lead ID to run or view their seller intent analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onAnalyzeSubmit} className="flex gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <Label htmlFor={leadIdInputId} className="sr-only">Lead ID</Label>
              <Input
                id={leadIdInputId}
                type="number"
                placeholder="Lead ID"
                value={leadId}
                onChange={e => setLeadId(e.target.value)}
                className="w-40 tabular-nums"
                inputMode="numeric"
                min={1}
              />
            </div>
            <Button
              type="submit"
              disabled={!leadId || predictMutation.isPending}
              aria-label={leadId ? `Analyze lead ${leadId}` : "Analyze lead intent"}
            >
              {predictMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Analyzing…</>
              ) : (
                "Analyze"
              )}
            </Button>
          </form>

          {leadId && prediction?.prediction && (
            <div className="mt-4">
              <IntentCard prediction={prediction.prediction} />
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-live="polite">
          <span className="sr-only">Loading seller intent data…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <Skeleton announce={false} className="h-5 w-24" />
                  <Skeleton announce={false} className="h-5 w-14" />
                </div>
                <Skeleton announce={false} className="h-4 w-full" />
                <Skeleton announce={false} className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : hotPredictions.length > 0 ? (
        <section aria-labelledby="high-priority-heading">
          <h2 id="high-priority-heading" className="text-lg font-semibold mb-3">High-priority sellers</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Hot and warm seller leads">
            {hotPredictions.map(p => (
              <li key={p.id}>
                <IntentCard prediction={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No seller intent data yet. Run an analysis on individual leads above.
        </div>
      )}
    </PageShell>
  );
}
