import { useState } from "react";
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
import { Flame, Thermometer, Wind, Snowflake, Loader2, TrendingUp, Phone, DollarSign, Clock } from "lucide-react";

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
  hot: { icon: Flame, color: "text-red-500", label: "Hot" },
  warm: { icon: Thermometer, color: "text-orange-500", label: "Warm" },
  cool: { icon: Wind, color: "text-blue-400", label: "Cool" },
  cold: { icon: Snowflake, color: "text-blue-600", label: "Cold" },
};

function IntentCard({ prediction }: { prediction: SellerIntentPrediction }) {
  const config = INTENT_CONFIG[prediction.intentLevel] || INTENT_CONFIG.cool;
  const Icon = config.icon;
  const signals = prediction.signals ?? {};
  const activeSignals = Object.entries(signals).filter(([, v]) => v === true);

  const SIGNAL_LABELS: Record<string, string> = {
    hasRecentEnquiry: "Recent enquiry",
    hasCallBack: "Called back",
    hasMultipleContacts: "Multiple contacts",
    hasExpressedTimeframe: "Expressed timeframe",
    hasAskedForOffer: "Asked for offer",
    hasNegotiatedPrice: "Negotiated price",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${config.color}`} />
            <CardTitle className="text-sm">Lead #{prediction.leadId}</CardTitle>
          </div>
          <Badge variant={prediction.intentLevel === "hot" ? "destructive" : "outline"} className="capitalize">
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Intent Score</span>
            <span className="font-medium">{prediction.intentScore}/100</span>
          </div>
          <Progress value={prediction.intentScore} className="h-2" />
        </div>

        {prediction.urgencyScore !== undefined && (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Urgency Score</span>
              <span className="font-medium">{prediction.urgencyScore}/100</span>
            </div>
            <Progress value={prediction.urgencyScore} className="h-1.5" />
          </div>
        )}

        {activeSignals.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {activeSignals.map(([key]) => (
              <Badge key={key} variant="secondary" className="text-xs">
                {SIGNAL_LABELS[key] || key}
              </Badge>
            ))}
          </div>
        )}

        {prediction.recommendedApproach && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
            {prediction.recommendedApproach}
          </p>
        )}

        {prediction.offerRange && (
          <div className="flex items-center gap-1 text-xs">
            <DollarSign className="w-3 h-3 text-green-600" />
            <span className="text-muted-foreground">
              Offer range: ${prediction.offerRange.min.toLocaleString()} – ${prediction.offerRange.max.toLocaleString()}
            </span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{new Date(prediction.createdAt).toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}

export default function SellerIntentPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState("");

  const { data: hotLeads, isLoading } = useQuery<{ predictions: SellerIntentPrediction[] }>({
    queryKey: ["/api/seller-intent/hot"],
    queryFn: () => fetch("/api/seller-intent/hot").then(r => r.json()),
  });

  const { data: prediction, isLoading: predLoading } = useQuery<{ prediction: SellerIntentPrediction }>({
    queryKey: ["/api/seller-intent", leadId],
    queryFn: () => fetch(`/api/seller-intent/${leadId}`).then(r => r.json()),
    enabled: !!leadId,
  });

  const predictMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/seller-intent/${id}/predict`),
    onSuccess: () => {
      toast({ title: "Seller intent analysis complete" });
      qc.invalidateQueries({ queryKey: ["/api/seller-intent", leadId] });
      qc.invalidateQueries({ queryKey: ["/api/seller-intent/hot"] });
    },
    onError: () => toast({ title: "Analysis failed", variant: "destructive" }),
  });

  const hotPredictions = hotLeads?.predictions ?? [];
  const hotCount = hotPredictions.filter(p => p.intentLevel === "hot").length;
  const warmCount = hotPredictions.filter(p => p.intentLevel === "warm").length;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-seller-intent-title">
          Seller Intent
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          AI-predicted seller motivation and recommended outreach approach.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-500 mb-1">
              <Flame className="w-4 h-4" />
              <span className="text-xs">Hot Leads</span>
            </div>
            <p className="text-2xl font-bold">{hotCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-orange-500 mb-1">
              <Thermometer className="w-4 h-4" />
              <span className="text-xs">Warm Leads</span>
            </div>
            <p className="text-2xl font-bold">{warmCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs">Total Tracked</span>
            </div>
            <p className="text-2xl font-bold">{hotPredictions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-xs">Avg Intent Score</span>
            </div>
            <p className="text-2xl font-bold">
              {hotPredictions.length > 0
                ? Math.round(hotPredictions.reduce((s, p) => s + p.intentScore, 0) / hotPredictions.length)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze Lead Intent</CardTitle>
          <CardDescription>Enter a lead ID to run or view their seller intent analysis.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Lead ID"
              value={leadId}
              onChange={e => setLeadId(e.target.value)}
              className="w-40"
            />
            <Button
              onClick={() => leadId && predictMutation.mutate(leadId)}
              disabled={!leadId || predictMutation.isPending}
            >
              {predictMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
              ) : (
                "Analyze"
              )}
            </Button>
          </div>

          {leadId && prediction?.prediction && (
            <div className="mt-4">
              <IntentCard prediction={prediction.prediction} />
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading seller intent data...
        </div>
      ) : hotPredictions.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold mb-3">High-Priority Sellers</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {hotPredictions.map(p => (
              <IntentCard key={p.id} prediction={p} />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No seller intent data yet. Run an analysis on individual leads above.
        </div>
      )}
    </PageShell>
  );
}
