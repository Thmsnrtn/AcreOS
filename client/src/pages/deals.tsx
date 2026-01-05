import { Sidebar } from "@/components/layout-sidebar";
import { useDeals, useCreateDeal, useUpdateDeal, useDeleteDeal, useSaveDealAnalysis } from "@/hooks/use-deals";
import { useProperties } from "@/hooks/use-properties";
import { ListSkeleton } from "@/components/list-skeleton";
import { useDealChecklist, useChecklistTemplates, useApplyChecklistTemplate, useUpdateChecklistItem, useStageGate } from "@/hooks/use-checklists";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDealSchema, type Deal, type Property, type DealChecklistItem } from "@shared/schema";
import { z } from "zod";
import { DealCalculator, type AnalysisResults } from "@/components/deal-calculator";
import { useToast } from "@/hooks/use-toast";

const dealFormSchema = insertDealSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, DollarSign, Calendar, Building, TrendingUp, CheckCircle, X, GripVertical, FileText, Trash2, Loader2, Briefcase, Calculator, ClipboardCheck, Upload, AlertTriangle, CheckSquare, Square, Clock, Download } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomFieldValuesEditor } from "@/components/custom-fields";

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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealWithProperty | null>(null);
  const [deletingDeal, setDeletingDeal] = useState<DealWithProperty | null>(null);
  const { mutate: deleteDeal, isPending: isDeleting } = useDeleteDeal();
  const [isExporting, setIsExporting] = useState(false);

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
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-blue-500/10">
                    <Building className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Acquisitions</p>
                    <p className="text-2xl font-bold" data-testid="text-acquisitions">{acquisitions.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-emerald-500/10">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Dispositions</p>
                    <p className="text-2xl font-bold" data-testid="text-dispositions">{dispositions.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary/10">
                    <DollarSign className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Pipeline Value</p>
                    <p className="text-2xl font-bold font-mono" data-testid="text-pipeline-value">
                      ${totalPipelineValue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-green-500/10">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Closed Value</p>
                    <p className="text-2xl font-bold font-mono text-green-600" data-testid="text-closed-value">
                      ${closedValue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {!isLoading && enrichedDeals.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No deals in your pipeline"
              description="Track acquisitions and dispositions through your pipeline. Move deals through stages from lead to closed."
              secondaryDescription="Stay organized and never let a deal fall through the cracks."
              tips={[
                "Create deals for properties you're negotiating on",
                "Track offer amounts and accepted terms",
                "Move deals through stages: negotiating, accepted, escrow, closed"
              ]}
              actionLabel="Create Your First Deal"
              onAction={() => setIsCreateOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto pb-4">
              <div className="flex gap-4 min-w-max">
                {dealStages.map((stage) => {
                  const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                  return (
                    <div key={stage.value} className="w-72 flex-shrink-0">
                      <div className={`rounded-t-xl px-4 py-3 ${stage.color}`}>
                        <div className="flex items-center justify-between">
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
      className="floating-window cursor-pointer hover-elevate"
      onClick={onSelect}
      data-testid={`card-deal-${deal.id}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'} className="text-xs">
                {deal.type === 'acquisition' ? 'Buy' : 'Sell'}
              </Badge>
            </div>
            <div className="mt-2">
              {deal.property ? (
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm font-medium truncate">
                    {deal.property.county}, {deal.property.state}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Property #{deal.propertyId}</p>
              )}
              {deal.property?.sizeAcres && (
                <p className="text-xs text-muted-foreground mt-0.5">{deal.property.sizeAcres} acres</p>
              )}
            </div>
            {(deal.offerAmount || deal.acceptedAmount) && (
              <div className="mt-2 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-sm font-mono font-medium text-emerald-600">
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

function DealDetailDrawer({ deal, onClose, onDelete }: { deal: DealWithProperty; onClose: () => void; onDelete: () => void }) {
  const { mutate: updateDeal, isPending } = useUpdateDeal();
  const { mutate: saveAnalysis, isPending: isSavingAnalysis } = useSaveDealAnalysis();
  const { data: checklist, isLoading: isChecklistLoading } = useDealChecklist(deal.id);
  const { data: templates } = useChecklistTemplates();
  const { mutate: applyTemplate, isPending: isApplyingTemplate } = useApplyChecklistTemplate(deal.id);
  const { mutate: updateChecklistItem, isPending: isUpdatingItem } = useUpdateChecklistItem(deal.id);
  const { data: stageGate } = useStageGate(deal.id);
  const { toast } = useToast();

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
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'}>
                  {deal.type === 'acquisition' ? 'Acquisition' : 'Disposition'}
                </Badge>
                <Badge className={statusColors[deal.status] || statusColors.negotiating}>
                  {deal.status?.replace('_', ' ')}
                </Badge>
              </div>
              <h2 className="text-xl font-bold mt-2" data-testid="text-deal-title">
                {deal.property ? `${deal.property.county}, ${deal.property.state}` : `Deal #${deal.id}`}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={onDelete} data-testid="button-delete-deal">
                <Trash2 className="w-5 h-5 text-destructive" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <Tabs defaultValue="details" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="details" data-testid="tab-deal-details">
                <FileText className="w-4 h-4 mr-2" />
                Details
              </TabsTrigger>
              <TabsTrigger value="timeline" data-testid="tab-deal-timeline">
                <Clock className="w-4 h-4 mr-2" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="checklist" data-testid="tab-deal-checklist">
                <ClipboardCheck className="w-4 h-4 mr-2" />
                Checklist
              </TabsTrigger>
              <TabsTrigger value="analysis" data-testid="tab-deal-analysis">
                <Calculator className="w-4 h-4 mr-2" />
                ROI Analysis
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
                    <p className="text-sm text-muted-foreground">Offer Amount</p>
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

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1">
                  Generate Documents
                </Button>
                <Button className="flex-1">
                  View Property
                </Button>
              </div>
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
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => updateChecklistItem({ 
                                itemId: item.id, 
                                checked: !item.checkedAt 
                              })}
                              disabled={isUpdatingItem}
                              className="mt-0.5 shrink-0"
                              data-testid={`checkbox-item-${item.id}`}
                            >
                              {item.checkedAt ? (
                                <CheckSquare className="w-5 h-5 text-emerald-500" />
                              ) : (
                                <Square className="w-5 h-5 text-muted-foreground" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`font-medium ${item.checkedAt ? 'line-through text-muted-foreground' : ''}`}>
                                  {item.title}
                                </span>
                                {item.required && (
                                  <Badge variant="outline" className="text-xs">Required</Badge>
                                )}
                                {item.documentRequired && (
                                  <Badge variant="outline" className="text-xs">Doc Required</Badge>
                                )}
                              </div>
                              {item.description && (
                                <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
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
    mutate(data, { onSuccess });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deal Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "acquisition"}>
                  <FormControl>
                    <SelectTrigger data-testid="select-deal-type">
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
                    <SelectTrigger data-testid="select-deal-property">
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

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="offerAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Offer Amount ($)</FormLabel>
                <FormControl>
                  <Input 
                    {...field}
                    type="number" 
                    placeholder="5000" 
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
                    onChange={(e) => field.onChange(new Date(e.target.value))} 
                    data-testid="input-offer-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="titleCompany"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title Company</FormLabel>
                <FormControl>
                  <Input 
                    {...field}
                    placeholder="ABC Title Co" 
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
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-create-deal-submit">
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
