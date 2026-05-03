/**
 * DealDetailContent — shared body for the deal-detail surface.
 *
 * Used by both:
 *   - <DealDetailDrawer /> (modal sheet on /deals)
 *   - /deals/:id route (full-page detail view)
 *
 * Extracted from client/src/pages/deals.tsx as part of P1-28 (URL routes
 * for deal-detail).
 */
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from "@/components/ui/responsive-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ListSkeleton } from "@/components/list-skeleton";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DealJourney } from "@/components/ui/deal-journey";
import { DealCalculator, type AnalysisResults } from "@/components/deal-calculator";
import { useUpdateDeal, useSaveDealAnalysis } from "@/hooks/use-deals";
import { useDealChecklist, useChecklistTemplates, useApplyChecklistTemplate, useUpdateChecklistItem, useStageGate } from "@/hooks/use-checklists";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { plural, usd } from "@/lib/format";
import { GlossaryTerm } from "@/components/Glossary";
import {
  Plus, MapPin, Calendar, FileText, Trash2, Loader2, Calculator, ClipboardCheck,
  Upload, AlertTriangle, CheckSquare, Square, Clock, Package, Play, Eye, FolderPlus,
  Sparkles, Flame, Snowflake, Minus, CheckCircle, X,
} from "lucide-react";
import type { Deal, Property, DealChecklistItem, DocumentPackage } from "@shared/schema";

type DealWithProperty = Deal & { property?: Property };

const dealStages = [
  { value: 'negotiating', label: 'Negotiating', color: 'bg-muted' },
  { value: 'offer_sent', label: 'Offer Sent', color: 'bg-acr-brand-soft' },
  { value: 'countered', label: 'Countered', color: 'bg-acr-warn-soft dark:bg-acr-warn-soft' },
  { value: 'accepted', label: 'Accepted', color: 'bg-acr-pos-soft dark:bg-acr-pos-soft' },
  { value: 'in_escrow', label: 'In Escrow', color: 'bg-acr-brand-soft' },
  { value: 'closed', label: 'Closed', color: 'bg-acr-pos-soft dark:bg-acr-pos-soft' },
];

const statusColors: Record<string, string> = {
  negotiating: 'bg-muted text-muted-foreground',
  offer_sent: 'bg-acr-brand-soft text-acr-brand',
  countered: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn',
  accepted: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos',
  in_escrow: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn',
  closed: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos',
  cancelled: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg',
};

interface PricingRecommendation {
  suggestedOffer: number;
  confidence: number;
  pricePerAcre: number;
  priceRangeMin: number;
  priceRangeMax: number;
  comparables: any;
  marketCondition: 'hot' | 'neutral' | 'cold';
  reasoning: string;
  propertyAcres: number;
}

