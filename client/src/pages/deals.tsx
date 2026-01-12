import { Sidebar } from "@/components/layout-sidebar";
import { useDeals, useCreateDeal, useUpdateDeal, useDeleteDeal, useSaveDealAnalysis } from "@/hooks/use-deals";
import { useProperties } from "@/hooks/use-properties";
import { ListSkeleton } from "@/components/list-skeleton";
import { telemetry } from "@/lib/telemetry";
import { useDealChecklist, useChecklistTemplates, useApplyChecklistTemplate, useUpdateChecklistItem, useStageGate } from "@/hooks/use-checklists";
import { useState } from "react";
import { useSearch, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDealSchema, type Deal, type Property, type DealChecklistItem, type DocumentPackage } from "@shared/schema";
import { z } from "zod";
import { DealCalculator, type AnalysisResults } from "@/components/deal-calculator";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

const dealFormSchema = insertDealSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, DollarSign, Calendar, Building, TrendingUp, CheckCircle, X, GripVertical, FileText, Trash2, Loader2, Briefcase, Calculator, ClipboardCheck, Upload, AlertTriangle, CheckSquare, Square, Clock, Download, Package, Play, Eye, FolderPlus, Sparkles, Flame, Snowflake, Minus, LayoutGrid, List, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DealsEmptyState } from "@/components/empty-states";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DisclaimerBanner } from "@/components/disclaimer-banner";

type DealWithProperty = Deal & { property?: Property };

const dealStages = [
  { value: 'negotiating', label: 'Negotiating', color: 'bg-slate-100 dark:bg-slate-800' },
  { value: 'offer_sent', label: 'Offer Sent', color: 'bg-blue-100 dark:bg-blue-900/30' },
  { value: 'countered', label: 'Countered', color: 'bg-amber-100 dark:bg-amber-900/30' },
  { value: 'accepted', label: 'Accepted', color: 'bg-emerald-100 dark:bg-emerald-900/30' },
  { value: 'in_escrow', label: 'In Escrow', color: 'bg-purple-100 dark:bg-purple-900/30' },
  { value: 'closed', label: 'Closed', color: 'bg-green-100 dark:bg-green-900/30' },
];

