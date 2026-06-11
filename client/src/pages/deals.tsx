import { PageShell } from "@/components/page-shell";
import { plural, usd } from "@/lib/format";
import "./today.css";
import { DealJourney } from "@/components/ui/deal-journey";
import { PaxContextButton } from "@/components/pax-context-button";
import { ListPagination, usePagination } from "@/components/list-pagination";
import { useDeals, useDealsPaginated, useDealAggregates, useCreateDeal, useUpdateDeal, useDeleteDeal, useSaveDealAnalysis, useBulkStageUpdate, useBulkStageUndo, useAdvanceDealStage, type BulkStageUpdateResult } from "@/hooks/use-deals";
import { Skeleton } from "@/components/ui/skeleton";
import { useProperties } from "@/hooks/use-properties";
import { ListSkeleton } from "@/components/list-skeleton";
import { InlineError } from "@/components/inline-error";
import { QueryErrorState } from "@/components/query-error-state";
import { ContentReveal } from "@/components/ContentReveal";
import { telemetry } from "@/lib/telemetry";
import { useDealChecklist, useChecklistTemplates, useApplyChecklistTemplate, useUpdateChecklistItem, useStageGate } from "@/hooks/use-checklists";
import { useState, useMemo, useEffect, useRef } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSearch, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDealSchema, type Deal, type Property, type DealChecklistItem, type DocumentPackage } from "@shared/schema";
import { z } from "zod";
import { DealCalculator, type AnalysisResults } from "@/components/deal-calculator";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

// insertDealSchema already omits organizationId (set server-side), so we use it directly.
const dealFormSchema = insertDealSchema;
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, DollarSign, Calendar, Building, TrendingUp, CheckCircle, X, GripVertical, FileText, Trash2, Loader2, Briefcase, Calculator, ClipboardCheck, Upload, AlertTriangle, AlertCircle, CheckSquare, Square, Clock, Download, Package, Play, Eye, FolderPlus, Sparkles, Flame, Snowflake, Minus, LayoutGrid, List, ChevronLeft, ChevronRight, Undo2, Send, Phone, ArrowRight, EllipsisVertical, ChevronsRight, Archive } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FirstHelloEmpty } from "@/components/empty-states";
import { SavedViewsSelector } from "@/components/saved-views-selector";
import type { SavedView } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, differenceInDays } from "date-fns";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActivityTimeline } from "@/components/activity-timeline";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import { getDealNextAction, getDaysInStage, getDealUrgency, type DealNextAction } from "@/lib/deal-utils";
import { DealDetailContent } from "@/components/deal-detail-content";
import { SwipeableCard } from "@/components/mobile/SwipeableCard";

type DealWithProperty = Deal & { property?: Property };

const dealStages = [
  { value: 'negotiating', label: 'Negotiating', color: 'bg-muted' },
  { value: 'offer_sent', label: 'Offer Sent', color: 'bg-acr-brand-soft' },
  { value: 'countered', label: 'Countered', color: 'bg-acr-warn-soft' },
  { value: 'accepted', label: 'Accepted', color: 'bg-acr-pos-soft' },
  { value: 'in_escrow', label: 'In Escrow', color: 'bg-acr-warn-soft' },
  { value: 'closed', label: 'Closed', color: 'bg-acr-pos-soft' },
];

// Benchmark days per stage before a deal is considered stalled
const STAGE_BENCHMARK_DAYS: Record<string, number> = {
  negotiating: 14,
  offer_sent: 5,
  countered: 5,
  accepted: 7,
  in_escrow: 30,
  closed: 999,
  cancelled: 999,
};

function getDealHealth(deal: DealWithProperty): { status: 'healthy' | 'warning' | 'stalled'; days: number } {
  const updatedAt = deal.updatedAt ? new Date(deal.updatedAt) : new Date();
  const days = differenceInDays(new Date(), updatedAt);
  const benchmark = STAGE_BENCHMARK_DAYS[deal.status] ?? 14;
  if (days >= benchmark * 2) return { status: 'stalled', days };
  if (days >= benchmark * 1.25) return { status: 'warning', days };
  return { status: 'healthy', days };
}

// HEALTH_DOT reserved for future deal-list health indicators (pipeline view)

const statusColors: Record<string, string> = {
  negotiating: 'bg-muted text-muted-foreground',
  offer_sent: 'bg-acr-brand-soft text-acr-brand',
  countered: 'bg-acr-warn-soft text-acr-warn',
  accepted: 'bg-acr-pos-soft text-acr-pos',
  in_escrow: 'bg-acr-warn-soft text-acr-warn',
  closed: 'bg-acr-pos-soft text-acr-pos',
  cancelled: 'bg-acr-neg-soft text-acr-neg',
};

