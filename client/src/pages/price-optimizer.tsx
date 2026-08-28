import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, DollarSign, Target, BarChart3, CheckCircle, Loader2
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import { DataProvenanceChip } from "@/components/data-provenance-chip";

interface PriceRecommendation {
  id: number;
  propertyId: number;
  recommendationType: string;
  recommendedPrice: string;
  priceRangeMin: string;
  priceRangeMax: string;
  confidence: string;
  reasoning?: string;
  comparablesSummary?: {
    count: number;
    medianPricePerAcre: number;
    avgDaysOnMarket?: number;
    recentTrend?: string;
  };
  strategy?: {
    targetMargin?: number;
    competitionLevel?: string;
    marketTiming?: string;
    quickSaleDiscount?: number;
  };
  createdAt: string;
}

interface AccuracyMetrics {
  totalRecommendations: number;
  recommendationsWithOutcome: number;
  averageAccuracy: number;
  acceptanceRate: number;
  avgPriceDeviation: number;
}

function formatPrice(val: string | number) {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return usd(n);
}

function RecommendationCard({ rec }: { rec: PriceRecommendation }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const actualPriceId = useId();
  const acceptedSwitchId = useId();
  const [actualPrice, setActualPrice] = useState("");
  const [accepted, setAccepted] = useState(true);
  const [showOutcome, setShowOutcome] = useState(false);

  const recordOutcome = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/outcome/${rec.id}`, {
        actualPrice: parseFloat(actualPrice),
        accepted,
      }),
    onSuccess: () => {
      toast({ title: "Outcome recorded" });
      setShowOutcome(false);
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer/accuracy/stats"] });
    },
    onError: () =>
      toast({
        title: "Couldn't record outcome",
        description: "The recommendation history is unchanged. Try again, or open the property to update manually.",
        variant: "destructive",
      }),
  });

  const typeLabel: Record<string, string> = {
    acquisition_offer: "Acquisition offer",
    disposition_list: "Disposition price",
    counter_offer: "Counter offer",
  };

  const typeIcon: Record<string, React.ReactNode> = {
    acquisition_offer: <TrendingDown className="w-4 h-4 text-acr-accent" aria-hidden="true" />,
    disposition_list: <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />,
    counter_offer: <Target className="w-4 h-4 text-acr-warn" aria-hidden="true" />,
  };

  const confRaw = Math.round(parseFloat(rec.confidence) * 100);
  const confPct = Number.isFinite(confRaw) ? confRaw : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {typeIcon[rec.recommendationType] || <DollarSign className="w-4 h-4" aria-hidden="true" />}
            <CardTitle className="text-sm">{typeLabel[rec.recommendationType] || rec.recommendationType}</CardTitle>
          </div>
          <DataProvenanceChip
            source="Price model"
            confidence={confPct}
            classification="modeled"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-2xl font-bold tabular-nums">{formatPrice(rec.recommendedPrice)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Range: {formatPrice(rec.priceRangeMin)} – {formatPrice(rec.priceRangeMax)}
          </p>
        </div>

        {rec.reasoning && (
          <p className="text-sm text-muted-foreground border-l-2 border-primary/30 pl-3">{rec.reasoning}</p>
        )}

        {rec.comparablesSummary && rec.comparablesSummary.count > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>
              <span className="tabular-nums">{rec.comparablesSummary.count}</span> comparables · Median{" "}
              <span className="tabular-nums">{formatPrice(rec.comparablesSummary.medianPricePerAcre)}</span>/acre
            </p>
            {rec.comparablesSummary.recentTrend && (
              <p>Market trend: <span className="font-medium capitalize">{rec.comparablesSummary.recentTrend}</span></p>
            )}
          </div>
        )}

        {rec.strategy && (
          <ul className="flex flex-wrap gap-1" aria-label="Strategy badges">
            {rec.strategy.competitionLevel && (
              <li><Badge variant="secondary" className="text-xs capitalize">{rec.strategy.competitionLevel} competition</Badge></li>
            )}
            {rec.strategy.marketTiming && (
              <li><Badge variant="secondary" className="text-xs capitalize">{rec.strategy.marketTiming.replace(/_/g, " ")}</Badge></li>
            )}
          </ul>
        )}

        {showOutcome ? (
          <form
            onSubmit={(e) => { e.preventDefault(); if (actualPrice) recordOutcome.mutate(); }}
            className="space-y-2 pt-2 border-t"
          >
            <Label htmlFor={actualPriceId} className="text-xs">Actual price</Label>
            <Input
              id={actualPriceId}
              type="number"
              placeholder="Enter actual price"
              value={actualPrice}
              onChange={e => setActualPrice(e.target.value)}
              className="h-8 text-sm tabular-nums"
              inputMode="decimal"
              step="0.01"
              min={0}
              required
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Switch id={acceptedSwitchId} checked={accepted} onCheckedChange={setAccepted} />
              <Label htmlFor={acceptedSwitchId} className="text-xs cursor-pointer">Price accepted</Label>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={!actualPrice || recordOutcome.isPending}
              >
                {recordOutcome.isPending ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : "Save"}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowOutcome(false)}>
                {Verbs.CANCEL}
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full mt-1"
            onClick={() => setShowOutcome(true)}
            aria-label={`Record outcome for ${typeLabel[rec.recommendationType] || rec.recommendationType}`}
          >
            Record outcome
          </Button>
        )}

        <p className="text-xs text-muted-foreground tabular-nums">{formatDate(rec.createdAt)}</p>
      </CardContent>
    </Card>
  );
}

export default function PriceOptimizerPage() {
  useDocumentTitle("Price optimizer");
  const { toast } = useToast();
  const qc = useQueryClient();
  const propertyIdInput = useId();
  const targetMarginId = useId();
  const quickSaleId = useId();
  const currentOfferId = useId();
  const sellerAskId = useId();
  const [propertyId, setPropertyId] = useState("");
  const [activeTab, setActiveTab] = useState("recommend");
  const [targetMargin, setTargetMargin] = useState("30");
  const [quickSale, setQuickSale] = useState(false);
  const [currentOffer, setCurrentOffer] = useState("");
  const [sellerAsk, setSellerAsk] = useState("");

  const { data: recommendations, isLoading: recsLoading } = useQuery<{ recommendations: PriceRecommendation[] }>({
    queryKey: ["/api/price-optimizer", propertyId],
    queryFn: () =>
      propertyId
        ? fetch(`/api/price-optimizer/${propertyId}`).then(r => r.json())
        : Promise.resolve({ recommendations: [] }),
    enabled: !!propertyId,
  });

  const { data: accuracyData } = useQuery<{ metrics: AccuracyMetrics }>({
    queryKey: ["/api/price-optimizer/accuracy/stats"],
    queryFn: () => fetch("/api/price-optimizer/accuracy/stats").then(r => r.json()),
  });

  const reassurance = "Your inputs are unchanged — try again. The property's existing recommendations stay intact.";

  const acquisitionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/${propertyId}/acquisition`, {
        targetMargin: parseFloat(targetMargin) / 100,
      }),
    onSuccess: () => {
      toast({ title: "Acquisition price recommendation generated" });
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer", propertyId] });
    },
    onError: () =>
      toast({
        title: "Couldn't generate acquisition price",
        description: reassurance,
        variant: "destructive",
      }),
  });

  const dispositionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/${propertyId}/disposition`, { quickSale }),
    onSuccess: () => {
      toast({ title: "Disposition price recommendation generated" });
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer", propertyId] });
    },
    onError: () =>
      toast({
        title: "Couldn't generate list price",
        description: reassurance,
        variant: "destructive",
      }),
  });

  const counterMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/${propertyId}/counter`, {
        currentOffer: parseFloat(currentOffer),
        sellerAsk: parseFloat(sellerAsk),
      }),
    onSuccess: () => {
      toast({ title: "Counter-offer recommendation generated" });
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer", propertyId] });
    },
    onError: () =>
      toast({
        title: "Couldn't generate counter-offer",
        description: reassurance,
        variant: "destructive",
      }),
  });

  const metrics = accuracyData?.metrics;

  return (
    <PageShell label="Price optimizer">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-price-optimizer-title">
          Price optimizer
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Pricing for acquisitions, dispositions, and counter-offers.
        </p>
      </div>

      {metrics && metrics.totalRecommendations > 0 && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total recommendations", value: metrics.totalRecommendations.toString(), icon: BarChart3 },
            { label: "Avg accuracy", value: `${Math.round(metrics.averageAccuracy * 100)}%`, icon: Target },
            { label: "Acceptance rate", value: `${Math.round(metrics.acceptanceRate * 100)}%`, icon: CheckCircle },
            { label: "Avg price deviation", value: `${Math.round(metrics.avgPriceDeviation * 100)}%`, icon: TrendingUp },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <dt className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Icon className="w-3 h-3" aria-hidden="true" />
                  {label}
                </dt>
                <dd className="text-xl font-bold tabular-nums">{value}</dd>
              </CardContent>
            </Card>
          ))}
        </dl>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Get price recommendation</CardTitle>
          <CardDescription>Enter a property ID to generate a price recommendation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor={propertyIdInput} className="text-xs">Property ID</Label>
              <Input
                id={propertyIdInput}
                type="number"
                placeholder="e.g. 42"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="mt-1 tabular-nums"
                inputMode="numeric"
                min={1}
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="recommend" className="text-xs">Acquisition</TabsTrigger>
              <TabsTrigger value="disposition" className="text-xs">Disposition</TabsTrigger>
              <TabsTrigger value="counter" className="text-xs">Counter offer</TabsTrigger>
            </TabsList>

            <TabsContent value="recommend" className="space-y-3 pt-3">
              <form
                onSubmit={(e) => { e.preventDefault(); if (propertyId) acquisitionMutation.mutate(); }}
                className="space-y-3"
              >
                <div>
                  <Label htmlFor={targetMarginId} className="text-xs">Target margin (%)</Label>
                  <Input
                    id={targetMarginId}
                    type="number"
                    min="5"
                    max="70"
                    value={targetMargin}
                    onChange={e => setTargetMargin(e.target.value)}
                    className="mt-1 w-32 tabular-nums"
                    inputMode="numeric"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!propertyId || acquisitionMutation.isPending}
                  aria-label={propertyId ? `Get acquisition price for property ${propertyId}` : "Get acquisition price"}
                >
                  {acquisitionMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Analyzing…</>
                  ) : (
                    "Get acquisition price"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="disposition" className="space-y-3 pt-3">
              <form
                onSubmit={(e) => { e.preventDefault(); if (propertyId) dispositionMutation.mutate(); }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Switch id={quickSaleId} checked={quickSale} onCheckedChange={setQuickSale} />
                  <Label htmlFor={quickSaleId} className="text-sm cursor-pointer">Quick sale (15% discount for faster close)</Label>
                </div>
                <Button
                  type="submit"
                  disabled={!propertyId || dispositionMutation.isPending}
                  aria-label={propertyId ? `Get list price for property ${propertyId}` : "Get list price"}
                >
                  {dispositionMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Analyzing…</>
                  ) : (
                    "Get list price"
                  )}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="counter" className="space-y-3 pt-3">
              <form
                onSubmit={(e) => { e.preventDefault(); if (propertyId && currentOffer && sellerAsk) counterMutation.mutate(); }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={currentOfferId} className="text-xs">Your current offer ($)</Label>
                    <Input
                      id={currentOfferId}
                      type="number"
                      placeholder="e.g. 45000"
                      value={currentOffer}
                      onChange={e => setCurrentOffer(e.target.value)}
                      className="mt-1 tabular-nums"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                    />
                  </div>
                  <div>
                    <Label htmlFor={sellerAskId} className="text-xs">Seller's ask ($)</Label>
                    <Input
                      id={sellerAskId}
                      type="number"
                      placeholder="e.g. 70000"
                      value={sellerAsk}
                      onChange={e => setSellerAsk(e.target.value)}
                      className="mt-1 tabular-nums"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={!propertyId || !currentOffer || !sellerAsk || counterMutation.isPending}
                  aria-label={propertyId ? `Get counter-offer for property ${propertyId}` : "Get counter-offer"}
                >
                  {counterMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Analyzing…</>
                  ) : (
                    "Get counter offer"
                  )}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {propertyId && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Recommendations for Property #<span className="tabular-nums">{propertyId}</span></h2>
          {recsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-live="polite">
              <span className="sr-only">Loading price recommendations…</span>
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6 space-y-3">
                    <Skeleton announce={false} className="h-5 w-28" />
                    <Skeleton announce={false} className="h-8 w-24" />
                    <Skeleton announce={false} className="h-4 w-full" />
                    <Skeleton announce={false} className="h-4 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recommendations?.recommendations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No recommendations yet. Generate one above.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label={`Price recommendations for property ${propertyId}`}>
              {recommendations?.recommendations.map(rec => (
                <li key={rec.id}><RecommendationCard rec={rec} /></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PageShell>
  );
}
