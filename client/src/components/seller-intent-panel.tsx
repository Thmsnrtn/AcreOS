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
    onError: (err: any, leadId: number) => {
      const lead = candidateLeads.find(l => l.id === leadId);
      const leadLabel = lead
        ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || `lead #${leadId}`
        : `lead #${leadId}`;
      toast({
        title: "Couldn't predict intent",
        description: `${err?.message ?? "The AI service didn't respond."} — ${leadLabel}'s intent score is unchanged. Try again in a moment.`,
        variant: "destructive",
      });
    },
  });

  const handleScanAll = async () => {
    setScanning(true);
    let successCount = 0;
    let errorCount = 0;
    for (const lead of candidateLeads) {
      try {
        const res = await apiRequest("POST", "/api/ai-ops/intent/predict", { leadId: lead.id });
        const result: IntentPrediction = await res.json();
        setPredictions(prev => new Map(prev).set(lead.id, result));
        successCount++;
      } catch {
        errorCount++;
      }
    }
    setScanning(false);
    if (errorCount === 0) {
      toast({ title: `Scanned ${successCount} leads for seller intent.` });
    } else if (successCount === 0) {
      toast({
        title: "Couldn't scan leads",
        description: `All ${errorCount} requests failed. No intent scores were updated — try again in a moment.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `Scanned ${successCount} of ${candidateLeads.length} leads`,
        description: `${errorCount} failed and weren't scored. Retry from each lead's Analyze button.`,
        variant: "destructive",
      });
    }
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
            <Brain className="w-4 h-4 text-purple-600" aria-hidden="true" />
            Seller intent AI
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-predicted intent for your top <span className="tabular-nums">{candidateLeads.length}</span> leads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {predictions.size > 0 && (
            <div className="flex gap-1 text-xs tabular-nums">
              <span className="text-red-600 font-medium">{hotCount} hot</span>
              <span className="text-muted-foreground" aria-hidden="true">/</span>
              <span className="text-amber-600 font-medium">{warmCount} warm</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleScanAll}
            disabled={scanning || candidateLeads.length === 0}
            className="min-h-9"
          >
            {scanning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" /> Scanning…</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Scan all</>
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
          <ul className="space-y-2" aria-label="Candidate leads for seller-intent analysis">
            {sortedWithPredictions.map(({ lead, prediction }) => {
              const leadName = lead.firstName || lead.lastName
                ? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim()
                : `Lead #${lead.id}`;
              return (
                <li
                  key={lead.id}
                  className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{leadName}</span>
                      {prediction && <IntentBadge category={prediction.category} />}
                    </div>
                    {lead.propertyAddress && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{lead.propertyAddress}</div>
                    )}
                    {prediction && (
                      <div className="mt-1.5 space-y-1">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={prediction.score}
                            className="h-1.5 flex-1"
                            aria-label={`${leadName} intent score: ${prediction.score} out of 100`}
                          />
                          <span className="text-xs font-mono text-muted-foreground w-8 text-right tabular-nums">{prediction.score}</span>
                        </div>
                        {prediction.recommendedAction && (
                          <p className="text-xs text-muted-foreground">{prediction.recommendedAction}</p>
                        )}
                        {prediction.signals.length > 0 && (
                          <ul className="flex flex-wrap gap-1" aria-label="Signals">
                            {prediction.signals.slice(0, 3).map((s, i) => (
                              <li key={i} className="text-xs bg-muted px-1.5 py-0.5 rounded">{s}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {!prediction && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 text-xs min-h-9"
                        onClick={() => predictMutation.mutate(lead.id)}
                        disabled={predictMutation.isPending}
                        aria-label={`Analyze seller intent for ${leadName}`}
                      >
                        {predictMutation.isPending && predictMutation.variables === lead.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                          "Analyze"
                        )}
                      </Button>
                    )}
                    <Button
                      asChild
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 min-h-9 min-w-9"
                    >
                      <Link
                        href={`/leads?highlight=${lead.id}`}
                        aria-label={`Open ${leadName} in leads`}
                      >
                        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
