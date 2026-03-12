import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Campaign } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { TestTube, Trophy, Sparkles, AlertTriangle, CheckCircle, Plus, Loader2 } from "lucide-react";

interface CampaignVariant {
  id: number;
  campaignId: number;
  name: string;
  subject: string | null;
  body: string | null;
  trafficSplit: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  responseCount: number;
  isWinner: boolean;
  createdAt: string;
  openRate: number;
  clickRate: number;
  responseRate: number;
}

interface AbAnalysis {
  hasVariants: boolean;
  message?: string;
  variants?: (CampaignVariant & { responseRatePct: number })[];
  leadingVariant?: { id: number; name: string; responseRatePct: number };
  isSignificant: boolean;
  confidenceLabel: string;
  hasEnoughData: boolean;
  recommendation: string | null;
}

interface CampaignVariantsPanelProps {
  campaign: Campaign;
}

export function CampaignVariantsPanel({ campaign }: CampaignVariantsPanelProps) {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("Variant B");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTrafficSplit, setNewTrafficSplit] = useState(50);
  const [aiAnalysis, setAiAnalysis] = useState<AbAnalysis | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const { data: variants, isLoading } = useQuery<CampaignVariant[]>({
    queryKey: [`/api/campaigns/${campaign.id}/variants`],
  });

  const addVariantMutation = useMutation({
    mutationFn: async (data: { name: string; subject: string; body: string; trafficSplit: number }) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/variants`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaign.id}/variants`] });
      setIsAddDialogOpen(false);
      setNewName("Variant B");
      setNewSubject("");
      setNewBody("");
      setNewTrafficSplit(50);
      toast({ title: "Variant added successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add variant", description: err.message, variant: "destructive" });
    },
  });

  const declareWinnerMutation = useMutation({
    mutationFn: async (variantId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/variants/${variantId}/declare-winner`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaign.id}/variants`] });
      toast({ title: `Winner declared: ${data.winner?.name}`, description: `Response rate: ${data.winnerResponseRate}%` });
    },
    onError: (err: any) => {
      toast({ title: "Cannot declare winner", description: err.message, variant: "destructive" });
    },
  });

  const handleAiPickWinner = async () => {
    setIsAiLoading(true);
    try {
      const res = await apiRequest("GET", `/api/campaigns/${campaign.id}/ab-analysis`);
      const data: AbAnalysis = await res.json();
      setAiAnalysis(data);
    } catch (err: any) {
      toast({ title: "Failed to get AI analysis", description: err.message, variant: "destructive" });
    } finally {
      setIsAiLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading variants...</span>
      </div>
    );
  }

  const hasVariants = variants && variants.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TestTube className="w-5 h-5 text-muted-foreground" />
          <h3 className="font-semibold text-base">A/B Test Variants</h3>
        </div>
        <div className="flex items-center gap-2">
          {hasVariants && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAiPickWinner}
              disabled={isAiLoading}
              data-testid="button-ai-pick-winner"
            >
              {isAiLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              AI Pick Winner
            </Button>
          )}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-variant">
                <Plus className="w-4 h-4 mr-1" />
                {hasVariants ? "Add Variant" : "Add Variant B"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add A/B Test Variant</DialogTitle>
                <DialogDescription>
                  Create a new variant to test against the original campaign.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Variant Name</label>
                  <Input
                    placeholder="e.g., Variant B"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    data-testid="input-variant-name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Subject (optional)</label>
                  <Input
                    placeholder="Alternative subject line"
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    data-testid="input-variant-subject"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Body / Content (optional)</label>
                  <Textarea
                    placeholder="Alternative message body"
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    className="min-h-[100px]"
                    data-testid="input-variant-body"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Traffic Split (%)</label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={newTrafficSplit}
                    onChange={(e) => setNewTrafficSplit(Number(e.target.value))}
                    data-testid="input-variant-traffic-split"
                  />
                  <p className="text-xs text-muted-foreground">
                    Percentage of audience that receives this variant when campaign is sent.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    addVariantMutation.mutate({
                      name: newName || "Variant B",
                      subject: newSubject,
                      body: newBody,
                      trafficSplit: newTrafficSplit,
                    })
                  }
                  disabled={addVariantMutation.isPending}
                  data-testid="button-submit-variant"
                >
                  {addVariantMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Add Variant
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* AI Analysis result */}
      {aiAnalysis && (
        <Card className={aiAnalysis.isSignificant ? "border-emerald-500" : "border-amber-400"}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <CardTitle className="text-sm">AI Analysis</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {aiAnalysis.hasVariants && aiAnalysis.leadingVariant && (
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium">
                  Leading: {aiAnalysis.leadingVariant.name} ({aiAnalysis.leadingVariant.responseRatePct}% response rate)
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{aiAnalysis.recommendation}</p>
            <Badge
              className={
                aiAnalysis.isSignificant
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
              }
            >
              {aiAnalysis.confidenceLabel}
            </Badge>
          </CardContent>
        </Card>
      )}

      {!hasVariants && (
        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
          <TestTube className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium mb-1">No variants yet</p>
          <p className="text-xs">Add a Variant B to start A/B testing this campaign.</p>
        </div>
      )}

      {hasVariants && (
        <div className="space-y-3">
          {variants!.map((variant, index) => {
            const hasEnoughData = variant.sentCount >= 50;
            const isSignificantCandidate = hasEnoughData && variant.responseRate > 0;

            return (
              <Card
                key={variant.id}
                data-testid={`variant-card-${variant.id}`}
                className={variant.isWinner ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10" : ""}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{String.fromCharCode(65 + index)}</Badge>
                      <CardTitle className="text-sm">{variant.name}</CardTitle>
                      {variant.isWinner && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <Trophy className="w-3 h-3 mr-1" />
                          Winner
                        </Badge>
                      )}
                    </div>
                    {/* Statistical significance indicator */}
                    <div className="flex items-center gap-1">
                      {!hasEnoughData ? (
                        <Badge variant="outline" className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          Need more data
                        </Badge>
                      ) : isSignificantCandidate ? (
                        <Badge variant="outline" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-300">
                          <CheckCircle className="w-3 h-3" />
                          Enough data
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1 bg-amber-50 text-amber-700 border-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          Waiting
                        </Badge>
                      )}
                    </div>
                  </div>
                  {variant.subject && (
                    <CardDescription className="truncate text-xs mt-1">
                      Subject: {variant.subject}
                    </CardDescription>
                  )}
                  {variant.body && (
                    <CardDescription className="truncate text-xs">
                      Body: {variant.body.slice(0, 80)}{variant.body.length > 80 ? "…" : ""}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold" data-testid={`stat-sent-${variant.id}`}>{variant.sentCount}</p>
                      <p className="text-xs text-muted-foreground">Sent</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{variant.openRate}%</p>
                      <p className="text-xs text-muted-foreground">Open Rate</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold">{variant.clickRate}%</p>
                      <p className="text-xs text-muted-foreground">Click Rate</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold" data-testid={`stat-response-rate-${variant.id}`}>{variant.responseRate}%</p>
                      <p className="text-xs text-muted-foreground">Response Rate</p>
                    </div>
                  </div>

                  {/* Response rate bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Response Rate</span>
                      <span>{variant.responseRate}%</span>
                    </div>
                    <Progress value={variant.responseRate} className="h-1.5" />
                  </div>

                  {/* Traffic split */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Traffic split: {variant.trafficSplit}%</span>
                    {!variant.isWinner && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={declareWinnerMutation.isPending || !hasEnoughData}
                        onClick={() => declareWinnerMutation.mutate(variant.id)}
                        data-testid={`button-declare-winner-${variant.id}`}
                        title={!hasEnoughData ? "Need at least 50 sends to declare a winner" : "Declare this variant as winner"}
                      >
                        {declareWinnerMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Trophy className="w-3 h-3 mr-1" />
                        )}
                        Declare Winner
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
