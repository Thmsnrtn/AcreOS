/**
 * T104 — Seller Intent Panel
 *
 * Shows AI-predicted high-intent sellers from the current lead list.
 * Uses the /api/ai-ops/intent/predict endpoint.
 * Displays: intent score, signals, recommended next action.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Brain, TrendingUp, Phone, Mail, ChevronRight, Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Lead {
  id: number;
  firstName?: string;
  lastName?: string;
  propertyAddress?: string;
  status: string;
  phone?: string;
  email?: string;
}

interface IntentPrediction {
  leadId: number;
  score: number; // 0-100
  category: "hot" | "warm" | "cold" | "unknown";
  signals: string[];
  recommendedAction: string;
  confidence: number;
  predictedAt: string;
}

const CATEGORY_COLORS = {
  hot: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  warm: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  cold: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  unknown: "bg-muted text-muted-foreground",
};

function IntentBadge({ category }: { category: string }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.unknown}`}>
      {category}
    </span>
  );
}

interface Props {
  leads: Lead[];
  orgId?: number;
}

export function SellerIntentPanel({ leads }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [predictions, setPredictions] = useState<Map<number, IntentPrediction>>(new Map());
  const [scanning, setScanning] = useState(false);

  // Get top leads that are most likely to have high intent (not yet contacted / warm)
  const candidateLeads = leads
    .filter(l => ["new", "contacted", "warm"].includes(l.status))
    .slice(0, 10);

  const predictMutation = useMutation({
    mutationFn: async (leadId: number): Promise<IntentPrediction> => {
      const res = await apiRequest("POST", "/api/ai-ops/intent/predict", { leadId });
      return res.json();
    },
    onSuccess: (data: IntentPrediction, leadId: number) => {
      setPredictions(prev => new Map(prev).set(leadId, data));
    },
    onError: () => {},
  });

  const handleScanAll = async () => {
    setScanning(true);
    for (const lead of candidateLeads) {
      try {
        const res = await apiRequest("POST", "/api/ai-ops/intent/predict", { leadId: lead.id });
        const result: IntentPrediction = await res.json();
        setPredictions(prev => new Map(prev).set(lead.id, result));
      } catch {
        // Continue with other leads
      }
    }
    setScanning(false);
    toast({ title: `Scanned ${candidateLeads.length} leads for seller intent` });
  };

  const sortedWithPredictions = candidateLeads
    .map(l => ({ lead: l, prediction: predictions.get(l.id) }))
    .sort((a, b) => (b.prediction?.score ?? 0) - (a.prediction?.score ?? 0));

  const hotCount = Array.from(predictions.values()).filter(p => p.category === "hot").length;
  const warmCount = Array.from(predictions.values()).filter(p => p.category === "warm").length;

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" />
            Seller Intent AI
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-predicted intent for your top {candidateLeads.length} leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          {predictions.size > 0 && (
            <div className="flex gap-1 text-xs">
              <span className="text-red-600 font-medium">{hotCount} hot</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-amber-600 font-medium">{warmCount} warm</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleScanAll}
            disabled={scanning || candidateLeads.length === 0}
          >
            {scanning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Scanning</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Scan All</>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-0 px-4 pb-4">
        {candidateLeads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No leads in "new", "contacted", or "warm" status to analyze.
          </p>
        ) : (
          sortedWithPredictions.map(({ lead, prediction }) => (
            <div
              key={lead.id}
              className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {lead.firstName || lead.lastName
                      ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim()
                      : `Lead #${lead.id}`}
                  </span>
                  {prediction && <IntentBadge category={prediction.category} />}
                </div>
                {lead.propertyAddress && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{lead.propertyAddress}</div>
                )}
                {prediction && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2">
                      <Progress value={prediction.score} className="h-1.5 flex-1" />
                      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{prediction.score}</span>
                    </div>
                    {prediction.recommendedAction && (
                      <p className="text-xs text-muted-foreground">{prediction.recommendedAction}</p>
                    )}
                    {prediction.signals.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {prediction.signals.slice(0, 3).map((s, i) => (
                          <span key={i} className="text-xs bg-muted px-1.5 py-0.5 rounded">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {!prediction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => predictMutation.mutate(lead.id)}
                    disabled={predictMutation.isPending}
                  >
                    Analyze
                  </Button>
                )}
                <Link href={`/leads?highlight=${lead.id}`}>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
