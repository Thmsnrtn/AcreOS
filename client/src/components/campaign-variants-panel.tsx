import { useState, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Campaign } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const nameId = useId();
  const subjectId = useId();
  const bodyId = useId();
  const trafficId = useId();
  const trafficHintId = useId();

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
      toast({
        title: "Couldn't add variant",
        description: `${err.message} — no variant was created. Check your input and try again.`,
        variant: "destructive",
      });
    },
  });

  const declareWinnerMutation = useMutation({
    mutationFn: async (variantId: number) => {
      const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/variants/${variantId}/declare-winner`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/campaigns/${campaign.id}/variants`] });
      toast({ title: `Winner declared: ${data.winner?.name}`, description: `Response rate: ${data.winnerResponseRate}%.` });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't declare winner",
        description: `${err.message} — the current winner (if any) is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const handleAiPickWinner = async () => {
    setIsAiLoading(true);
    try {
      const res = await apiRequest("GET", `/api/campaigns/${campaign.id}/ab-analysis`);
      const data: AbAnalysis = await res.json();
      setAiAnalysis(data);
    } catch (err: any) {
      toast({
        title: "Couldn't get AI analysis",
        description: `${err.message} — your variants and their stats are unchanged. Try again in a moment.`,
        variant: "destructive",
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-4" role="status" aria-live="polite">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        <span className="text-sm">Loading variants…</span>
      </div>
    );
  }

  const hasVariants = variants && variants.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TestTube className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          <h3 className="font-semibold text-base">A/B test variants</h3>
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
                <Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" aria-hidden="true" />
              )}
              AI pick winner
            </Button>
          )}
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-variant">
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                {hasVariants ? "Add variant" : "Add variant B"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add A/B test variant</DialogTitle>
                <DialogDescription>
                  Create a new variant to test against the original campaign.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (addVariantMutation.isPending) return;
                  addVariantMutation.mutate({
                    name: newName || "Variant B",
                    subject: newSubject,
                    body: newBody,
                    trafficSplit: newTrafficSplit,
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor={nameId}>
                    Variant name <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <Input
                    id={nameId}
                    placeholder="e.g., Variant B"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoCapitalize="words"
                    data-testid="input-variant-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={subjectId}>Subject (optional)</Label>
                  <Input
                    id={subjectId}
                    placeholder="Alternative subject line"
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    data-testid="input-variant-subject"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={bodyId}>Body / content (optional)</Label>
                  <Textarea
                    id={bodyId}
                    placeholder="Alternative message body"
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    className="min-h-[100px]"
                    data-testid="input-variant-body"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={trafficId}>Traffic split (%)</Label>
                  <Input
                    id={trafficId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={99}
                    value={newTrafficSplit}
                    onChange={(e) => setNewTrafficSplit(Number(e.target.value))}
                    aria-describedby={trafficHintId}
                    data-testid="input-variant-traffic-split"
                  />
                  <p id={trafficHintId} className="text-xs text-muted-foreground">
                    Percentage of audience that receives this variant when the campaign is sent.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={addVariantMutation.isPending || !newName.trim()}
                    className="min-h-11"
                    data-testid="button-submit-variant"
                  >
                    {addVariantMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                    Add variant
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* AI Analysis result */}
      {aiAnalysis && (
        <Card
          className={aiAnalysis.isSignificant ? "border-acr-pos" : "border-acr-warn"}
          role="status"
          aria-live="polite"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-acr-brand" aria-hidden="true" />
              <CardTitle className="text-sm">AI analysis</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {aiAnalysis.hasVariants && aiAnalysis.leadingVariant && (
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                <span className="text-sm font-medium">
                  Leading: {aiAnalysis.leadingVariant.name} (<span className="tabular-nums">{aiAnalysis.leadingVariant.responseRatePct}%</span> response rate)
                </span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{aiAnalysis.recommendation}</p>
            <Badge
              className={
                aiAnalysis.isSignificant
                  ? "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos"
                  : "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn"
              }
            >
              {aiAnalysis.confidenceLabel}
            </Badge>
          </CardContent>
        </Card>
      )}

      {!hasVariants && (
        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-card">
          <TestTube className="w-10 h-10 mx-auto mb-2 opacity-40" aria-hidden="true" />
          <p className="text-sm font-medium mb-1">No variants yet</p>
          <p className="text-xs">Add a Variant B to start A/B testing this campaign.</p>
        </div>
      )}

      {hasVariants && (
        <ul className="space-y-3" aria-label="Campaign variants">
          {variants!.map((variant, index) => {
            const hasEnoughData = variant.sentCount >= 50;
            const isSignificantCandidate = hasEnoughData && variant.responseRate > 0;

            return (
              <li key={variant.id}>
                <Card
                  data-testid={`variant-card-${variant.id}`}
                  className={variant.isWinner ? "border-acr-pos bg-acr-pos-soft dark:bg-acr-pos-soft/10" : ""}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" aria-label={`Variant ${String.fromCharCode(65 + index)}`}>{String.fromCharCode(65 + index)}</Badge>
                        <CardTitle className="text-sm">{variant.name}</CardTitle>
                        {variant.isWinner && (
                          <Badge className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos">
                            <Trophy className="w-3 h-3 mr-1" aria-hidden="true" />
                            Winner
                          </Badge>
                        )}
                      </div>
                      {/* Statistical significance indicator */}
                      <div className="flex items-center gap-1">
                        {!hasEnoughData ? (
                          <Badge variant="outline" className="text-xs gap-1 bg-acr-warn-soft text-acr-warn border-acr-warn">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                            Need more data
                          </Badge>
                        ) : isSignificantCandidate ? (
                          <Badge variant="outline" className="text-xs gap-1 bg-acr-pos-soft text-acr-pos border-acr-pos">
                            <CheckCircle className="w-3 h-3" aria-hidden="true" />
                            Enough data
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs gap-1 bg-acr-warn-soft text-acr-warn border-acr-warn">
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
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
                    <dl className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <dd className="text-lg font-bold tabular-nums" data-testid={`stat-sent-${variant.id}`}>{variant.sentCount}</dd>
                        <dt className="text-xs text-muted-foreground">Sent</dt>
                      </div>
                      <div>
                        <dd className="text-lg font-bold tabular-nums">{variant.openRate}%</dd>
                        <dt className="text-xs text-muted-foreground">Open rate</dt>
                      </div>
                      <div>
                        <dd className="text-lg font-bold tabular-nums">{variant.clickRate}%</dd>
                        <dt className="text-xs text-muted-foreground">Click rate</dt>
                      </div>
                      <div>
                        <dd className="text-lg font-bold tabular-nums" data-testid={`stat-response-rate-${variant.id}`}>{variant.responseRate}%</dd>
                        <dt className="text-xs text-muted-foreground">Response rate</dt>
                      </div>
                    </dl>

                    {/* Response rate bar */}
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Response rate</span>
                        <span className="tabular-nums">{variant.responseRate}%</span>
                      </div>
                      <Progress
                        value={variant.responseRate}
                        className="h-1.5"
                        aria-label={`${variant.name} response rate: ${variant.responseRate}%`}
                      />
                    </div>

                    {/* Traffic split */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Traffic split: <span className="tabular-nums">{variant.trafficSplit}%</span></span>
                      {!variant.isWinner && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 sm:h-7 text-xs min-h-9 sm:min-h-7"
                          disabled={declareWinnerMutation.isPending || !hasEnoughData}
                          onClick={() => declareWinnerMutation.mutate(variant.id)}
                          data-testid={`button-declare-winner-${variant.id}`}
                          title={!hasEnoughData ? "Need at least 50 sends to declare a winner" : undefined}
                          aria-label={`Declare ${variant.name} as the A/B test winner`}
                        >
                          {declareWinnerMutation.isPending ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trophy className="w-3 h-3 mr-1" aria-hidden="true" />
                          )}
                          Declare winner
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