// `embedded` — mounted inside the /pipeline door's Board + Deals tabs
// (pipeline.tsx), which already renders the app shell. See
// PageShellProps.embedded (T0-9).
export default function DealsPage({ embedded = false }: { embedded?: boolean }) {
  // Parent page (pipeline.tsx) owns the H1 when embedded.
  const HeadingTag = embedded ? ("h2" as const) : ("h1" as const);
  const dealsLabel = useTerm("entity.deal.plural");
  const dealLabel = useTerm("entity.deal");
  useDocumentTitle(dealsLabel);
  const [dealCurrentPage, setDealCurrentPage] = useState(1);
  const [dealPageSize, setDealPageSize] = useState(25);
  const { data: dealsResponse, isLoading, isError, error, refetch } = useDealsPaginated({ page: dealCurrentPage, pageSize: dealPageSize });
  const rawDeals = dealsResponse?.data;
  const serverDealTotal = dealsResponse?.total ?? 0;
  const { data: propertiesRaw } = useProperties();
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];
  // r5 James / cycle 7: the /api/deals endpoint returns deals without
  // an embedded property relation, so DealCard falls back to
  // "Property #3" instead of "Yavapai, AZ". Hydrate deals with their
  // matching property client-side using the already-fetched
  // properties list. When the property isn't found we leave deal.property
  // undefined so the existing fallback still runs.
  // Keys coerced via Number() (preserves the r8 Tasha / c9 fix): ids can
  // drift between string and number across API shapes; a raw-keyed Map
  // would silently miss. This Map is now the ONLY property join — the
  // per-deal properties.find() that duplicated it at O(n×m) further down
  // was removed in T0-10.
  const propById = new Map<number, any>(properties.map((p: any) => [Number(p.id), p]));
  const deals = rawDeals?.map((d: any) => ({
    ...d,
    property: d.property ?? (d.propertyId != null ? propById.get(Number(d.propertyId)) : undefined),
  })) as typeof rawDeals;
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const actionFromUrl = urlParams.get("action");
  const typeFromUrl = urlParams.get("type") || "all";
  const { isMobile } = useIsMobile();
  const { toast } = useToast();
  
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new");
  const [deletingDeal, setDeletingDeal] = useState<DealWithProperty | null>(null);
  const { mutate: deleteDeal, isPending: isDeleting } = useDeleteDeal();
  const [isExporting, setIsExporting] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<number>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>(typeFromUrl);

  // P1-28 — URL-sync deals filter so /deals?type=acquisition round-trips
  // back from /deals/:id without losing the active scope.
  useEffect(() => {
    const params = new URLSearchParams();
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    if (actionFromUrl) params.set("action", actionFromUrl);
    const qs = params.toString();
    const target = qs ? `/deals?${qs}` : "/deals";
    if (`${window.location.pathname}${window.location.search}` !== target) {
      setLocation(target, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);
  const { mutate: updateDealStage } = useUpdateDeal();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const dealId = active.id as number;
    const newStage = over.id as string;
    const stageDef = dealStages.find(s => s.value === newStage);
    if (!stageDef) return;
    const previousDeal = enrichedDeals.find(d => d.id === dealId);
    if (previousDeal && previousDeal.status === newStage) return;
    const locationLabel = previousDeal?.property
      ? `${previousDeal.property.county}, ${previousDeal.property.state}`
      : `Deal #${dealId}`;
    updateDealStage(
      { id: dealId, status: newStage },
      {
        onSuccess: () => {
          toast({
            title: "Stage updated",
            description: `${locationLabel} moved to ${stageDef.label}.`,
          });
        },
        onError: (err: any) => {
          toast({
            title: "Couldn't move deal",
            description: err?.message || "Your change didn't save. Try again in a moment.",
            variant: "destructive",
          });
        },
      },
    );
  };

  // Bulk selection state for bulk stage update with undo
  const [bulkStageDialogOpen, setBulkStageDialogOpen] = useState(false);
  const [bulkTargetStage, setBulkTargetStage] = useState<string>("");
  const [lastUndoState, setLastUndoState] = useState<Array<{ id: number; previousStage: string }> | null>(null);

  const { mutate: bulkStageUpdate, isPending: isBulkStageUpdating } = useBulkStageUpdate();
  const { mutate: undoBulkUpdate, isPending: isUndoing } = useBulkStageUndo();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/export/deals?format=csv', { credentials: 'include' });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
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
      toast({
        title: "Export ready",
        description: `Downloaded ${filename}.`,
      });
    } catch (error: any) {
      toast({
        title: "Couldn't export deals",
        description: error?.message || "CSV build failed. Try again — your deals weren't changed.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDealIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await apiRequest("POST", "/api/deals/bulk-delete", { ids: Array.from(selectedDealIds) });
      const result = await res.json();
      toast({
        title: "Deals deleted",
        description: `Removed ${plural(result.deletedCount ?? selectedDealIds.size, "deal")} from your pipeline.`,
      });
      setSelectedDealIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['/api/deals'] });
    } catch (err: any) {
      toast({
        title: "Couldn't delete deals",
        description: err?.message || "Delete failed. Your deals are unchanged.",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  const handleBulkExport = () => {
    try {
      const selected = enrichedDeals.filter(d => selectedDealIds.has(d.id));
      if (selected.length === 0) return;
      const headers = ["id", "type", "status", "offerAmount", "acceptedAmount", "county", "state"];
      // CSV cell escape: wrap in quotes, double any embedded quotes, and
      // neutralize leading formula characters (=, +, -, @, tab, CR) that
      // spreadsheets interpret as formulas.
      const escapeCell = (v: unknown) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = [headers.map(escapeCell).join(","), ...selected.map(d =>
        [d.id, d.type, d.status, d.offerAmount || "", d.acceptedAmount || "", d.property?.county || "", d.property?.state || ""]
          .map(escapeCell)
          .join(",")
      )];
      const filename = `deals-export-${new Date().toISOString().split("T")[0]}.csv`;
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export ready",
        description: `Downloaded ${plural(selected.length, "deal")} to ${filename}.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't export selection",
        description: err?.message || "CSV build failed. Try again — your deals weren't changed.",
        variant: "destructive",
      });
    }
  };

  // T0-10 cleanup — property hydration happens exactly once upstream via
  // the propById Map (O(n+m)). The per-deal properties.find() that used to
  // live here duplicated that join at O(n×m) for zero benefit.
  const enrichedDeals: DealWithProperty[] = (deals || [])
    .filter(deal => typeFilter === "all" || deal.type === typeFilter);

  // Server-side pagination: data is already one page
  const paginatedDeals = enrichedDeals;
  const totalDealItems = serverDealTotal;
  const safeDealPage = dealCurrentPage;

  const handleDealPageChange = (page: number) => {
    setDealCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDealPageSizeChange = (size: number) => {
    setDealPageSize(size);
    setDealCurrentPage(1);
  };

  // T0-10 — header KPIs + stage distribution read from the org-wide SQL
  // aggregates endpoint (GET /api/deals/aggregates), NOT the current page
  // of useDealsPaginated. The page-local reductions that used to live here
  // silently lied for any org with more than one page (25 rows) of deals.
  const { data: dealAggregates, isLoading: isAggregatesLoading } = useDealAggregates(typeFilter);
  const aggTotals = dealAggregates?.totals;
  const acquisitionsCount = aggTotals?.acquisitions ?? 0;
  const dispositionsCount = aggTotals?.dispositions ?? 0;
  const totalPipelineValue = aggTotals?.totalPipelineValue ?? 0;
  const closedValue = aggTotals?.closedValue ?? 0;
  const stalledCount = aggTotals?.stalledCount ?? 0;
  const warningCount = aggTotals?.warningCount ?? 0;
  const totalDealCount = aggTotals?.totalDeals ?? 0;

  // Stage distribution for pipeline visualization — org-wide counts.
  const stageDistribution = useMemo(() => {
    const byStatus = new Map((dealAggregates?.stages ?? []).map(s => [s.status, s]));
    return dealStages.map(s => ({
      ...s,
      count: byStatus.get(s.value)?.count ?? 0,
    }));
  }, [dealAggregates]);

  const handleDelete = () => {
    if (deletingDeal) {
      deleteDeal(deletingDeal.id, {
        onSuccess: () => {
          setDeletingDeal(null);
        },
      });
    }
  };
  
  // Bulk selection helpers
  const toggleDealSelection = (dealId: number) => {
    setSelectedDealIds(prev => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  };
  
  const clearSelection = () => {
    setSelectedDealIds(new Set());
  };
  
  const selectAllInStage = (stageValue: string) => {
    const stageDeals = enrichedDeals.filter(d => d.status === stageValue);
    setSelectedDealIds(prev => {
      const next = new Set(prev);
      stageDeals.forEach(d => next.add(d.id));
      return next;
    });
  };
  
  const handleBulkStageUpdate = () => {
    if (!bulkTargetStage || selectedDealIds.size === 0) return;
    
    bulkStageUpdate(
      { ids: Array.from(selectedDealIds), newStage: bulkTargetStage, confirmed: true },
      {
        onSuccess: (data) => {
          if ('success' in data && data.success) {
            const result = data as BulkStageUpdateResult;
            setLastUndoState(result.previousStates);
            clearSelection();
            setBulkStageDialogOpen(false);
            setBulkTargetStage("");
            toast({
              title: "Deals updated",
              description: result.message,
              action: result.undoAvailable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (result.previousStates) {
                      undoBulkUpdate(result.previousStates, {
                        onSuccess: () => setLastUndoState(null),
                      });
                    }
                  }}
                  disabled={isUndoing}
                >
                  <Undo2 className="w-4 h-4 mr-1" aria-hidden="true" />
                  Undo
                </Button>
              ) : undefined,
            });
          } else {
            toast({
              title: "Couldn't update stage",
              description: ('message' in data && typeof data.message === 'string')
                ? data.message
                : "Your changes didn't save. Try again in a moment.",
              variant: "destructive",
            });
          }
        },
        onError: (err: any) => {
          toast({
            title: "Couldn't update stage",
            description: err?.message || "Your changes didn't save. Try again in a moment.",
            variant: "destructive",
          });
        },
      }
    );
  };

  if (error) {
    return (
      <PageShell label={dealsLabel} embedded={embedded}>
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Failed to load deals"
          testId="error-state-deals"
        />
      </PageShell>
    );
  }

  return (
    <PageShell label={dealsLabel} embedded={embedded}>
        
          
<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {isError && (
              <InlineError 
                message={(error as Error)?.message || "Failed to load deals."}
                onRetry={() => (refetch as () => void)()}
                testId="inline-error-deals"
              />
            )}
            <div className="acr-cc-hero" style={{ marginTop: 0 }}>
              <div>
                <div className="acr-eyebrow">Deals</div>
                <HeadingTag className="text-hero acr-cc-greeting" data-testid="text-page-title">
                  Acquisitions and dispositions.
                  <span className="acr-cc-greeting-soft">
                    {" "}From offer to close, all on one rail.
                  </span>
                </HeadingTag>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                data-testid="button-export-deals"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 mr-2" aria-hidden="true" />}
                Export CSV
              </Button>
              <ResponsiveModal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <ResponsiveModalTrigger asChild>
                  <Button data-testid="button-create-deal">
                    <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New {dealLabel.toLowerCase()}
                  </Button>
                </ResponsiveModalTrigger>
              <ResponsiveModalContent className="sm:max-w-[500px] floating-window">
                <ResponsiveModalHeader>
                  <ResponsiveModalTitle>Create {dealLabel.toLowerCase()}</ResponsiveModalTitle>
                  <ResponsiveModalDescription>Start tracking a new acquisition or disposition.</ResponsiveModalDescription>
                </ResponsiveModalHeader>
                <DealForm onSuccess={() => setIsCreateOpen(false)} />
              </ResponsiveModalContent>
              </ResponsiveModal>
            </div>
          </div>

          <DisclaimerBanner type="deals" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-acr-brand-soft flex-shrink-0">
                    <Building className="w-4 h-4 md:w-5 md:h-5 text-acr-brand" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Acquisitions</p>
                    {isAggregatesLoading ? (
                      <Skeleton className="h-7 md:h-8 w-10" data-testid="skeleton-acquisitions" />
                    ) : (
                      <p className="text-xl md:text-2xl font-bold" data-testid="text-acquisitions">{acquisitionsCount}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-acr-pos/10 flex-shrink-0">
                    <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-acr-pos" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Dispositions</p>
                    {isAggregatesLoading ? (
                      <Skeleton className="h-7 md:h-8 w-10" data-testid="skeleton-dispositions" />
                    ) : (
                      <p className="text-xl md:text-2xl font-bold" data-testid="text-dispositions">{dispositionsCount}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-primary/10 flex-shrink-0">
                    <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Pipeline</p>
                    {isAggregatesLoading ? (
                      <Skeleton className="h-7 md:h-8 w-20" data-testid="skeleton-pipeline-value" />
                    ) : (
                      <p className="text-lg md:text-2xl font-bold font-mono tabular-nums truncate" data-testid="text-pipeline-value">
                        {usd(totalPipelineValue, { noCents: true })}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 md:p-3 rounded-xl bg-acr-pos/10 flex-shrink-0">
                    <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-acr-pos" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs md:text-sm text-muted-foreground truncate">Closed</p>
                    {isAggregatesLoading ? (
                      <Skeleton className="h-7 md:h-8 w-20" data-testid="skeleton-closed-value" />
                    ) : (
                      <p className="text-lg md:text-2xl font-bold font-mono tabular-nums text-acr-pos truncate" data-testid="text-closed-value">
                        {usd(closedValue, { noCents: true })}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pipeline Health Bar — org-wide counts from /api/deals/aggregates (T0-10) */}
          {isAggregatesLoading ? (
            <div className="rounded-xl border bg-card p-4 space-y-2" role="status" aria-live="polite" aria-busy="true">
              <span className="sr-only">Loading pipeline distribution…</span>
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-64" />
            </div>
          ) : totalDealCount > 0 && (
            <div className="rounded-xl border bg-card p-4 space-y-2" aria-labelledby="pipeline-distribution-heading">
              <div className="flex items-center justify-between text-xs">
                <span id="pipeline-distribution-heading" className="font-medium text-muted-foreground uppercase tracking-wide">
                  Pipeline stage distribution
                </span>
                <div className="flex items-center gap-3">
                  {stalledCount > 0 && (
                    <span className="flex items-center gap-1 text-acr-neg font-medium" role="status">
                      <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {stalledCount} stalled
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="flex items-center gap-1 text-acr-warn font-medium" role="status">
                      <Clock className="w-3 h-3" aria-hidden="true" /> {warningCount} slow
                    </span>
                  )}
                  {stalledCount === 0 && warningCount === 0 && totalDealCount > 0 && (
                    <span className="text-acr-pos font-medium">All deals on track</span>
                  )}
                </div>
              </div>
              <div
                className="flex h-2 rounded-full overflow-hidden gap-0.5"
                role="img"
                aria-label={
                  "Pipeline distribution: " +
                  stageDistribution
                    .filter(s => s.count > 0)
                    .map(s => `${s.count} ${s.label}`)
                    .join(", ") +
                  "."
                }
              >
                {stageDistribution.map((stage) => {
                  const pct = totalDealCount > 0 ? (stage.count / totalDealCount) * 100 : 0;
                  if (pct === 0) return null;
                  const stageBarColors: Record<string, string> = {
                    negotiating: 'bg-muted-foreground/40',
                    offer_sent: 'bg-acr-brand/70',
                    countered: 'bg-acr-warn/80',
                    accepted: 'bg-acr-pos/70',
                    in_escrow: 'bg-acr-brand',
                    closed: 'bg-acr-pos',
                  };
                  return (
                    <div
                      key={stage.value}
                      className={`${stageBarColors[stage.value] ?? 'bg-muted'} transition-all`}
                      style={{ width: `${pct}%` }}
                      title={`${stage.label}: ${stage.count}`}
                      aria-hidden="true"
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden="true">
                {stageDistribution.filter(s => s.count > 0).map((stage) => (
                  <span key={stage.value} className="text-micro text-muted-foreground">
                    {stage.label} <strong>{stage.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <SavedViewsSelector
              entityType="deal"
              currentFilters={{ type: typeFilter }}
              onApplyView={(view: SavedView) => {
                if (view.filters && Array.isArray(view.filters)) {
                  const typeDef = view.filters.find((f: any) => f.field === "type");
                  setTypeFilter(typeDef ? String(typeDef.value) : "all");
                } else {
                  setTypeFilter("all");
                }
              }}
            />
          </div>

          {selectedDealIds.size > 0 && (
            <div className="p-3 bg-muted/50 border rounded-md space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3" data-testid="bulk-actions-toolbar-deals">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">{plural(selectedDealIds.size, "deal")} selected</span>
                <Button variant="ghost" size="icon" className="md:hidden min-h-[44px] min-w-[44px] ml-auto" onClick={() => setSelectedDealIds(new Set())} aria-label="Clear selection">
                  <X className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-2 md:ml-auto">
                <Button variant="outline" className="min-h-[44px] pointer-fine:md:min-h-8" onClick={handleBulkExport} data-testid="button-bulk-export-deals">
                  <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Export
                </Button>
                <Select
                  value={bulkTargetStage}
                  onValueChange={setBulkTargetStage}
                >
                  <SelectTrigger className="min-h-[44px] pointer-fine:md:min-h-8 w-full md:w-[160px]" aria-label="Change stage for selected deals" data-testid="select-bulk-stage-deals">
                    <SelectValue placeholder="Change stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {dealStages.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => setBulkStageDialogOpen(true)}
                  disabled={!bulkTargetStage || isBulkStageUpdating}
                  data-testid="button-bulk-update"
                >
                  {isBulkStageUpdating ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : null}
                  Update stage
                </Button>
                <Button variant="destructive" className="min-h-[44px] pointer-fine:md:min-h-8 col-span-2 md:col-span-1" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting} data-testid="button-bulk-delete-deals">
                  <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" /> Delete
                </Button>
                <Button variant="ghost" size="sm" className="hidden md:flex" onClick={() => setSelectedDealIds(new Set())} aria-label="Clear selection">
                  <X className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}

          {!isLoading && enrichedDeals.length === 0 ? (
            <FirstHelloEmpty
              surface="deals"
              cta={{
                primary: { label: "Create a deal", onClick: () => setIsCreateOpen(true) },
              }}
            />
          ) : (
            <>
              {isMobile && (
                <div className="flex items-center justify-between gap-2 mb-4">
                  <div
                    className="flex items-center gap-1 bg-muted/50 rounded-card p-1"
                    role="group"
                    aria-label="Pipeline view mode"
                  >
                    <Button
                      size="sm"
                      variant={mobileViewMode === 'kanban' ? 'secondary' : 'ghost'}
                      onClick={() => setMobileViewMode('kanban')}
                      className="min-h-[44px] min-w-[44px]"
                      aria-label="Kanban view"
                      aria-pressed={mobileViewMode === 'kanban'}
                      data-testid="button-view-kanban"
                    >
                      <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant={mobileViewMode === 'list' ? 'secondary' : 'ghost'}
                      onClick={() => setMobileViewMode('list')}
                      className="min-h-[44px] min-w-[44px]"
                      aria-label="List view"
                      aria-pressed={mobileViewMode === 'list'}
                      data-testid="button-view-list"
                    >
                      <List className="w-4 h-4" aria-hidden="true" />
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
                        aria-label="Previous stage"
                        data-testid="button-prev-stage"
                      >
                        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
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
                        aria-label="Next stage"
                        data-testid="button-next-stage"
                      >
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {isMobile && mobileViewMode === 'list' ? (
                <div className="space-y-4">
                  {dealStages.map((stage) => {
                    const stageDeals = paginatedDeals.filter(d => d.status === stage.value);
                    if (stageDeals.length === 0) return null;
                    return (
                      <section key={stage.value} aria-labelledby={`mobile-list-stage-${stage.value}`}>
                        <div className={`rounded-xl px-4 py-3 mb-2 ${stage.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <h2 id={`mobile-list-stage-${stage.value}`} className="font-medium text-sm">
                              {stage.label}
                            </h2>
                            <Badge variant="secondary" className="font-mono" aria-label={`${stageDeals.length} ${stageDeals.length === 1 ? "deal" : "deals"}`}>
                              {stageDeals.length}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {stageDeals.map((deal) => {
                            const dealLabel = deal.property
                              ? `${deal.property.county}, ${deal.property.state}`
                              : `Deal #${deal.id}`;
                            return (
                              <div key={deal.id} className="flex items-start gap-2">
                                <label className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 cursor-pointer" aria-label={`Select ${dealLabel}`}>
                                  <Checkbox
                                    checked={selectedDealIds.has(deal.id)}
                                    onCheckedChange={(checked) => {
                                      const next = new Set(selectedDealIds);
                                      checked ? next.add(deal.id) : next.delete(deal.id);
                                      setSelectedDealIds(next);
                                    }}
                                    className="h-5 w-5"
                                    aria-label={`Select ${dealLabel}`}
                                  />
                                </label>
                                <div className="flex-1 min-w-0">
                                  <DealCard
                                    deal={deal}
                                    onSelect={() => setLocation(`/deals/${deal.id}`)}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                  {serverDealTotal > dealPageSize && (
                    <ListPagination
                      currentPage={safeDealPage}
                      totalItems={totalDealItems}
                      pageSize={dealPageSize}
                      onPageChange={handleDealPageChange}
                      onPageSizeChange={handleDealPageSizeChange}
                    />
                  )}
                </div>
              ) : isMobile && mobileViewMode === 'kanban' ? (
                <div className="space-y-2">
                  {(() => {
                    const stage = dealStages[selectedStageIndex];
                    const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                    return (
                      <section aria-labelledby={`mobile-kanban-stage-${stage.value}`}>
                        <div className={`rounded-t-xl px-4 py-3 ${stage.color}`}>
                          <div className="flex items-center justify-between gap-2">
                            <h2 id={`mobile-kanban-stage-${stage.value}`} className="font-medium text-sm">
                              {stage.label}
                            </h2>
                            <Badge variant="secondary" className="font-mono" aria-label={`${stageDeals.length} ${stageDeals.length === 1 ? "deal" : "deals"}`}>
                              {stageDeals.length}
                            </Badge>
                          </div>
                        </div>
                        <div className="bg-muted/30 rounded-b-xl p-3 min-h-[300px] space-y-3">
                          <ContentReveal
                            ready={!isLoading}
                            skeleton={
                              <div data-testid={`skeleton-deals-${stage.value}`}>
                                <ListSkeleton count={2} variant="compact" />
                              </div>
                            }
                          >
                            {stageDeals.length === 0 ? (
                              <div className="text-center py-8 text-muted-foreground text-sm">
                                No deals in {stage.label}
                              </div>
                            ) : (
                              <>
                                {stageDeals.map((deal) => (
                                  <DealCard
                                    key={deal.id}
                                    deal={deal}
                                    onSelect={() => setLocation(`/deals/${deal.id}`)}
                                    isSelected={selectedDealIds.has(deal.id)}
                                    onToggleSelect={toggleDealSelection}
                                  />
                                ))}
                              </>
                            )}
                          </ContentReveal>
                        </div>
                        <div
                          className="flex justify-center mt-1"
                          role="tablist"
                          aria-label="Jump to stage"
                        >
                          {/* 44px hit areas (negative margins keep the row visually compact);
                              the 12px dot is a decorative span inside the real target. */}
                          {dealStages.map((s, idx) => (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => setSelectedStageIndex(idx)}
                              role="tab"
                              aria-selected={idx === selectedStageIndex}
                              aria-label={`Show ${s.label}`}
                              className="flex h-11 w-11 -my-2 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                              data-testid={`dot-stage-${s.value}`}
                            >
                              <span
                                aria-hidden="true"
                                className={`block w-3 h-3 rounded-full transition-colors ${
                                  idx === selectedStageIndex
                                    ? 'bg-primary'
                                    : 'bg-muted-foreground/30 hover:bg-muted-foreground/50 active:bg-muted-foreground/60'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })()}
                </div>
              ) : (
                <div className="relative">
                  <DndContext
                    sensors={sensors}
                    onDragStart={(e) => setActiveDragId(e.active.id as number)}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveDragId(null)}
                    accessibility={{
                      screenReaderInstructions: {
                        draggable:
                          "To move a deal between stages: press Space or Enter to pick it up, use arrow keys to move between columns, press Space or Enter to drop it into the highlighted stage, or press Escape to cancel.",
                      },
                      announcements: {
                        onDragStart: ({ active }) => {
                          const d = enrichedDeals.find(x => x.id === active.id);
                          const label = d?.property
                            ? `${d.property.county}, ${d.property.state}`
                            : `Deal ${String(active.id)}`;
                          return `Picked up ${label}.`;
                        },
                        onDragOver: ({ over }) => {
                          if (!over) return "Not over a stage.";
                          const s = dealStages.find(x => x.value === over.id);
                          return s ? `Over ${s.label}.` : "Not over a stage.";
                        },
                        onDragEnd: ({ active, over }) => {
                          const d = enrichedDeals.find(x => x.id === active.id);
                          const label = d?.property
                            ? `${d.property.county}, ${d.property.state}`
                            : `Deal ${String(active.id)}`;
                          if (!over) return `Drop canceled for ${label}.`;
                          const s = dealStages.find(x => x.value === over.id);
                          return s ? `Moved ${label} to ${s.label}.` : `Drop canceled for ${label}.`;
                        },
                        onDragCancel: ({ active }) => {
                          const d = enrichedDeals.find(x => x.id === active.id);
                          const label = d?.property
                            ? `${d.property.county}, ${d.property.state}`
                            : `Deal ${String(active.id)}`;
                          return `Drop canceled for ${label}.`;
                        },
                      },
                    }}
                  >
                    <div className="overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                      <div className="flex gap-4 min-w-max px-1">
                        {dealStages.map((stage) => {
                          const stageDeals = enrichedDeals.filter(d => d.status === stage.value);
                          return (
                            <KanbanColumn
                              key={stage.value}
                              stage={stage}
                              deals={stageDeals}
                              isLoading={isLoading}
                              activeDragId={activeDragId}
                              onSelect={(deal) => setLocation(`/deals/${deal.id}`)}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <DragOverlay dropAnimation={null}>
                      {activeDragId != null && (() => {
                        const deal = enrichedDeals.find(d => d.id === activeDragId);
                        return deal ? <DealCard deal={deal} onSelect={() => {}} isDragging /> : null;
                      })()}
                    </DragOverlay>
                  </DndContext>
                  <div className="hidden md:block absolute left-0 top-0 bottom-4 w-4 bg-gradient-to-r from-background to-transparent pointer-events-none" />
                  <div className="hidden md:block absolute right-0 top-0 bottom-4 w-4 bg-gradient-to-l from-background to-transparent pointer-events-none" />
                </div>
              )}
            </>
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

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={(open) => !open && setShowBulkDeleteConfirm(false)}
        title="Delete Selected Deals"
        description={`Delete ${plural(selectedDealIds.size, "deal")}? This cannot be undone.`}
        confirmLabel="Delete All"
        onConfirm={handleBulkDelete}
        isLoading={isBulkDeleting}
        variant="destructive"
      />

      <ConfirmDialog
        open={bulkStageDialogOpen}
        onOpenChange={setBulkStageDialogOpen}
        title="Update Deal Stages"
        description={`Move ${selectedDealIds.size} deal${selectedDealIds.size > 1 ? 's' : ''} to "${dealStages.find(s => s.value === bulkTargetStage)?.label || bulkTargetStage}"? You can undo this action.`}
        confirmLabel="Update Stages"
        onConfirm={handleBulkStageUpdate}
        isLoading={isBulkStageUpdating}
      />
    </PageShell>
  );
}

function KanbanColumn({
  stage,
  deals,
  isLoading,
  activeDragId,
  onSelect,
}: {
  stage: { value: string; label: string; color: string };
  deals: DealWithProperty[];
  isLoading: boolean;
  activeDragId: number | null;
  onSelect: (deal: DealWithProperty) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value });
  const headingId = `kanban-stage-${stage.value}`;
  return (
    <section className="w-72 flex-shrink-0" aria-labelledby={headingId}>
      <div className={`rounded-t-xl px-4 py-3 ${stage.color}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="font-medium text-sm">
            {stage.label}
          </h2>
          <Badge variant="secondary" className="font-mono" aria-label={`${deals.length} ${deals.length === 1 ? "deal" : "deals"} in ${stage.label}`}>
            {deals.length}
          </Badge>
        </div>
      </div>
      <div
        ref={setNodeRef}
        role="list"
        aria-label={`${stage.label} drop zone`}
        aria-describedby={headingId}
        className={`bg-muted/30 rounded-b-xl p-2 min-h-[400px] space-y-2 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/20 ring-inset" : ""}`}
        data-testid={`column-${stage.value}`}
      >
        {isLoading ? (
          <div data-testid={`skeleton-deals-${stage.value}`}>
            <ListSkeleton count={2} variant="compact" />
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm" role="status">
            No deals in {stage.label}
          </div>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onSelect={() => onSelect(deal)}
              isDragging={activeDragId === deal.id}
            />
          ))
        )}
      </div>
    </section>
  );
}

const nextActionIcons: Record<DealNextAction["icon"], React.ReactNode> = {
  send: <Send className="w-3 h-3" aria-hidden="true" />,
  eye: <Eye className="w-3 h-3" aria-hidden="true" />,
  phone: <Phone className="w-3 h-3" aria-hidden="true" />,
  file: <FileText className="w-3 h-3" aria-hidden="true" />,
  calendar: <Calendar className="w-3 h-3" aria-hidden="true" />,
  check: <CheckCircle className="w-3 h-3" aria-hidden="true" />,
  alert: <AlertTriangle className="w-3 h-3" aria-hidden="true" />,
};

/**
 * DealCard — refined to Rocket-Money grade.
 *
 * Hierarchy: location (title) → amount → stage badge → meta (days/action).
 * One primary CTA: tap the card to open the deal detail.
 * Secondary actions (Pax context, select) live in the overflow menu.
 * On mobile, wrapped in SwipeableCard:
 *   right-swipe → advance stage (pos tone)
 *   left-swipe  → snooze for 24h (warn tone)
 */
function DealCard({ deal, onSelect, isDragging = false, isSelected, onToggleSelect }: { deal: DealWithProperty; onSelect: () => void; isDragging?: boolean; isSelected?: boolean; onToggleSelect?: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: deal.id });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const isClosed = deal.status === 'closed' || deal.status === 'cancelled';
  const nextAction = getDealNextAction(deal);
  const daysInStage = getDaysInStage(deal);
  const urgency = getDealUrgency(deal);
  const isActiveStage = !isClosed;
  const { isMobile } = useIsMobile();
  const { mutate: advanceStage, isPending: isAdvancing } = useAdvanceDealStage();

  // Snooze: hide deal card for 24 h using localStorage (mirrors Decision Queue pattern)
  const snoozeKey = `deal-snooze-${deal.id}`;
  const [snoozed, setSnoozed] = useState(() => {
    const until = localStorage.getItem(snoozeKey);
    return until ? Date.now() < Number(until) : false;
  });

  const handleSnooze = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem(snoozeKey, String(until));
    setSnoozed(true);
  };

  if (snoozed) return null;

  const amountValue = deal.acceptedAmount || deal.offerAmount;

  const cardInner = (
    <Card
      ref={setNodeRef}
      style={style}
      className={`group floating-window cursor-pointer hover-elevate active:scale-[0.98] transition-transform touch-manipulation ${isDragging ? "opacity-40" : ""}`}
      onClick={onSelect}
      data-testid={`card-deal-${deal.id}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Drag handle — desktop only */}
          <button
            type="button"
            aria-label={
              deal.property
                ? `Drag ${deal.property.county}, ${deal.property.state} to change stage`
                : `Drag deal ${deal.id} to change stage`
            }
            className="mt-1 flex-shrink-0 hidden md:block cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            {...listeners}
            {...attributes}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Card body */}
          <div className="min-w-0 flex-1">
            {/* Row 1: type badge + overflow menu */}
            <div className="flex items-center justify-between gap-2">
              <Badge variant={deal.type === 'acquisition' ? 'default' : 'secondary'} className="text-xs">
                {deal.type === 'acquisition' ? 'Buy' : 'Sell'}
              </Badge>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {/* Checkbox for bulk selection */}
                {onToggleSelect && (
                  <label
                    className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] cursor-pointer"
                    aria-label={`Select ${deal.property ? `${deal.property.county}, ${deal.property.state}` : `Deal #${deal.id}`}`}
                  >
                    <Checkbox
                      checked={!!isSelected}
                      onCheckedChange={() => onToggleSelect(deal.id)}
                      className="h-4 w-4"
                      aria-label={`Select deal ${deal.id}`}
                    />
                  </label>
                )}
                {/* Pax context button — appears on hover */}
                <PaxContextButton
                  entityType="deal"
                  entityId={deal.id}
                  entityName={deal.property ? `${deal.property.county}, ${deal.property.state}` : `Deal #${deal.id}`}
                />
                {/* Overflow menu — secondary actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      // Touch-device escape: opacity-0 + group-hover hides
                      // this button on touch entirely (no hover event), so
                      // the overflow menu is unreachable on iOS/Android.
                      // [@media(hover:none)]:opacity-60 makes it visible
                      // (subdued) on touch — same pattern as the Pax
                      // delete-conversation button (contract test #4).
                      className="min-h-11 min-w-11 pointer-fine:sm:h-8 pointer-fine:sm:w-8 pointer-fine:sm:min-h-0 pointer-fine:sm:min-w-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity"
                      aria-label="More deal actions"
                    >
                      <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onSelect()}>
                      <Eye className="w-4 h-4 mr-2" aria-hidden="true" />
                      Open deal
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleSnooze}>
                      <Clock className="w-4 h-4 mr-2" aria-hidden="true" />
                      Snooze 24 h
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Row 2: location (primary title) */}
            <div className="mt-2">
              {deal.property ? (
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <p className="text-sm font-semibold leading-snug line-clamp-2">
                    {deal.property.county}, {deal.property.state}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Property #{deal.propertyId}</p>
              )}
              {deal.property?.sizeAcres && (
                <p className="text-xs text-muted-foreground mt-0.5 ml-5">{deal.property.sizeAcres} acres</p>
              )}
            </div>

            {/* Row 3: deal amount — big readable number */}
            {amountValue && (
              <div className="mt-2.5 flex items-baseline gap-1">
                <span className="text-lg font-semibold font-mono tabular-nums text-acr-pos leading-none">
                  {usd(amountValue, { noCents: true })}
                </span>
                {deal.acceptedAmount && deal.offerAmount && deal.acceptedAmount !== deal.offerAmount && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    offered {usd(deal.offerAmount, { noCents: true })}
                  </span>
                )}
              </div>
            )}

            {/* Row 4: stage badge + days in stage */}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[deal.status] || statusColors.negotiating}`}>
                {deal.status?.replace(/_/g, ' ')}
              </span>
              {isActiveStage && (
                <span
                  className={`text-xs tabular-nums font-medium ${
                    urgency === 'urgent' ? 'text-acr-neg' :
                    urgency === 'warning' ? 'text-acr-warn' :
                    'text-muted-foreground'
                  }`}
                  title={`${daysInStage} day${daysInStage !== 1 ? 's' : ''} in this stage`}
                >
                  {daysInStage}d in stage
                </span>
              )}
            </div>

            {/* Row 5: next action indicator */}
            {isActiveStage && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`next-action-${deal.id}`}>
                <ArrowRight className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                <span className="flex items-center gap-1">
                  {nextActionIcons[nextAction.icon]}
                  {nextAction.action}
                </span>
              </div>
            )}

            {/* Row 6: stage progression strip */}
            <div className="mt-3" data-testid={`journey-${deal.id}`}>
              <DealJourney status={deal.status as any} dense />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // On mobile, wrap in SwipeableCard for gesture actions.
  // On desktop, render the card directly (DnD handles repositioning).
  if (isMobile && isActiveStage) {
    return (
      <SwipeableCard
        leftAction={{
          icon: ChevronsRight,
          label: "Advance",
          tone: "pos",
          onAction: () => advanceStage(deal.id),
        }}
        rightAction={{
          icon: Archive,
          label: "Snooze",
          tone: "warn",
          onAction: handleSnooze,
        }}
        disabled={isAdvancing}
      >
        {cardInner}
      </SwipeableCard>
    );
  }

  return cardInner;
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


function DealForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateDeal();
  const { data: properties, isLoading: propertiesLoading } = useProperties();

  const form = useForm<z.infer<typeof dealFormSchema>, unknown, z.infer<typeof dealFormSchema>>({
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
                <FormLabel>
                  Deal type <span className="text-destructive" aria-hidden="true">*</span>
                </FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "acquisition"}>
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]" data-testid="select-deal-type" aria-label="Deal type">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="acquisition">Acquisition (buying)</SelectItem>
                    <SelectItem value="disposition">Disposition (selling)</SelectItem>
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
                <FormLabel>
                  Property <span className="text-destructive" aria-hidden="true">*</span>
                </FormLabel>
                <Select
                  onValueChange={(val) => field.onChange(parseInt(val, 10))}
                  value={field.value ? field.value.toString() : undefined}
                  disabled={propertiesLoading}
                >
                  <FormControl>
                    <SelectTrigger className="min-h-[44px]" data-testid="select-deal-property" aria-label="Property">
                      <SelectValue placeholder={propertiesLoading ? "Loading properties…" : "Select property"} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {properties && properties.length > 0 ? (
                      properties.map((prop: any) => (
                        <SelectItem key={prop.id} value={prop.id.toString()}>
                          {prop.county}, {prop.state} ({prop.sizeAcres} ac)
                        </SelectItem>
                      ))
                    ) : (
                      <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                        {propertiesLoading ? "Loading properties…" : "Add a parcel first — Pax pulls comps inside 90 seconds."}
                      </div>
                    )}
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
                <FormLabel>Offer amount</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                      aria-hidden="true"
                    >
                      $
                    </span>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="5,000"
                      className="min-h-[44px] pl-7 text-right tabular-nums"
                      data-testid="input-offer-amount"
                    />
                  </div>
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
                <FormLabel>Offer date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    className="min-h-[44px]"
                    value={field.value instanceof Date && !isNaN(field.value.getTime()) ? format(field.value, 'yyyy-MM-dd') : ''}
                    onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : undefined)}
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
            name="closingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target closing</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    className="min-h-[44px]"
                    value={field.value instanceof Date && !isNaN(field.value.getTime()) ? format(field.value, 'yyyy-MM-dd') : ''}
                    onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : undefined)}
                    data-testid="input-closing-date"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="titleCompany"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title company</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ""}
                    placeholder="ABC Title Co"
                    autoCapitalize="words"
                    className="min-h-[44px]"
                    data-testid="input-title-company"
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
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Creating…
              </>
            ) : (
              "Create deal"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