export function DealDetailContent({ deal, onDelete, headerActions }: { deal: DealWithProperty; onDelete?: () => void; headerActions?: React.ReactNode }) {
  const { mutate: updateDeal, isPending } = useUpdateDeal();
  const { mutate: saveAnalysis, isPending: isSavingAnalysis } = useSaveDealAnalysis();
  const { data: checklist, isLoading: isChecklistLoading } = useDealChecklist(deal.id);
  const { data: templates } = useChecklistTemplates();
  const { mutate: applyTemplate, isPending: isApplyingTemplate } = useApplyChecklistTemplate(deal.id);
  const { mutate: updateChecklistItem, isPending: isUpdatingItem } = useUpdateChecklistItem(deal.id);
  const { data: stageGate } = useStageGate(deal.id);
  const { toast } = useToast();
  
  const [pricingRecommendation, setPricingRecommendation] = useState<PricingRecommendation | null>(null);
  const [isPricingPopoverOpen, setIsPricingPopoverOpen] = useState(false);
  const [negotiationScript, setNegotiationScript] = useState<string | null>(null);
  const [isNegotiationOpen, setIsNegotiationOpen] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<number | null>(null);

  const negotiationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/negotiation/script", {
        askingPrice: deal.property?.assessedValue || deal.offerAmount || 50000,
        offerAmount: deal.offerAmount || undefined,
        sellerMessages: [],
        sellerMotivation: "motivated",
      });
      if (!response.ok) throw new Error("Failed to generate negotiation script");
      return response.json() as Promise<{ script: string; counterOffer: any; sellerProfile: any }>;
    },
    onSuccess: (data) => {
      setNegotiationScript(data.script);
      setIsNegotiationOpen(true);
    },
    onError: (error: any) => {
      toast({ title: "Couldn't generate negotiation script", description: `${error.message} — your deal data is unchanged.`, variant: "destructive" });
    },
  });
  
  const pricingMutation = useMutation({
    mutationFn: async () => {
      if (!deal.propertyId) throw new Error("No property associated with this deal");
      const response = await apiRequest("POST", "/api/ai/pricing/optimize", {
        propertyId: deal.propertyId,
        sellerAskingPrice: deal.property?.assessedValue || null,
        dealType: deal.type,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to get pricing recommendation");
      }
      return response.json() as Promise<PricingRecommendation>;
    },
    onSuccess: (data) => {
      setPricingRecommendation(data);
      setIsPricingPopoverOpen(true);
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't get pricing recommendation",
        description: `${error.message || "Try again later"} — your deal pricing is unchanged.`,
        variant: "destructive",
      });
    },
  });
  
  const handleApplyPricingSuggestion = () => {
    if (pricingRecommendation) {
      updateDeal({ 
        id: deal.id, 
        offerAmount: pricingRecommendation.suggestedOffer.toString() 
      }, {
        onSuccess: () => {
          toast({
            title: "Offer amount updated",
            description: `Set to ${usd(pricingRecommendation.suggestedOffer, { noCents: true })}`,
          });
          setIsPricingPopoverOpen(false);
        },
      });
    }
  };
  
  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 80) return "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos";
    if (confidence >= 50) return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn";
    return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg";
  };
  
  const getMarketConditionIcon = (condition: 'hot' | 'neutral' | 'cold') => {
    switch (condition) {
      case 'hot': return <Flame className="w-4 h-4 text-acr-warn" />;
      case 'cold': return <Snowflake className="w-4 h-4 text-blue-500" />;
      default: return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };
  
  const getMarketConditionLabel = (condition: 'hot' | 'neutral' | 'cold') => {
    switch (condition) {
      case 'hot': return "Hot Market";
      case 'cold': return "Cold Market";
      default: return "Neutral Market";
    }
  };

  const { data: dealPackages, isLoading: packagesLoading, isError: packagesError } = useQuery<DocumentPackage[]>({
    queryKey: ["/api/document-packages", "deal", deal.id],
    queryFn: async () => {
      const response = await fetch(`/api/document-packages/deal/${deal.id}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`Failed to load document packages (${response.status})`);
      return response.json();
    },
  });

  useEffect(() => {
    if (packagesError) {
      toast({
        title: "Couldn't load document packages",
        description: "Check your connection and reopen the Docs tab to retry.",
        variant: "destructive",
      });
    }
  }, [packagesError, toast]);

  const generateAllMutation = useMutation({
    mutationFn: async ({ id, variables }: { id: number; variables?: Record<string, any> }) => {
      return apiRequest("POST", `/api/document-packages/${id}/generate-all`, { variables });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      toast({ title: "Documents generated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't generate documents", description: `${error.message} — the document package is unchanged.`, variant: "destructive" });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (stageGate && !stageGate.canAdvance && stageGate.incompleteItems.length > 0) {
      toast({
        title: "Couldn't advance stage",
        description: `Complete ${stageGate.incompleteItems.length} required checklist item(s) first.`,
        variant: "destructive",
      });
      return;
    }
    updateDeal({ id: deal.id, status: newStatus });
  };

  const handleSaveAnalysis = (results: AnalysisResults) => {
    saveAnalysis(
      { dealId: deal.id, analysisResults: results },
      {
        onSuccess: () => {
          toast({
            title: "Analysis saved",
            description: "ROI analysis has been saved to this deal.",
          });
        },
        onError: () => {
          toast({
            title: "Couldn't save analysis",
            description: "Your previous analysis is unchanged. Try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <>
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'}>
                  {deal.type === 'acquisition' ? 'Acquisition' : 'Disposition'}
                </Badge>
                <Badge className={statusColors[deal.status] || statusColors.negotiating}>
                  {deal.status?.replace(/_/g, ' ')}
                </Badge>
              </div>
              <h2 id="deal-drawer-title" className="text-lg md:text-xl font-bold mt-2 line-clamp-2" data-testid="text-deal-title">
                {deal.property ? `${deal.property.county}, ${deal.property.state}` : `Deal #${deal.id}`}
              </h2>
              <div className="mt-3 max-w-md">
                <DealJourney status={deal.status as any} />
              </div>
            </div>
            {headerActions ? (
              <div className="flex items-center gap-1 flex-shrink-0">{headerActions}</div>
            ) : null}
          </div>
        </div>

        <div className="p-4 md:p-6">
          <Tabs defaultValue="details" className="space-y-4 md:space-y-6">
            <TabsList className="grid w-full grid-cols-5 h-auto p-1">
              <TabsTrigger value="details" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-details">
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">Details</span>
              </TabsTrigger>
              <TabsTrigger value="documents" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-documents">
                <Package className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">Docs</span>
              </TabsTrigger>
              <TabsTrigger value="timeline" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-timeline">
                <Clock className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">Timeline</span>
              </TabsTrigger>
              <TabsTrigger value="checklist" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-checklist">
                <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">Tasks</span>
              </TabsTrigger>
              <TabsTrigger value="analysis" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-analysis">
                <Calculator className="w-4 h-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only sm:inline">ROI</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6">
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Update status</CardTitle>
                </CardHeader>
                <CardContent>
                  <Select 
                    value={deal.status} 
                    onValueChange={handleStatusChange}
                    disabled={isPending}
                  >
                    <SelectTrigger data-testid="select-deal-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dealStages.map(stage => (
                        <SelectItem key={stage.value} value={stage.value}>
                          {stage.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                  {isPending && (
                    <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Updating…
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="glass-panel">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground">Offer amount</p>
                      <Popover open={isPricingPopoverOpen} onOpenChange={setIsPricingPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[44px] min-w-[44px]"
                            onClick={() => pricingMutation.mutate()}
                            disabled={pricingMutation.isPending || !deal.propertyId}
                            aria-label={pricingMutation.isPending ? "Generating AI pricing recommendation" : "Get AI pricing recommendation"}
                            data-testid="button-ai-pricing"
                          >
                            {pricingMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Sparkles className="w-4 h-4" aria-hidden="true" />
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="end">
                          {pricingRecommendation && (
                            <div className="glass-panel rounded-lg overflow-hidden">
                              <div className="bg-gradient-to-r from-primary/10 to-primary/5 p-4 border-b">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
                                  <h3 className="font-semibold">AI price recommendation</h3>
                                </div>
                              </div>
                              <div className="p-4 space-y-4">
                                <div className="text-center">
                                  <p className="text-sm text-muted-foreground mb-1">Suggested offer</p>
                                  <p className="text-3xl font-bold font-mono tabular-nums text-primary" data-testid="text-suggested-offer">
                                    {usd(pricingRecommendation.suggestedOffer, { noCents: true })}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                                    Range: {usd(pricingRecommendation.priceRangeMin, { noCents: true })} &ndash; {usd(pricingRecommendation.priceRangeMax, { noCents: true })}
                                  </p>
                                </div>
                                
                                <div className="flex items-center justify-center gap-3">
                                  <Badge className={getConfidenceBadgeColor(pricingRecommendation.confidence)} data-testid="badge-confidence">
                                    {pricingRecommendation.confidence.toFixed(0)}% confidence
                                  </Badge>
                                  <div className="flex items-center gap-1.5">
                                    {getMarketConditionIcon(pricingRecommendation.marketCondition)}
                                    <span className="text-xs text-muted-foreground">
                                      {getMarketConditionLabel(pricingRecommendation.marketCondition)}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                                  <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Price per Acre</span>
                                    <span className="font-mono font-medium">${pricingRecommendation.pricePerAcre.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                  </div>
                                  <div className="flex justify-between text-sm">
                                    <span className="text-muted-foreground">Property Size</span>
                                    <span className="font-medium">{pricingRecommendation.propertyAcres} acres</span>
                                  </div>
                                  {pricingRecommendation.comparables?.count > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">Comparables Used</span>
                                      <span className="font-medium">{pricingRecommendation.comparables.count} properties</span>
                                    </div>
                                  )}
                                </div>
                                
                                {pricingRecommendation.reasoning && (
                                  <p className="text-xs text-muted-foreground italic">
                                    {pricingRecommendation.reasoning}
                                  </p>
                                )}
                                
                                <Button
                                  className="w-full min-h-[44px]"
                                  onClick={handleApplyPricingSuggestion}
                                  disabled={isPending}
                                  data-testid="button-apply-suggestion"
                                >
                                  {isPending ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                                      Applying…
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                                      Apply suggestion
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>

                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 min-h-[44px] min-w-[44px] text-primary border-primary/20 hover:bg-primary/5 dark:border-primary/30 dark:hover:bg-primary/10"
                        onClick={() => negotiationMutation.mutate()}
                        disabled={negotiationMutation.isPending}
                        aria-label={negotiationMutation.isPending ? "Generating negotiation script" : "Generate AI negotiation script"}
                      >
                        {negotiationMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="w-4 h-4" aria-hidden="true" />
                        )}
                        <span className="sr-only sm:not-sr-only sm:inline">Negotiate</span>
                      </Button>
                    </div>

                    {/* Negotiation script dialog */}
                    <ResponsiveModal open={isNegotiationOpen} onOpenChange={setIsNegotiationOpen}>
                      <ResponsiveModalContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <ResponsiveModalHeader>
                          <ResponsiveModalTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
                            Negotiation coaching
                          </ResponsiveModalTitle>
                          <ResponsiveModalDescription>Negotiation strategy and talking points for this deal.</ResponsiveModalDescription>
                        </ResponsiveModalHeader>
                        {negotiationScript && (
                          <div className="space-y-4">
                            <div className="bg-primary/5 dark:bg-primary/10 rounded-lg p-4 border border-primary/20">
                              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{negotiationScript}</pre>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2 min-h-[44px]"
                              onClick={() => { navigator.clipboard.writeText(negotiationScript); toast({ title: "Script copied to clipboard" }); }}
                            >
                              Copy script
                            </Button>
                          </div>
                        )}
                      </ResponsiveModalContent>
                    </ResponsiveModal>
                    <p className="text-xl font-bold font-mono tabular-nums">
                      {deal.offerAmount != null && deal.offerAmount !== ''
                        ? usd(deal.offerAmount, { noCents: true })
                        : <span className="text-muted-foreground">—</span>}
                    </p>
                  </CardContent>
                </Card>
                <Card className="glass-panel">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Accepted amount</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-acr-pos">
                      {deal.acceptedAmount != null && deal.acceptedAmount !== ''
                        ? usd(deal.acceptedAmount, { noCents: true })
                        : <span className="text-muted-foreground">—</span>}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {deal.property && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="w-4 h-4" aria-hidden="true" /> Property details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Location</p>
                        <p className="font-medium">{deal.property.county}, {deal.property.state}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">APN</p>
                        <p className="font-mono">{deal.property.apn}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Size</p>
                        <p className="font-medium">{deal.property.sizeAcres} acres</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Assessed value</p>
                        <p className="font-mono tabular-nums">{usd(deal.property.assessedValue, { noCents: true })}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="w-4 h-4" aria-hidden="true" /> Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    {deal.offerDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Offer date</span>
                        <span>{format(new Date(deal.offerDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {deal.closingDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Closing date</span>
                        <span>{format(new Date(deal.closingDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created</span>
                      <span>{deal.createdAt ? format(new Date(deal.createdAt), 'MMM d, yyyy') : 'N/A'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {deal.titleCompany && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Closing details · <GlossaryTerm slug="title_commitment">title commitment</GlossaryTerm> · <GlossaryTerm slug="earnest_money">earnest money</GlossaryTerm>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Title company</span>
                        <span>{deal.titleCompany}</span>
                      </div>
                      {deal.escrowNumber && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Escrow #</span>
                          <span className="font-mono">{deal.escrowNumber}</span>
                        </div>
                      )}
                      {deal.closingCosts && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Closing costs</span>
                          <span className="font-mono tabular-nums">{usd(deal.closingCosts, { noCents: true })}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {deal.notes && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4" aria-hidden="true" /> Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-panel">
                <CardContent className="pt-6">
                  <CustomFieldValuesEditor entityType="deal" entityId={deal.id} />
                </CardContent>
              </Card>

            </TabsContent>

            <TabsContent value="documents" className="space-y-4 md:space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-sm md:text-base">Document packages</h3>
                <Button asChild size="sm" className="min-h-[44px]" data-testid="button-create-package-from-deal">
                  <Link href={`/documents?action=create-package&dealId=${deal.id}`}>
                    <FolderPlus className="w-4 h-4 mr-2" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only sm:inline">Create package</span>
                    <span className="sm:hidden">New</span>
                  </Link>
                </Button>
              </div>

              {packagesLoading ? (
                <ListSkeleton count={2} variant="compact" />
              ) : !dealPackages || dealPackages.length === 0 ? (
                <Card className="glass-panel">
                  <CardContent className="p-6 text-center space-y-4">
                    <Package className="w-12 h-12 mx-auto text-muted-foreground" aria-hidden="true" />
                    <div>
                      <h3 className="font-medium">No document packages</h3>
                      <p className="text-sm text-muted-foreground">Create a package to bundle documents for this deal.</p>
                    </div>
                    <Button asChild variant="outline" className="min-h-[44px]" data-testid="button-create-first-package">
                      <Link href={`/documents?action=create-package&dealId=${deal.id}`}>
                        <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                        Create package
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {dealPackages.map(pkg => {
                    const docsCount = (pkg.documents as any[] || []).length;
                    const generatedCount = (pkg.documents as any[] || []).filter((d: any) => d.documentId).length;
                    const pkgStatusColors: Record<string, string> = {
                      draft: "bg-muted text-muted-foreground",
                      complete: "bg-acr-brand-soft text-acr-brand",
                      sent: "bg-acr-warn-soft text-acr-warn",
                      signed: "bg-acr-pos-soft text-acr-pos",
                    };

                    return (
                      <Card key={pkg.id} className="glass-panel" data-testid={`card-deal-package-${pkg.id}`}>
                        <CardContent className="p-3 md:p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="p-2 rounded-lg bg-muted flex-shrink-0">
                                <Package className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium truncate text-sm md:text-base" data-testid={`text-deal-package-name-${pkg.id}`}>
                                  {pkg.name}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <Badge variant="outline" className={`text-xs ${pkgStatusColors[pkg.status] || ""}`}>
                                    {pkg.status}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {generatedCount}/{docsCount} generated
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-9 sm:ml-0">
                              <Button asChild variant="outline" size="sm" className="min-h-[44px] min-w-[44px]" data-testid={`button-view-deal-package-${pkg.id}`}>
                                <Link href={`/documents?packageId=${pkg.id}`} aria-label={`View package ${pkg.name}`}>
                                  <Eye className="w-4 h-4 sm:mr-1" aria-hidden="true" />
                                  <span className="sr-only sm:not-sr-only sm:inline">View</span>
                                </Link>
                              </Button>
                              {pkg.status === "draft" && docsCount > 0 && (
                                <Button
                                  size="sm"
                                  className="min-h-[44px] min-w-[44px]"
                                  onClick={() => generateAllMutation.mutate({ id: pkg.id })}
                                  disabled={generateAllMutation.isPending}
                                  aria-label={generateAllMutation.isPending ? `Generating ${pkg.name}` : `Generate ${pkg.name}`}
                                  data-testid={`button-generate-deal-package-${pkg.id}`}
                                >
                                  {generateAllMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 sm:mr-1 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Play className="w-4 h-4 sm:mr-1" aria-hidden="true" />
                                  )}
                                  <span className="sr-only sm:not-sr-only sm:inline">Generate</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="space-y-6">
              <ActivityTimeline entityType="deal" entityId={deal.id} />
            </TabsContent>

            <TabsContent value="checklist" className="space-y-6">
              {stageGate && !stageGate.canAdvance && (
                <Card role="status" className="border-amber-500/50 bg-acr-warn/10">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
                    <div>
                      <p className="font-medium text-acr-warn dark:text-acr-warn" data-testid="text-stage-gate-warning">
                        Stage advancement blocked
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Complete {stageGate.incompleteItems.length} required {plural(stageGate.incompleteItems.length, 'item')} before advancing to the next stage.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isChecklistLoading ? (
                <ListSkeleton count={4} variant="compact" />
              ) : !checklist ? (
                <Card className="glass-panel">
                  <CardContent className="p-6 text-center space-y-4">
                    <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground" aria-hidden="true" />
                    <div>
                      <h3 className="font-medium">No checklist applied</h3>
                      <p className="text-sm text-muted-foreground">Select a template to start tracking due diligence items.</p>
                    </div>
                    <Select
                      onValueChange={(templateId) => applyTemplate(Number(templateId))}
                      disabled={isApplyingTemplate}
                    >
                      <SelectTrigger className="max-w-xs mx-auto min-h-[44px]" data-testid="select-checklist-template" aria-label="Select a checklist template">
                        <SelectValue placeholder="Select a template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates?.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isApplyingTemplate && (
                      <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Applying template…
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card className="glass-panel">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <ClipboardCheck className="w-4 h-4" aria-hidden="true" /> Progress
                        </span>
                        <Badge variant="secondary" data-testid="badge-checklist-progress">
                          {checklist.completionStatus.completed} / {checklist.completionStatus.total}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Progress
                        value={checklist.completionStatus.percentage}
                        className="h-2"
                        aria-label={`Checklist ${checklist.completionStatus.percentage}% complete`}
                        data-testid="progress-checklist"
                      />
                      <p className="text-sm text-muted-foreground mt-2">
                        {checklist.completionStatus.percentage}% complete
                      </p>
                    </CardContent>
                  </Card>

                  <div className="space-y-2">
                    {checklist.items.map((item: DealChecklistItem) => (
                      <Card 
                        key={item.id} 
                        className={`glass-panel transition-colors ${item.checkedAt ? 'bg-acr-pos/5' : ''}`}
                        data-testid={`checklist-item-${item.id}`}
                      >
                        <CardContent className="p-3 md:p-4">
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={!!item.checkedAt}
                              aria-label={`${item.checkedAt ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
                              onClick={() => updateChecklistItem({
                                itemId: item.id,
                                checked: !item.checkedAt
                              })}
                              disabled={isUpdatingItem}
                              className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] -m-2 touch-manipulation rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid={`checkbox-item-${item.id}`}
                            >
                              {item.checkedAt ? (
                                <CheckSquare className="w-6 h-6 text-acr-pos" aria-hidden="true" />
                              ) : (
                                <Square className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`font-medium text-sm md:text-base ${item.checkedAt ? 'line-through text-muted-foreground' : ''}`}>
                                  {item.title}
                                </span>
                                {item.required && (
                                  <Badge variant="outline" className="text-xs">Required</Badge>
                                )}
                                {item.documentRequired && (
                                  <Badge variant="outline" className="text-xs hidden sm:inline-flex">Doc Required</Badge>
                                )}
                              </div>
                              {item.description && (
                                <p className="text-xs md:text-sm text-muted-foreground mt-1">{item.description}</p>
                              )}
                              {item.checkedAt && item.checkedBy && (
                                <p className="text-xs text-muted-foreground mt-2">
                                  Completed {format(new Date(item.checkedAt), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                            {item.documentRequired && (
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={isUpdatingItem}
                                className="min-h-[44px] min-w-[44px] flex-shrink-0"
                                aria-label={`Upload document for ${item.title}`}
                                data-testid={`button-upload-doc-${item.id}`}
                              >
                                <Upload className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="pt-4 border-t">
                    <Select
                      onValueChange={(templateId) => setPendingTemplateId(Number(templateId))}
                      disabled={isApplyingTemplate}
                    >
                      <SelectTrigger className="max-w-xs min-h-[44px]" data-testid="select-change-template" aria-label="Change checklist template">
                        <SelectValue placeholder="Change template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates?.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ConfirmDialog
                    open={pendingTemplateId !== null}
                    onOpenChange={(open) => { if (!open) setPendingTemplateId(null); }}
                    title="Replace checklist?"
                    description="This replaces the current checklist with the selected template. Completed items won't carry over."
                    confirmLabel="Replace checklist"
                    cancelLabel="Cancel"
                    isLoading={isApplyingTemplate}
                    variant="destructive"
                    onConfirm={() => {
                      if (pendingTemplateId !== null) {
                        applyTemplate(pendingTemplateId);
                        setPendingTemplateId(null);
                      }
                    }}
                  />
                </>
              )}
            </TabsContent>

            <TabsContent value="analysis">
              <DealCalculator 
                deal={deal} 
                property={deal.property}
                onSave={handleSaveAnalysis}
                isSaving={isSavingAnalysis}
                showSaveButton={true}
              />
            </TabsContent>
          </Tabs>
        </div>
    </>
  );
}
