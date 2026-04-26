import { useState, useMemo, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { ListSkeleton } from "@/components/list-skeleton";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import "./today.css";
import { OfferPreflightChecklist } from "@/components/offer-preflight-checklist";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { OfferLetter, OfferTemplate, Lead, Property } from "@shared/schema";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { 
  Calculator, Mail, Send, FileText, Plus, Trash2, Edit, Eye, 
  Loader2, Calendar, DollarSign, Clock, Filter, Check, X, ClipboardCheck
} from "lucide-react";
import { format } from "date-fns";

const offerStatuses = [
  { value: "draft", label: "Draft", color: "bg-muted text-muted-foreground" },
  { value: "queued", label: "Queued", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "sent", label: "Sent", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400" },
  { value: "delivered", label: "Delivered", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "responded", label: "Responded", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "accepted", label: "Accepted", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  { value: "expired", label: "Expired", color: "bg-muted text-muted-foreground" },
];

const getStatusBadge = (status: string) => {
  const statusConfig = offerStatuses.find(s => s.value === status) || offerStatuses[0];
  return <Badge className={`${statusConfig.color} no-default-hover-elevate`}>{statusConfig.label}</Badge>;
};

export default function OffersPage() {
  useDocumentTitle("Offer letters");
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("queue");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedOffers, setSelectedOffers] = useState<number[]>([]);
  
  // Calculator state
  const [offerPercent, setOfferPercent] = useState(25);
  const [expirationDays, setExpirationDays] = useState(30);
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);
  const [leadFilter, setLeadFilter] = useState({ county: "", status: "" });
  
  // Template dialog state
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<OfferTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: "", type: "blind_offer", subject: "", content: "" });
  
  // Preflight checklist state
  const [isPreflightOpen, setIsPreflightOpen] = useState(false);
  const [pendingDeleteOffer, setPendingDeleteOffer] = useState<OfferLetter | null>(null);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<OfferTemplate | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  
  // Queries
  const { data: offerLetters, isLoading: offersLoading } = useQuery<OfferLetter[]>({
    queryKey: ['/api/offer-letters'],
  });
  
  const { data: templates, isLoading: templatesLoading } = useQuery<OfferTemplate[]>({
    queryKey: ['/api/offer-templates'],
  });
  
  const { data: leads } = useQuery<Lead[]>({
    queryKey: ['/api/leads'],
  });
  
  const { data: properties } = useQuery<Property[]>({
    queryKey: ['/api/properties'],
  });
  
  // Mutations
  const createBatchMutation = useMutation({
    mutationFn: async (data: { leadIds: number[]; offerPercent: number; expirationDays: number }) => {
      return apiRequest('POST', '/api/offer-letters/batch', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-letters'] });
      setSelectedLeadIds([]);
      toast({ title: "Batch created.", description: "Offer letters have been generated for selected leads." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't create batch",
        description: `${error.message} — no offer letters were generated. Your lead selection is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const sendOfferMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('POST', `/api/offer-letters/${id}/send`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-letters'] });
      toast({ title: "Offer queued.", description: "The offer letter has been queued for sending." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't queue offer",
        description: `${error.message} — the offer is still a draft and nothing was sent.`,
        variant: "destructive",
      });
    },
  });

  const deleteOfferMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/offer-letters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-letters'] });
      toast({ title: "Offer letter deleted." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't delete offer letter",
        description: `${error.message} — the offer letter still exists.`,
        variant: "destructive",
      });
    },
  });
  
  const createTemplateMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; subject: string; content: string }) => {
      return apiRequest('POST', '/api/offer-templates', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-templates'] });
      setIsTemplateDialogOpen(false);
      setTemplateForm({ name: "", type: "blind_offer", subject: "", content: "" });
      toast({ title: "Template created.", description: "Your template has been saved." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't create template",
        description: `${error.message} — no template was saved.`,
        variant: "destructive",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<OfferTemplate> }) => {
      return apiRequest('PUT', `/api/offer-templates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-templates'] });
      setIsTemplateDialogOpen(false);
      setEditingTemplate(null);
      toast({ title: "Template updated.", description: "Your template has been updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't update template",
        description: `${error.message} — the template is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('DELETE', `/api/offer-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/offer-templates'] });
      toast({ title: "Template deleted." });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't delete template",
        description: `${error.message} — the template still exists.`,
        variant: "destructive",
      });
    },
  });
  
  // Computed values
  const filteredOffers = useMemo(() => {
    if (!offerLetters) return [];
    if (statusFilter === "all") return offerLetters;
    return offerLetters.filter(o => o.status === statusFilter);
  }, [offerLetters, statusFilter]);
  
  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    return leads.filter(lead => {
      if (leadFilter.status && lead.status !== leadFilter.status) return false;
      return true;
    });
  }, [leads, leadFilter]);
  
  const propertyMap = useMemo(() => {
    if (!properties) return new Map();
    return new Map(properties.map(p => [p.sellerId, p]));
  }, [properties]);
  
  const previewCalculation = useMemo(() => {
    if (selectedLeadIds.length === 0) return { count: 0, totalValue: 0, avgOffer: 0 };
    
    let totalValue = 0;
    selectedLeadIds.forEach(leadId => {
      const property = propertyMap.get(leadId);
      if (property?.assessedValue) {
        totalValue += Number(property.assessedValue) * (offerPercent / 100);
      }
    });
    
    return {
      count: selectedLeadIds.length,
      totalValue: Math.round(totalValue),
      avgOffer: selectedLeadIds.length > 0 ? Math.round(totalValue / selectedLeadIds.length) : 0,
    };
  }, [selectedLeadIds, offerPercent, propertyMap]);
  
  const handlePreflightCheck = () => {
    if (selectedLeadIds.length === 0) {
      toast({
        title: "No leads selected",
        description: "Select at least one lead before running the pre-flight check — nothing was checked.",
        variant: "destructive",
      });
      return;
    }
    setIsPreflightOpen(true);
  };

  const handleGenerateBatch = () => {
    if (selectedLeadIds.length === 0) {
      toast({
        title: "No leads selected",
        description: "Select at least one lead before generating a batch — no offers were created.",
        variant: "destructive",
      });
      return;
    }
    createBatchMutation.mutate({ leadIds: selectedLeadIds, offerPercent, expirationDays });
  };

  const handleRemoveInvalidLeads = (leadIds: number[]) => {
    setSelectedLeadIds(prev => prev.filter(id => !leadIds.includes(id)));
    toast({
      title: "Leads removed from selection.",
      description: `${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} with errors removed from selection — no offers were sent.`,
    });
  };
  
  const handleSendSelected = () => {
    selectedOffers.forEach(id => {
      const offer = offerLetters?.find(o => o.id === id);
      if (offer?.status === "draft") {
        sendOfferMutation.mutate(id);
      }
    });
    setSelectedOffers([]);
  };
  
  const handleDeleteSelected = () => {
    selectedOffers.forEach(id => deleteOfferMutation.mutate(id));
    setSelectedOffers([]);
  };
  
  const toggleOfferSelection = (id: number) => {
    setSelectedOffers(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  
  const toggleLeadSelection = (id: number) => {
    setSelectedLeadIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  
  const handleTemplateSubmit = () => {
    if (editingTemplate) {
      updateTemplateMutation.mutate({ id: editingTemplate.id, data: templateForm });
    } else {
      createTemplateMutation.mutate(templateForm);
    }
  };
  
  const openEditTemplate = (template: OfferTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      type: template.type,
      subject: template.subject || "",
      content: template.content,
    });
    setIsTemplateDialogOpen(true);
  };

  return (
    <PageShell label="Offers">
        
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="acr-cc-hero" style={{ marginTop: 0 }}>
              <div>
                <div className="acr-eyebrow">Offer letters</div>
                <h1 className="acr-cc-greeting" data-testid="text-page-title">
                  Make the offer.
                  <span className="acr-cc-greeting-soft">
                    {" "}Generate and track blind offers without leaving the app.
                  </span>
                </h1>
              </div>
            </div>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList data-testid="tabs-offers">
              <TabsTrigger value="queue" data-testid="tab-queue">
                <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
                Offer queue
              </TabsTrigger>
              <TabsTrigger value="calculator" data-testid="tab-calculator">
                <Calculator className="w-4 h-4 mr-2" aria-hidden="true" />
                Batch calculator
              </TabsTrigger>
              <TabsTrigger value="templates" data-testid="tab-templates">
                <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                Templates
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="queue" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40" data-testid="select-status-filter" aria-label="Filter offers by status">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {offerStatuses.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedOffers.length > 0 && (
                  <div className="flex items-center gap-2" role="group" aria-label={`Bulk actions for ${selectedOffers.length} selected offer${selectedOffers.length === 1 ? "" : "s"}`}>
                    <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">{selectedOffers.length} selected</span>
                    <Button
                      size="sm"
                      onClick={handleSendSelected}
                      disabled={sendOfferMutation.isPending}
                      data-testid="button-send-selected"
                      aria-label={`Send ${selectedOffers.length} selected offer${selectedOffers.length === 1 ? "" : "s"}`}
                    >
                      <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                      Send selected
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setPendingBulkDelete(true)}
                      disabled={deleteOfferMutation.isPending}
                      data-testid="button-delete-selected"
                      aria-label={`Delete ${selectedOffers.length} selected offer${selectedOffers.length === 1 ? "" : "s"}`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
              
              {offersLoading ? (
                <ListSkeleton count={5} />
              ) : filteredOffers.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  title="No offer letters"
                  description="Generate batch offers using the calculator or create individual offers."
                  actionLabel="Open calculator"
                  onAction={() => setActiveTab("calculator")}
                />
              ) : (
                <Card>
                  <div role="region" aria-label={`${filteredOffers.length} offer${filteredOffers.length === 1 ? "" : "s"}`} tabIndex={0} className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedOffers.length === filteredOffers.length && filteredOffers.length > 0}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedOffers(filteredOffers.map(o => o.id));
                              } else {
                                setSelectedOffers([]);
                              }
                            }}
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                        <TableHead scope="col">Property / lead</TableHead>
                        <TableHead scope="col">Offer amount</TableHead>
                        <TableHead scope="col">Status</TableHead>
                        <TableHead scope="col">Delivery</TableHead>
                        <TableHead scope="col">Sent date</TableHead>
                        <TableHead scope="col" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOffers.map((offer) => {
                        const lead = leads?.find(l => l.id === offer.leadId);
                        const property = properties?.find(p => p.id === offer.propertyId);
                        
                        return (
                          <TableRow key={offer.id} data-testid={`row-offer-${offer.id}`}>
                            <TableCell>
                              <Checkbox
                                checked={selectedOffers.includes(offer.id)}
                                onCheckedChange={() => toggleOfferSelection(offer.id)}
                                data-testid={`checkbox-offer-${offer.id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">
                                  {property?.address || "No property"}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {lead ? `${lead.firstName} ${lead.lastName}` : "Unknown lead"}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-mono font-medium tabular-nums">
                                {usd(Number(offer.offerAmount))}
                              </div>
                              {offer.offerPercent && (
                                <div className="text-xs text-muted-foreground tabular-nums">
                                  {offer.offerPercent}% of assessed
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{getStatusBadge(offer.status)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">
                                {offer.deliveryMethod?.replace(/_/g, " ") || "Direct mail"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {offer.sentAt ? (
                                <time dateTime={new Date(offer.sentAt).toISOString()} className="tabular-nums">{format(new Date(offer.sentAt), "MMM d, yyyy")}</time>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {offer.status === "draft" && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => sendOfferMutation.mutate(offer.id)}
                                    disabled={sendOfferMutation.isPending}
                                    aria-label={`Send offer to ${lead ? `${lead.firstName} ${lead.lastName}` : "lead"} for ${property?.address || "property"}`}
                                    data-testid={`button-send-${offer.id}`}
                                  >
                                    <Send className="w-4 h-4" aria-hidden="true" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setPendingDeleteOffer(offer)}
                                  disabled={deleteOfferMutation.isPending}
                                  aria-label={`Delete offer to ${lead ? `${lead.firstName} ${lead.lastName}` : "lead"} for ${property?.address || "property"}`}
                                  data-testid={`button-delete-${offer.id}`}
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="calculator" className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calculator className="w-5 h-5" aria-hidden="true" />
                      Blind offer calculator
                    </CardTitle>
                    <CardDescription>
                      Configure offer parameters and select leads to generate batch offers.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="offer-percent-slider">Target % of assessed value</Label>
                          <span className="text-lg font-bold tabular-nums text-primary" data-testid="text-offer-percent" aria-live="polite">{offerPercent}%</span>
                        </div>
                        <Slider
                          id="offer-percent-slider"
                          value={[offerPercent]}
                          onValueChange={([value]) => setOfferPercent(value)}
                          min={10}
                          max={50}
                          step={1}
                          className="w-full"
                          data-testid="slider-offer-percent"
                          aria-label="Target percent of assessed value"
                          aria-valuetext={`${offerPercent} percent`}
                        />
                        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                          <span>10%</span>
                          <span>30%</span>
                          <span>50%</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="expiration-days">Offer expiration (days)</Label>
                        <Input
                          id="expiration-days"
                          type="number"
                          inputMode="numeric"
                          className="tabular-nums"
                          value={expirationDays}
                          onChange={(e) => setExpirationDays(parseInt(e.target.value) || 30)}
                          min={7}
                          max={90}
                          data-testid="input-expiration-days"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="lead-status-filter">Filter leads by status</Label>
                        <Select value={leadFilter.status} onValueChange={(v) => setLeadFilter(f => ({ ...f, status: v }))}>
                          <SelectTrigger id="lead-status-filter" data-testid="select-lead-status-filter">
                            <SelectValue placeholder="All statuses" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All statuses</SelectItem>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="qualified">Qualified</SelectItem>
                            <SelectItem value="negotiating">Negotiating</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <h4 className="font-medium">Preview calculation</h4>
                      <dl className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 rounded-lg bg-muted/50">
                          <dd className="text-2xl font-bold tabular-nums" data-testid="text-preview-count">{previewCalculation.count}</dd>
                          <dt className="text-xs text-muted-foreground">Leads selected</dt>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <dd className="text-2xl font-bold font-mono tabular-nums" data-testid="text-preview-total">
                            {usd(previewCalculation.totalValue)}
                          </dd>
                          <dt className="text-xs text-muted-foreground">Total offers</dt>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/50">
                          <dd className="text-2xl font-bold font-mono tabular-nums" data-testid="text-preview-avg">
                            {usd(previewCalculation.avgOffer)}
                          </dd>
                          <dt className="text-xs text-muted-foreground">Avg offer</dt>
                        </div>
                      </dl>
                    </div>

                    <Button
                      className="w-full min-h-11"
                      onClick={handlePreflightCheck}
                      disabled={createBatchMutation.isPending || selectedLeadIds.length === 0}
                      data-testid="button-preflight-check"
                    >
                      {createBatchMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      ) : (
                        <ClipboardCheck className="w-4 h-4 mr-2" aria-hidden="true" />
                      )}
                      Review &amp; generate <span className="tabular-nums mx-1">{selectedLeadIds.length}</span> offer{selectedLeadIds.length === 1 ? "" : "s"}
                    </Button>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle>Select leads</CardTitle>
                    <CardDescription>
                      Choose leads to include in the batch offer generation.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <fieldset className="border-0 p-0 m-0">
                      <legend className="sr-only">Choose leads to include in the batch</legend>
                      <ul className="max-h-96 overflow-y-auto space-y-2 list-none p-0 m-0" aria-label={`${filteredLeads.length} candidate lead${filteredLeads.length === 1 ? "" : "s"}`}>
                        {filteredLeads.length === 0 ? (
                          <li className="text-center text-muted-foreground py-8 list-none">
                            No leads available.
                          </li>
                        ) : (
                          filteredLeads.map(lead => {
                            const property = propertyMap.get(lead.id);
                            const assessedValue = property?.assessedValue ? Number(property.assessedValue) : 0;
                            const estimatedOffer = Math.round(assessedValue * (offerPercent / 100));
                            const cbId = `batch-lead-${lead.id}`;
                            const checked = selectedLeadIds.includes(lead.id);

                            return (
                              <li key={lead.id}>
                                <label
                                  htmlFor={cbId}
                                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                    checked
                                      ? "border-primary bg-primary/5"
                                      : "border-border hover-elevate"
                                  }`}
                                  data-testid={`lead-select-${lead.id}`}
                                >
                                  <Checkbox
                                    id={cbId}
                                    checked={checked}
                                    onCheckedChange={() => toggleLeadSelection(lead.id)}
                                    data-testid={`checkbox-lead-${lead.id}`}
                                    aria-label={`Include ${lead.firstName} ${lead.lastName} in batch`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">
                                      {lead.firstName} {lead.lastName}
                                    </div>
                                    <div className="text-sm text-muted-foreground truncate">
                                      {property?.address || "No property linked"}
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    {assessedValue > 0 ? (
                                      <>
                                        <div className="text-xs text-muted-foreground tabular-nums">
                                          Assessed: {usd(assessedValue)}
                                        </div>
                                        <div className="text-sm font-medium font-mono text-primary tabular-nums">
                                          Offer: {usd(estimatedOffer)}
                                        </div>
                                      </>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">No value</span>
                                    )}
                                  </div>
                                </label>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </fieldset>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedLeadIds(filteredLeads.map(l => l.id))}
                        data-testid="button-select-all-leads"
                      >
                        Select all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedLeadIds([])}
                        data-testid="button-clear-selection"
                      >
                        Clear selection
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            
            <TabsContent value="templates" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Offer letter templates</h3>
                <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      onClick={() => {
                        setEditingTemplate(null);
                        setTemplateForm({ name: "", type: "blind_offer", subject: "", content: "" });
                      }}
                      data-testid="button-create-template"
                    >
                      <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                      New template
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>{editingTemplate ? "Edit template" : "Create template"}</DialogTitle>
                      <DialogDescription>
                        Create a reusable template for your offer letters.
                      </DialogDescription>
                    </DialogHeader>
                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (templateForm.name && templateForm.content && !createTemplateMutation.isPending && !updateTemplateMutation.isPending) {
                          handleTemplateSubmit();
                        }
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="template-name">Template name</Label>
                        <Input
                          id="template-name"
                          value={templateForm.name}
                          onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="e.g., Standard blind offer"
                          autoCapitalize="words"
                          data-testid="input-template-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="template-type">Template type</Label>
                        <Select
                          value={templateForm.type}
                          onValueChange={(v) => setTemplateForm(f => ({ ...f, type: v }))}
                        >
                          <SelectTrigger id="template-type" data-testid="select-template-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="blind_offer">Blind offer</SelectItem>
                            <SelectItem value="follow_up">Follow-up</SelectItem>
                            <SelectItem value="final_offer">Final offer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="template-subject">Subject line</Label>
                        <Input
                          id="template-subject"
                          value={templateForm.subject}
                          onChange={(e) => setTemplateForm(f => ({ ...f, subject: e.target.value }))}
                          placeholder="Cash offer for your property at {{address}}"
                          autoCapitalize="sentences"
                          data-testid="input-template-subject"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="template-content">Letter content</Label>
                        <Textarea
                          id="template-content"
                          value={templateForm.content}
                          onChange={(e) => setTemplateForm(f => ({ ...f, content: e.target.value }))}
                          placeholder="Dear {{owner_name}},&#10;&#10;We are interested in purchasing your property at {{address}} for ${{offer_amount}}…"
                          rows={10}
                          autoCapitalize="sentences"
                          data-testid="textarea-template-content"
                        />
                        <p className="text-xs text-muted-foreground">
                          Available variables: {"{{owner_name}}, {{address}}, {{offer_amount}}, {{expiration_date}}, {{company_name}}"}
                        </p>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending || !templateForm.name || !templateForm.content}
                          data-testid="button-save-template"
                        >
                          {(createTemplateMutation.isPending || updateTemplateMutation.isPending) && (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                          )}
                          {editingTemplate ? "Update template" : "Create template"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              
              {templatesLoading ? (
                <ListSkeleton count={3} />
              ) : !templates || templates.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No templates yet"
                  description="Create your first offer letter template to get started."
                  actionLabel="Create template"
                  onAction={() => {
                    setEditingTemplate(null);
                    setTemplateForm({ name: "", type: "blind_offer", subject: "", content: "" });
                    setIsTemplateDialogOpen(true);
                  }}
                />
              ) : (
                <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0" aria-label={`${templates.length} offer-letter template${templates.length === 1 ? "" : "s"}`}>
                  {templates.map((template) => (
                    <li key={template.id}>
                    <Card data-testid={`card-template-${template.id}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <CardTitle className="text-base">{template.name}</CardTitle>
                            <Badge variant="outline" className="mt-1 capitalize" aria-label={`Type: ${template.type.replace(/_/g, " ")}`}>
                              {template.type.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          {template.isDefault && (
                            <Badge className="bg-primary/10 text-primary" aria-label="Default template">Default</Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {template.subject && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Subject: </span>
                            {template.subject}
                          </div>
                        )}
                        <div className="text-sm text-muted-foreground line-clamp-3">
                          {template.content}
                        </div>
                        <div className="flex items-center gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditTemplate(template)}
                            data-testid={`button-edit-template-${template.id}`}
                            aria-label={`Edit ${template.name} template`}
                          >
                            <Edit className="w-4 h-4 mr-1" aria-hidden="true" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingDeleteTemplate(template)}
                            disabled={deleteTemplateMutation.isPending}
                            data-testid={`button-delete-template-${template.id}`}
                            aria-label={`Delete ${template.name} template`}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
          {/* Preflight Checklist Dialog */}
          <OfferPreflightChecklist
            open={isPreflightOpen}
            onOpenChange={setIsPreflightOpen}
            selectedLeadIds={selectedLeadIds}
            leads={leads || []}
            propertyMap={propertyMap}
            onProceed={handleGenerateBatch}
            onRemoveLeads={handleRemoveInvalidLeads}
          />

          <ConfirmDialog
            open={!!pendingDeleteOffer}
            onOpenChange={(open) => { if (!open) setPendingDeleteOffer(null); }}
            title="Delete this offer letter?"
            description={(() => {
              if (!pendingDeleteOffer) return "";
              const lead = leads?.find(l => l.id === pendingDeleteOffer.leadId);
              const property = properties?.find(p => p.id === pendingDeleteOffer.propertyId);
              const who = lead ? `${lead.firstName} ${lead.lastName}` : "the lead";
              const where = property?.address || "the property";
              return `Permanently removes the ${usd(Number(pendingDeleteOffer.offerAmount))} offer to ${who} for ${where}. If it has already been sent, the recipient still has their copy — this only deletes your record.`;
            })()}
            confirmLabel="Delete offer letter"
            variant="destructive"
            onConfirm={() => {
              if (pendingDeleteOffer) deleteOfferMutation.mutate(pendingDeleteOffer.id);
              setPendingDeleteOffer(null);
            }}
          />

          <ConfirmDialog
            open={!!pendingDeleteTemplate}
            onOpenChange={(open) => { if (!open) setPendingDeleteTemplate(null); }}
            title={`Delete template "${pendingDeleteTemplate?.name}"?`}
            description="Permanently removes this template. Offers already generated from it are not affected — only future generations will be missing this option."
            confirmLabel="Delete template"
            variant="destructive"
            onConfirm={() => {
              if (pendingDeleteTemplate) deleteTemplateMutation.mutate(pendingDeleteTemplate.id);
              setPendingDeleteTemplate(null);
            }}
          />

          <ConfirmDialog
            open={pendingBulkDelete}
            onOpenChange={(open) => { if (!open) setPendingBulkDelete(false); }}
            title={`Delete ${selectedOffers.length} offer letter${selectedOffers.length === 1 ? "" : "s"}?`}
            description="Permanently removes the selected offer letters. Already-sent recipients still have their copies — this only deletes your records."
            confirmLabel={`Delete ${selectedOffers.length}`}
            variant="destructive"
            onConfirm={() => {
              handleDeleteSelected();
              setPendingBulkDelete(false);
            }}
          />
    </PageShell>
  );
}
