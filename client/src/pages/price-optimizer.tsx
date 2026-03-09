import { useState } from "react";
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
import {
  TrendingUp, TrendingDown, DollarSign, Target, BarChart3, RefreshCw, CheckCircle, XCircle, Loader2
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function confidenceColor(conf: string) {
  const c = parseFloat(conf);
  if (c >= 0.8) return "text-green-600";
  if (c >= 0.6) return "text-yellow-600";
  return "text-red-600";
}

function RecommendationCard({ rec }: { rec: PriceRecommendation }) {
  const qc = useQueryClient();
  const { toast } = useToast();
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
    onError: () => toast({ title: "Failed to record outcome", variant: "destructive" }),
  });

  const typeLabel: Record<string, string> = {
    acquisition_offer: "Acquisition Offer",
    disposition_list: "Disposition Price",
    counter_offer: "Counter Offer",
  };

  const typeIcon: Record<string, React.ReactNode> = {
    acquisition_offer: <TrendingDown className="w-4 h-4 text-blue-500" />,
    disposition_list: <TrendingUp className="w-4 h-4 text-green-500" />,
    counter_offer: <Target className="w-4 h-4 text-orange-500" />,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {typeIcon[rec.recommendationType] || <DollarSign className="w-4 h-4" />}
            <CardTitle className="text-sm">{typeLabel[rec.recommendationType] || rec.recommendationType}</CardTitle>
          </div>
          <Badge variant="outline" className={`text-xs ${confidenceColor(rec.confidence)}`}>
            {Math.round(parseFloat(rec.confidence) * 100)}% confident
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-2xl font-bold">{formatPrice(rec.recommendedPrice)}</p>
          <p className="text-xs text-muted-foreground">
            Range: {formatPrice(rec.priceRangeMin)} – {formatPrice(rec.priceRangeMax)}
          </p>
        </div>

        {rec.reasoning && (
          <p className="text-sm text-muted-foreground border-l-2 border-primary/30 pl-3">{rec.reasoning}</p>
        )}

        {rec.comparablesSummary && rec.comparablesSummary.count > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>{rec.comparablesSummary.count} comparables · Median {formatPrice(rec.comparablesSummary.medianPricePerAcre)}/acre</p>
            {rec.comparablesSummary.recentTrend && (
              <p>Market trend: <span className="font-medium capitalize">{rec.comparablesSummary.recentTrend}</span></p>
            )}
          </div>
        )}

        {rec.strategy && (
          <div className="flex flex-wrap gap-1">
            {rec.strategy.competitionLevel && (
              <Badge variant="secondary" className="text-xs capitalize">{rec.strategy.competitionLevel} competition</Badge>
            )}
            {rec.strategy.marketTiming && (
              <Badge variant="secondary" className="text-xs capitalize">{rec.strategy.marketTiming.replace(/_/g, " ")}</Badge>
            )}
          </div>
        )}

        {showOutcome ? (
          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs">Actual Price</Label>
            <Input
              type="number"
              placeholder="Enter actual price"
              value={actualPrice}
              onChange={e => setActualPrice(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex items-center gap-2">
              <Switch checked={accepted} onCheckedChange={setAccepted} />
              <Label className="text-xs">Price accepted</Label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => recordOutcome.mutate()}
                disabled={!actualPrice || recordOutcome.isPending}
              >
                {recordOutcome.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowOutcome(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs w-full mt-1"
            onClick={() => setShowOutcome(true)}
          >
            Record Outcome
          </Button>
        )}

        <p className="text-xs text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}

export default function PriceOptimizerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
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

  const acquisitionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/${propertyId}/acquisition`, {
        targetMargin: parseFloat(targetMargin) / 100,
      }),
    onSuccess: () => {
      toast({ title: "Acquisition price recommendation generated" });
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer", propertyId] });
    },
    onError: () => toast({ title: "Failed to generate recommendation", variant: "destructive" }),
  });

  const dispositionMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/price-optimizer/${propertyId}/disposition`, { quickSale }),
    onSuccess: () => {
      toast({ title: "Disposition price recommendation generated" });
      qc.invalidateQueries({ queryKey: ["/api/price-optimizer", propertyId] });
    },
    onError: () => toast({ title: "Failed to generate recommendation", variant: "destructive" }),
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
    onError: () => toast({ title: "Failed to generate recommendation", variant: "destructive" }),
  });

  const metrics = accuracyData?.metrics;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-price-optimizer-title">
          Price Optimizer
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-powered pricing for acquisitions, dispositions, and counter-offers.
        </p>
      </div>

      {metrics && metrics.totalRecommendations > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Recommendations", value: metrics.totalRecommendations, icon: BarChart3 },
            { label: "Avg Accuracy", value: `${Math.round(metrics.averageAccuracy * 100)}%`, icon: Target },
            { label: "Acceptance Rate", value: `${Math.round(metrics.acceptanceRate * 100)}%`, icon: CheckCircle },
            { label: "Avg Price Deviation", value: `${Math.round(metrics.avgPriceDeviation * 100)}%`, icon: TrendingUp },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Icon className="w-3 h-3" />
                  {label}
                </div>
                <p className="text-xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Get Price Recommendation</CardTitle>
          <CardDescription>Enter a property ID to generate an AI-powered price recommendation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="propertyId" className="text-xs">Property ID</Label>
              <Input
                id="propertyId"
                type="number"
                placeholder="e.g. 42"
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="recommend" className="text-xs">Acquisition</TabsTrigger>
              <TabsTrigger value="disposition" className="text-xs">Disposition</TabsTrigger>
              <TabsTrigger value="counter" className="text-xs">Counter Offer</TabsTrigger>
            </TabsList>

            <TabsContent value="recommend" className="space-y-3 pt-3">
              <div>
                <Label className="text-xs">Target Margin (%)</Label>
                <Input
                  type="number"
                  min="5"
                  max="70"
                  value={targetMargin}
                  onChange={e => setTargetMargin(e.target.value)}
                  className="mt-1 w-32"
                />
              </div>
              <Button
                disabled={!propertyId || acquisitionMutation.isPending}
                onClick={() => acquisitionMutation.mutate()}
              >
                {acquisitionMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  "Get Acquisition Price"
                )}
              </Button>
            </TabsContent>

            <TabsContent value="disposition" className="space-y-3 pt-3">
              <div className="flex items-center gap-2">
                <Switch checked={quickSale} onCheckedChange={setQuickSale} />
                <Label className="text-sm">Quick sale (15% discount for faster close)</Label>
              </div>
              <Button
                disabled={!propertyId || dispositionMutation.isPending}
                onClick={() => dispositionMutation.mutate()}
              >
                {dispositionMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  "Get List Price"
                )}
              </Button>
            </TabsContent>

            <TabsContent value="counter" className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Your Current Offer ($)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 45000"
                    value={currentOffer}
                    onChange={e => setCurrentOffer(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Seller's Ask ($)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 70000"
                    value={sellerAsk}
                    onChange={e => setSellerAsk(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button
                disabled={!propertyId || !currentOffer || !sellerAsk || counterMutation.isPending}
                onClick={() => counterMutation.mutate()}
              >
                {counterMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  "Get Counter Offer"
                )}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {propertyId && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Recommendations for Property #{propertyId}</h2>
          {recsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : recommendations?.recommendations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No recommendations yet. Generate one above.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recommendations?.recommendations.map(rec => (
                <RecommendationCard key={rec.id} rec={rec} />
              ))}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}