const statusColors: Record<string, string> = {
  negotiating: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  offer_sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  countered: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  in_escrow: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  closed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function DealsPage() {
  const { data: deals, isLoading } = useDeals();
  const { data: properties } = useProperties();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const actionFromUrl = urlParams.get("action");
  const { isMobile } = useIsMobile();
  
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new");
  const [selectedDeal, setSelectedDeal] = useState<DealWithProperty | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealWithProperty | null>(null);
  const { mutate: deleteDeal, isPending: isDeleting } = useDeleteDeal();
  const [isExporting, setIsExporting] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/export/deals?format=csv', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'deals.csv';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const enrichedDeals: DealWithProperty[] = (deals || []).map(deal => ({
    ...deal,
    property: properties?.find(p => p.id === deal.propertyId),
  }));

  const acquisitions = enrichedDeals.filter(d => d.type === 'acquisition' && d.status !== 'cancelled');
  const dispositions = enrichedDeals.filter(d => d.type === 'disposition' && d.status !== 'cancelled');
  
  const totalPipelineValue = enrichedDeals
    .filter(d => d.status !== 'closed' && d.status !== 'cancelled')
    .reduce((sum, d) => sum + Number(d.offerAmount || d.acceptedAmount || 0), 0);

  const closedValue = enrichedDeals
    .filter(d => d.status === 'closed')
    .reduce((sum, d) => sum + Number(d.acceptedAmount || 0), 0);

  const handleDelete = () => {
    if (deletingDeal) {
      deleteDeal(deletingDeal.id, {
        onSuccess: () => {
          setDeletingDeal(null);
          setSelectedDeal(null);
        },
      });
    }
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Deal Pipeline</h1>
              <p className="text-muted-foreground">Track acquisitions and dispositions through your pipeline.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                data-testid="button-export-deals"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export CSV
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-deal">
                    <Plus className="w-4 h-4 mr-2" /> New Deal
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] floating-window">
                <DialogHeader>
                  <DialogTitle>Create Deal</DialogTitle>
                  <DialogDescription>Start tracking a new acquisition or disposition</DialogDescription>
                </DialogHeader>
                <DealForm onSuccess={() => setIsCreateOpen(false)} />
              </DialogContent>
              </Dialog>
            </div>
          </div>

          <DisclaimerBanner type="deals" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-blue-500/10 flex-shrink-0">
                    <Building className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Acquisitions</p>
                    <p className="text-xl md:text-2xl font-bold" data-testid="text-acquisitions">{acquisitions.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-emerald-500/10 flex-shrink-0">
                    <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Dispositions</p>
                    <p className="text-xl md:text-2xl font-bold" data-testid="text-dispositions">{dispositions.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-primary/10 flex-shrink-0">
                    <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Pipeline</p>
                    <p className="text-lg md:text-2xl font-bold font-mono truncate" data-testid="text-pipeline-value">
                      ${totalPipelineValue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-green-500/10 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Closed</p>
                    <p className="text-lg md:text-2xl font-bold font-mono text-green-600 truncate" data-testid="text-closed-value">
                      ${closedValue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {!isLoading && enrichedDeals.length === 0 ? (
            <DealsEmptyState
              onAddDeal={() => setIsCreateOpen(true)}
            />
          ) : (
            <>
              {isMobile && (
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                    <Button
                      size="sm"
                      variant={mobileViewMode === 'kanban' ? 'secondary' : 'ghost'}
                      onClick={() => setMobileViewMode('kanban')}
                      className="min-h-[44px] min-w-[44px]"
                      data-testid="button-view-kanban"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={mobileViewMode === 'list' ? 'secondary' : 'ghost'}
                      onClick={() => setMobileViewMode('list')}
                      className="min-h-[44px] min-w-[44px]"
                      data-testid="button-view-list"
                    >
                      <List className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {mobileViewMode === 'kanban' && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setSelectedStageIndex(Math.max(0, selectedStageIndex - 1))}
                        disabled={selectedStageIndex === 0}
                        className="min-h-[44px] min-w-[44px]"
                        data-testid="button-prev-stage"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Select 
                        value={String(selectedStageIndex)} 
                        onValueChange={(val) => setSelectedStageIndex(Number(val))}
                      >
                        <SelectTrigger className="min-w-[140px] min-h-[44px]" data-testid="select-mobile-stage">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dealStages.map((stage, idx) => {
                            const count = enrichedDeals.filter(d => d.status === stage.value).length;
                            return (
                              <SelectItem key={stage.value} value={String(idx)}>
                                {stage.label} ({count})
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setSelectedStageIndex(Math.min(dealStages.length - 1, selectedStageIndex + 1))}
                        disabled={selectedStageIndex === dealStages.length - 1}
                        className="min-h-[44px] min-w-[44px]"
                        data-testid="button-next-stage"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {isMobile && mobileViewMode === 'list' ? (
                <div className="space-y-4">
                  {dealStages.map((stage) => {
                    const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                    if (stageDeals.length === 0) return null;
                    return (
                      <div key={stage.value}>
                        <div className={`rounded-xl px-4 py-3 mb-2 ${stage.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-medium">{stage.label}</h3>
                            <Badge variant="secondary" className="font-mono">
                              {stageDeals.length}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {stageDeals.map((deal) => (
                            <DealCard 
                              key={deal.id} 
                              deal={deal} 
                              onSelect={() => setSelectedDeal(deal)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : isMobile && mobileViewMode === 'kanban' ? (
                <div className="space-y-2">
                  {(() => {
                    const stage = dealStages[selectedStageIndex];
                    const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                    return (
                      <div>
                        <div className={`rounded-t-xl px-4 py-3 ${stage.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-medium">{stage.label}</h3>
                            <Badge variant="secondary" className="font-mono">
                              {stageDeals.length}
                            </Badge>
                          </div>
                        </div>
                        <div className="bg-muted/30 rounded-b-xl p-3 min-h-[300px] space-y-3">
                          {isLoading ? (
                            <div data-testid={`skeleton-deals-${stage.value}`}>
                              <ListSkeleton count={2} variant="compact" />
                            </div>
                          ) : stageDeals.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                              No deals in {stage.label}
                            </div>
                          ) : (
                            stageDeals.map((deal) => (
                              <DealCard 
                                key={deal.id} 
                                deal={deal} 
                                onSelect={() => setSelectedDeal(deal)}
                              />
                            ))
                          )}
                        </div>
                        <div className="flex justify-center gap-1.5 mt-3">
                          {dealStages.map((s, idx) => (
                            <button
                              key={s.value}
                              onClick={() => setSelectedStageIndex(idx)}
                              className={`w-2 h-2 rounded-full transition-colors ${
                                idx === selectedStageIndex 
                                  ? 'bg-primary' 
                                  : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
                              }`}
                              data-testid={`dot-stage-${s.value}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="relative">
                  <div className="overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                    <div className="flex gap-4 min-w-max px-1">
                      {dealStages.map((stage) => {
                        const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                        return (
                          <div key={stage.value} className="w-72 flex-shrink-0">
                            <div className={`rounded-t-xl px-4 py-3 ${stage.color}`}>
                              <div className="flex items-center justify-between gap-2">
                                <h3 className="font-medium">{stage.label}</h3>
                                <Badge variant="secondary" className="font-mono">
                                  {stageDeals.length}
                                </Badge>
                              </div>
                            </div>
                            <div className="bg-muted/30 rounded-b-xl p-2 min-h-[400px] space-y-2">
                              {isLoading ? (
                                <div data-testid={`skeleton-deals-${stage.value}`}>
                                  <ListSkeleton count={2} variant="compact" />
                                </div>
                              ) : stageDeals.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">
                                  No deals
                                </div>
                              ) : (
                                stageDeals.map((deal) => (
                                  <DealCard 
                                    key={deal.id} 
                                    deal={deal} 
                                    onSelect={() => setSelectedDeal(deal)}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="hidden md:block absolute left-0 top-0 bottom-4 w-4 bg-gradient-to-r from-background to-transparent pointer-events-none" />
                  <div className="hidden md:block absolute right-0 top-0 bottom-4 w-4 bg-gradient-to-l from-background to-transparent pointer-events-none" />
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {selectedDeal && (
        <DealDetailDrawer 
          deal={selectedDeal} 
          onClose={() => setSelectedDeal(null)}
          onDelete={() => setDeletingDeal(selectedDeal)}
        />
      )}

      <ConfirmDialog
        open={!!deletingDeal}
        onOpenChange={(open) => !open && setDeletingDeal(null)}
        title="Delete Deal"
        description={`Are you sure you want to delete this ${deletingDeal?.type === 'acquisition' ? 'acquisition' : 'disposition'} deal${deletingDeal?.property ? ` for ${deletingDeal.property.county}, ${deletingDeal.property.state}` : ''}? This action cannot be undone.`}
        confirmLabel="Delete Deal"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />
    </div>
  );
}

function DealCard({ deal, onSelect }: { deal: DealWithProperty; onSelect: () => void }) {
  return (
    <Card 
      className="floating-window cursor-pointer hover-elevate active:scale-[0.98] transition-transform touch-manipulation"
      onClick={onSelect}
      data-testid={`card-deal-${deal.id}`}
    >
      <CardContent className="p-4 min-h-[88px]">
        <div className="flex items-start gap-3">
          <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-1 flex-shrink-0 hidden md:block" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'} className="text-xs">
                {deal.type === 'acquisition' ? 'Buy' : 'Sell'}
              </Badge>
            </div>
            <div className="mt-2">
              {deal.property ? (
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm font-medium line-clamp-2">
                    {deal.property.county}, {deal.property.state}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Property #{deal.propertyId}</p>
              )}
              {deal.property?.sizeAcres && (
                <p className="text-xs text-muted-foreground mt-1 ml-5">{deal.property.sizeAcres} acres</p>
              )}
            </div>
            {(deal.offerAmount || deal.acceptedAmount) && (
              <div className="mt-2 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <span className="text-base font-mono font-medium text-emerald-600">
                  ${Number(deal.acceptedAmount || deal.offerAmount || 0).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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

function DealDetailDrawer({ deal, onClose, onDelete }: { deal: DealWithProperty; onClose: () => void; onDelete: () => void }) {
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
        title: "Failed to get pricing recommendation",
        description: error.message || "Please try again later",
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
            description: `Set to $${pricingRecommendation.suggestedOffer.toLocaleString()}`,
          });
          setIsPricingPopoverOpen(false);
        },
      });
    }
  };
  
  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 80) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    if (confidence >= 50) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  };
  
  const getMarketConditionIcon = (condition: 'hot' | 'neutral' | 'cold') => {
    switch (condition) {
      case 'hot': return <Flame className="w-4 h-4 text-orange-500" />;
      case 'cold': return <Snowflake className="w-4 h-4 text-blue-500" />;
      default: return <Minus className="w-4 h-4 text-gray-500" />;
    }
  };
  
  const getMarketConditionLabel = (condition: 'hot' | 'neutral' | 'cold') => {
    switch (condition) {
      case 'hot': return "Hot Market";
      case 'cold': return "Cold Market";
      default: return "Neutral Market";
    }
  };

  const { data: dealPackages, isLoading: packagesLoading } = useQuery<DocumentPackage[]>({
    queryKey: ["/api/document-packages", "deal", deal.id],
    queryFn: async () => {
      const response = await fetch(`/api/document-packages/deal/${deal.id}`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const generateAllMutation = useMutation({
    mutationFn: async ({ id, variables }: { id: number; variables?: Record<string, any> }) => {
      return apiRequest("POST", `/api/document-packages/${id}/generate-all`, { variables });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      toast({ title: "Documents generated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate documents", description: error.message, variant: "destructive" });
    },
  });

  const handleStatusChange = (newStatus: string) => {
    if (stageGate && !stageGate.canAdvance && stageGate.incompleteItems.length > 0) {
      toast({
        title: "Cannot Advance Stage",
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
            title: "Analysis Saved",
            description: "ROI analysis has been saved to this deal.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to save analysis. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="fixed right-0 top-0 h-full w-full md:max-w-2xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-4 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'}>
                  {deal.type === 'acquisition' ? 'Acquisition' : 'Disposition'}
                </Badge>
                <Badge className={statusColors[deal.status] || statusColors.negotiating}>
                  {deal.status?.replace('_', ' ')}
                </Badge>
              </div>
              <h2 className="text-lg md:text-xl font-bold mt-2 line-clamp-2" data-testid="text-deal-title">
                {deal.property ? `${deal.property.county}, ${deal.property.state}` : `Deal #${deal.id}`}
              </h2>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button size="icon" variant="ghost" onClick={onDelete} className="min-h-[44px] min-w-[44px]" data-testid="button-delete-deal">
                <Trash2 className="w-5 h-5 text-destructive" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onClose} className="min-h-[44px] min-w-[44px]">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <Tabs defaultValue="details" className="space-y-4 md:space-y-6">
            <TabsList className="grid w-full grid-cols-5 h-auto p-1">
              <TabsTrigger value="details" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-details">
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">Details</span>
              </TabsTrigger>
              <TabsTrigger value="documents" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-documents">
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">Docs</span>
              </TabsTrigger>
              <TabsTrigger value="timeline" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-timeline">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Timeline</span>
              </TabsTrigger>
              <TabsTrigger value="checklist" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-checklist">
                <ClipboardCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Tasks</span>
              </TabsTrigger>
              <TabsTrigger value="analysis" className="min-h-[44px] flex-col gap-1 md:flex-row md:gap-2 text-xs md:text-sm px-1 md:px-3" data-testid="tab-deal-analysis">
                <Calculator className="w-4 h-4" />
                <span className="hidden sm:inline">ROI</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6">
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Update Status</CardTitle>
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
                      <Loader2 className="w-3 h-3 animate-spin" /> Updating...
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="glass-panel">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground">Offer Amount</p>
                      <Popover open={isPricingPopoverOpen} onOpenChange={setIsPricingPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => pricingMutation.mutate()}
                            disabled={pricingMutation.isPending || !deal.propertyId}
                            data-testid="button-ai-pricing"
                          >
                            {pricingMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="end">
                          {pricingRecommendation && (
                            <div className="glass-panel rounded-lg overflow-hidden">
                              <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 p-4 border-b">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-5 h-5 text-violet-500" />
                                  <h3 className="font-semibold">AI Price Recommendation</h3>
                                </div>
                              </div>
                              <div className="p-4 space-y-4">
                                <div className="text-center">
                                  <p className="text-sm text-muted-foreground mb-1">Suggested Offer</p>
                                  <p className="text-3xl font-bold font-mono text-primary" data-testid="text-suggested-offer">
                                    ${pricingRecommendation.suggestedOffer.toLocaleString()}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Range: ${pricingRecommendation.priceRangeMin.toLocaleString()} - ${pricingRecommendation.priceRangeMax.toLocaleString()}
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
                                  className="w-full" 
                                  onClick={handleApplyPricingSuggestion}
                                  disabled={isPending}
                                  data-testid="button-apply-suggestion"
                                >
                                  {isPending ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Applying...
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle className="w-4 h-4 mr-2" />
                                      Apply Suggestion
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <p className="text-xl font-bold font-mono">
                      ${Number(deal.offerAmount || 0).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card className="glass-panel">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Accepted Amount</p>
                    <p className="text-xl font-bold font-mono text-emerald-600">
                      ${Number(deal.acceptedAmount || 0).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {deal.property && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="w-4 h-4" /> Property Details
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
                        <p className="text-muted-foreground">Assessed Value</p>
                        <p className="font-mono">${Number(deal.property.assessedValue || 0).toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Timeline
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    {deal.offerDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Offer Date</span>
                        <span>{format(new Date(deal.offerDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {deal.closingDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Closing Date</span>
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
                    <CardTitle className="text-base">Closing Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Title Company</span>
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
                          <span className="text-muted-foreground">Closing Costs</span>
                          <span className="font-mono">${Number(deal.closingCosts).toLocaleString()}</span>
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
                      <FileText className="w-4 h-4" /> Notes
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

              <div className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" className="flex-1 min-h-[44px]">
                  Generate Documents
                </Button>
                <Button className="flex-1 min-h-[44px]">
                  View Property
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="documents" className="space-y-4 md:space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium text-sm md:text-base">Document Packages</h3>
                <Link href={`/documents?action=create-package&dealId=${deal.id}`}>
                  <Button size="sm" className="min-h-[44px]" data-testid="button-create-package-from-deal">
                    <FolderPlus className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Create Package</span>
                    <span className="sm:hidden">New</span>
                  </Button>
                </Link>
              </div>

              {packagesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : !dealPackages || dealPackages.length === 0 ? (
                <Card className="glass-panel">
                  <CardContent className="p-6 text-center space-y-4">
                    <Package className="w-12 h-12 mx-auto text-muted-foreground" />
                    <div>
                      <h3 className="font-medium">No Document Packages</h3>
                      <p className="text-sm text-muted-foreground">Create a package to bundle documents for this deal.</p>
                    </div>
                    <Link href={`/documents?action=create-package&dealId=${deal.id}`}>
                      <Button variant="outline" data-testid="button-create-first-package">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Package
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {dealPackages.map(pkg => {
                    const docsCount = (pkg.documents as any[] || []).length;
                    const generatedCount = (pkg.documents as any[] || []).filter((d: any) => d.documentId).length;
                    const statusColors: Record<string, string> = {
                      draft: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
                      complete: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
                      sent: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
                      signed: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
                    };

                    return (
                      <Card key={pkg.id} className="glass-panel" data-testid={`card-deal-package-${pkg.id}`}>
                        <CardContent className="p-3 md:p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="p-2 rounded-lg bg-muted flex-shrink-0">
                                <Package className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium truncate text-sm md:text-base" data-testid={`text-deal-package-name-${pkg.id}`}>
                                  {pkg.name}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <Badge variant="outline" className={`text-xs ${statusColors[pkg.status] || ""}`}>
                                    {pkg.status}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {generatedCount}/{docsCount} generated
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-9 sm:ml-0">
                              <Link href={`/documents?packageId=${pkg.id}`}>
                                <Button variant="outline" size="sm" className="min-h-[44px]" data-testid={`button-view-deal-package-${pkg.id}`}>
                                  <Eye className="w-4 h-4 sm:mr-1" />
                                  <span className="hidden sm:inline">View</span>
                                </Button>
                              </Link>
                              {pkg.status === "draft" && docsCount > 0 && (
                                <Button 
                                  size="sm"
                                  className="min-h-[44px]"
                                  onClick={() => generateAllMutation.mutate({ id: pkg.id })}
                                  disabled={generateAllMutation.isPending}
                                  data-testid={`button-generate-deal-package-${pkg.id}`}
                                >
                                  {generateAllMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 sm:mr-1 animate-spin" />
                                  ) : (
                                    <Play className="w-4 h-4 sm:mr-1" />
                                  )}
                                  <span className="hidden sm:inline">Generate</span>
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
                <Card className="border-amber-500/50 bg-amber-500/10">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400" data-testid="text-stage-gate-warning">
                        Stage Advancement Blocked
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Complete {stageGate.incompleteItems.length} required item(s) before advancing to the next stage.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {isChecklistLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : !checklist ? (
                <Card className="glass-panel">
                  <CardContent className="p-6 text-center space-y-4">
                    <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground" />
                    <div>
                      <h3 className="font-medium">No Checklist Applied</h3>
                      <p className="text-sm text-muted-foreground">Select a template to start tracking due diligence items.</p>
                    </div>
                    <Select
                      onValueChange={(templateId) => applyTemplate(Number(templateId))}
                      disabled={isApplyingTemplate}
                    >
                      <SelectTrigger className="max-w-xs mx-auto" data-testid="select-checklist-template">
                        <SelectValue placeholder="Select template..." />
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
                        <Loader2 className="w-3 h-3 animate-spin" /> Applying template...
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
                          <ClipboardCheck className="w-4 h-4" /> Progress
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
                        className={`glass-panel transition-colors ${item.checkedAt ? 'bg-emerald-500/5' : ''}`}
                        data-testid={`checklist-item-${item.id}`}
                      >
                        <CardContent className="p-3 md:p-4">
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => updateChecklistItem({ 
                                itemId: item.id, 
                                checked: !item.checkedAt 
                              })}
                              disabled={isUpdatingItem}
                              className="shrink-0 p-2 -m-2 touch-manipulation"
                              data-testid={`checkbox-item-${item.id}`}
                            >
                              {item.checkedAt ? (
                                <CheckSquare className="w-6 h-6 text-emerald-500" />
                              ) : (
                                <Square className="w-6 h-6 text-muted-foreground" />
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
                                data-testid={`button-upload-doc-${item.id}`}
                              >
                                <Upload className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="pt-4 border-t">
                    <Select
                      onValueChange={(templateId) => {
                        if (confirm('This will replace the current checklist. Continue?')) {
                          applyTemplate(Number(templateId));
                        }
                      }}
                      disabled={isApplyingTemplate}
                    >
                      <SelectTrigger className="max-w-xs" data-testid="select-change-template">
                        <SelectValue placeholder="Change template..." />
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
      </div>
    </div>
  );
}

function DealForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateDeal();
  const { data: properties } = useProperties();
  
  const form = useForm<z.infer<typeof dealFormSchema>>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      status: "negotiating",
      type: "acquisition",
    }
  });

  const onSubmit = (data: z.infer<typeof dealFormSchema>) => {
    mutate(data, {
      onSuccess: () => {
        telemetry.actionCompleted('deal_created', { type: data.type, offerAmount: data.offerAmount });
        onSuccess();
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deal Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "acquisition"}>
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]" data-testid="select-deal-type">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="acquisition">Acquisition (Buying)</SelectItem>
                    <SelectItem value="disposition">Disposition (Selling)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="propertyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Property</FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))}>
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]" data-testid="select-deal-property">
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {properties?.map(prop => (
                      <SelectItem key={prop.id} value={prop.id.toString()}>
                        {prop.county}, {prop.state} ({prop.sizeAcres} ac)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="offerAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Offer Amount ($)</FormLabel>
                <FormControl>
                  <Input 
                    {...field}
                    value={field.value ?? ""}
                    type="number" 
                    placeholder="5000"
                    className="min-h-[44px]"
                    data-testid="input-offer-amount"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="offerDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Offer Date</FormLabel>
                <FormControl>
                  <Input 
                    type="date"
                    className="min-h-[44px]"
                    onChange={(e) => field.onChange(new Date(e.target.value))} 
                    data-testid="input-offer-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="titleCompany"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title Company</FormLabel>
                <FormControl>
                  <Input 
                    {...field}
                    value={field.value ?? ""}
                    placeholder="ABC Title Co"
                    className="min-h-[44px]"
                    data-testid="input-title-company"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="closingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target Closing</FormLabel>
                <FormControl>
                  <Input 
                    type="date"
                    className="min-h-[44px]"
                    onChange={(e) => field.onChange(new Date(e.target.value))} 
                    data-testid="input-closing-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="pt-2">
          <Button type="submit" className="w-full min-h-[44px]" disabled={isPending} data-testid="button-create-deal-submit">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Deal"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
