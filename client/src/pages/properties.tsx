import { PageShell } from "@/components/page-shell";
import { useTerm } from "@/hooks/use-persona";
import { usd, plural, formatDate, formatDateTime } from "@/lib/format";
import { clientLogger } from "@/lib/clientLogger";
import "./today.css";
import { PaxContextButton } from "@/components/pax-context-button";
import { ListPagination, usePagination } from "@/components/list-pagination";
import { useProperties, usePropertiesPaginated, useCreateProperty, useDeleteProperty, useEnrichProperty } from "@/hooks/use-properties";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { queryClient } from "@/lib/queryClient";
import { telemetry } from "@/lib/telemetry";
import { ListSkeleton } from "@/components/list-skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { ContentReveal } from "@/components/ContentReveal";
import { useFetchPropertyParcel, useFetchAllParcels } from "@/hooks/use-parcels";
import { useState, useMemo, useEffect } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPropertySchema, type Property } from "@shared/schema";
import { z } from "zod";

// APN validation pattern - supports common formats like 123-456-789, 123-45-678-901, 12345678
const apnPattern = /^[\d]+([-][\d]+)*$/;

// Helper to compute centroid from GeoJSON polygon boundary
function computeCentroidFromBoundary(boundary: { type: string; coordinates: number[][][] | number[][][][] } | null): { lat: number; lng: number } | null {
  if (!boundary) return null;
  
  try {
    let coords: number[][] = [];
    
    if (boundary.type === "Polygon") {
      // Polygon: coordinates is number[][][]
      coords = (boundary.coordinates as number[][][])[0] || [];
    } else if (boundary.type === "MultiPolygon") {
      // MultiPolygon: coordinates is number[][][][], take first polygon's first ring
      coords = ((boundary.coordinates as number[][][][])[0] || [])[0] || [];
    }
    
    if (coords.length === 0) return null;
    
    // Compute average of all points
    let sumLng = 0, sumLat = 0;
    for (const coord of coords) {
      sumLng += coord[0];
      sumLat += coord[1];
    }
    
    return {
      lng: sumLng / coords.length,
      lat: sumLat / coords.length
    };
  } catch (e) {
    clientLogger.error("Failed to compute centroid from boundary:", e);
    return null;
  }
}

// Client-side form schema with enhanced validation
const propertyFormSchema = insertPropertySchema.extend({
  apn: z.string()
    .min(1, "APN (Assessor Parcel Number) is required")
    .refine(
      (val) => apnPattern.test(val.replace(/\s/g, '')),
      { message: "Please enter a valid APN format (e.g., 123-456-789 or 12345678)" }
    ),
  county: z.string().min(1, "County is required"),
  state: z.string()
    .min(1, "State is required")
    .max(2, "Please use 2-letter state code (e.g., CA, TX)")
    .refine(
      (val) => /^[A-Za-z]{2}$/.test(val),
      { message: "Please enter a valid 2-letter state code (e.g., CA, TX)" }
    ),
  sizeAcres: z.string()
    .min(1, "Acreage is required")
    .refine(
      (val) => !isNaN(Number(val)) && Number(val) > 0,
      { message: "Please enter a valid acreage (e.g., 5.0)" }
    ),
  purchasePrice: z.string()
    .optional()
    .refine(
      (val) => !val || (!isNaN(Number(val)) && Number(val) >= 0),
      { message: "Please enter a valid purchase price" }
    ),
  marketValue: z.string()
    .optional()
    .refine(
      (val) => !val || (!isNaN(Number(val)) && Number(val) >= 0),
      { message: "Please enter a valid market value" }
    ),
  status: z.string().min(1, "Status is required"),
});
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Ruler, DollarSign, Trash2, Loader2, Map as MapIcon, RefreshCw, FileText, Download, Upload, CheckCircle, AlertCircle, AlertTriangle, ClipboardCheck, Calculator, BarChart2, X, CheckSquare, Droplets, Leaf, Building2, Flame, Users, Brain, Shield, Zap, Mountain, TreePine, Car, TrendingUp, Thermometer, Cloud, Waves, Wheat, Factory, Grid3x3, Target, ThumbsUp, ThumbsDown, List as ListIcon, Filter as FilterIcon, ChevronDown, ChevronUp } from "lucide-react";
import { LandCreditBadge } from "@/components/land-credit-badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { DealCalculator } from "@/components/deal-calculator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FirstHelloEmpty, EmptyFilter } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PropertyMap, SinglePropertyMap, StaticPropertyMap } from "@/components/property-map-lazy";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { CompsAnalysis } from "@/components/comps-analysis";
import { AIOfferGenerator } from "@/components/ai-offer-generator";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DueDiligencePanel } from "@/components/due-diligence-panel";
import { PropertyAnalysisChat } from "@/components/property-analysis-chat";
import { GisFilters, type GisFilterState, defaultGisFilters, countActiveGisFilters, applyGisFiltersToProperty } from "@/components/gis-filters";
import { SavedViewsSelector } from "@/components/saved-views-selector";
import type { SavedView } from "@shared/schema";
import { QueryErrorState } from "@/components/query-error-state";
import { ResearchSummaryPanel } from "@/components/research-summary-panel";
import { DataProvenanceTag } from "@/components/data-provenance-tag";
import { usePersistedGisFilters } from "@/hooks/use-persisted-gis-filters";
import { Bot } from "lucide-react";

// `embedded` — mounted inside the /pipeline door's Properties tab
// (pipeline.tsx), which already renders the app shell. See
// PageShellProps.embedded (T0-9).
export default function PropertiesPage({ embedded = false }: { embedded?: boolean }) {
  // Parent page (pipeline.tsx) owns the H1 when embedded.
  const HeadingTag = embedded ? ("h2" as const) : ("h1" as const);
  const propertyLabelPlural = useTerm("entity.property.plural");
  const propertyLabel = useTerm("entity.property");
  useDocumentTitle(propertyLabelPlural);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const propertiesQuery = usePropertiesPaginated({ page: currentPage, pageSize });
  const propertiesResponse = propertiesQuery.data;
  const properties = propertiesResponse?.data;
  const serverTotal = propertiesResponse?.total ?? 0;
  const { isLoading, error, isRefetching } = propertiesQuery;
  const refetch = propertiesQuery.refetch;
  const delayedLoading = useDelayedLoading(isLoading, 200);
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const urlParams = new URLSearchParams(searchString);
  const actionFromUrl = urlParams.get("action");

  // r6 Tasha mobile capture: /maps can hand off a lat/lng via query
  // params after the user taps "Use my location." If these are present
  // we auto-open Add Property with the coords pre-populated.
  const addAtLat = urlParams.get("addAtLat");
  const addAtLng = urlParams.get("addAtLng");
  const addCounty = urlParams.get("addCounty") || "";
  const addState = urlParams.get("addState") || "";
  const addFromLocation = !!(addAtLat && addAtLng);

  const [viewMode, setViewMode] = useState<"list" | "map">(() => {
    try { return (localStorage.getItem("properties-view-mode") as "list" | "map") || "list"; } catch { return "list"; }
  });

  // W2-6: remember the inventory list's window-scroll offset per route.
  // Only meaningful in list mode — in map mode the rows don't exist, so a
  // restore would clamp against the short map layout; gating `ready` on
  // viewMode means a map-mode mount simply skips restoration. Disabled when
  // embedded in /pipeline (several list pages share one route's scroll).
  useScrollRestoration(!isLoading && viewMode === "list", { enabled: !embedded });
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new" || addFromLocation);
  const [deletingProperty, setDeletingProperty] = useState<Property | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{
    totalRows: number;
    headers: string[];
    preview: Record<string, string>[];
    expectedColumns: string[];
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    successCount: number;
    errorCount: number;
    errors: Array<{ row: number; data: Record<string, string>; error: string }>;
  } | null>(null);
  const { mutate: deleteProperty, isPending: isDeleting } = useDeleteProperty();
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<number>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const { filters: gisFilters, setFilters: setGisFilters, resetFilters: resetGisFilters, getShareableUrl } = usePersistedGisFilters();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [distressFilter, setDistressFilter] = useState<string>("any");
  const { toast } = useToast();
  const { mutate: fetchAllParcels, isPending: isFetchingAllParcels } = useFetchAllParcels();

  useEffect(() => {
    try {
      localStorage.setItem("properties:gisFilters", JSON.stringify(gisFilters));
    } catch {}
  }, [gisFilters]);

  const filteredProperties = useMemo(() => {
    if (!properties) return [];

    let result = properties;

    if (statusFilter !== "all") {
      result = result.filter(p => p.status === statusFilter);
    }

    if (distressFilter !== "any") {
      result = result.filter(p => {
        const enrichment = p.enrichmentData as any;
        const score = enrichment?.scores?.overallScore ?? enrichment?.scores?.investmentScore;
        if (score == null) return distressFilter === "none";
        if (distressFilter === "high") return score >= 70;
        if (distressFilter === "medium") return score >= 40 && score < 70;
        if (distressFilter === "low") return score < 40;
        return true;
      });
    }

    const hasActiveGisFilters = gisFilters.excludeFloodZones ||
      gisFilters.nearInfrastructure ||
      gisFilters.lowHazardRiskOnly ||
      gisFilters.minimumInvestmentScore > 0;

    if (hasActiveGisFilters) {
      result = result.filter(property =>
        applyGisFiltersToProperty(property, property.dueDiligenceData as Record<string, any> | null, gisFilters)
      );
    }

    return result;
  }, [properties, gisFilters, statusFilter, distressFilter]);

  // Server-side pagination: data is already one page
  const paginatedProperties = filteredProperties;
  const totalPropertyItems = serverTotal;
  const safePropertyPage = currentPage;

  const handlePropertyPageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePropertyPageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && filteredProperties.length > 0) {
      setSelectedPropertyIds(new Set(filteredProperties.map(p => p.id)));
    } else {
      setSelectedPropertyIds(new Set());
    }
  };

  const handleSelectProperty = (propertyId: number, checked: boolean) => {
    const newSet = new Set(selectedPropertyIds);
    if (checked) {
      newSet.add(propertyId);
    } else {
      newSet.delete(propertyId);
    }
    setSelectedPropertyIds(newSet);
  };

  const handleBulkDelete = async () => {
    if (selectedPropertyIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await apiRequest("POST", "/api/properties/bulk-delete", { ids: Array.from(selectedPropertyIds) });
      if (!res.ok) throw new Error("Failed to delete properties");
      const result = await res.json();
      toast({ title: "Properties deleted", description: `Removed ${result.deletedCount} propert${result.deletedCount === 1 ? "y" : "ies"} from your inventory.` });
      setSelectedPropertyIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    } catch (error: any) {
      toast({ title: "Couldn't delete properties", description: `${error.message || "No properties were deleted"} — your inventory is unchanged.`, variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  const handleBulkStatusChange = async (status: string) => {
    if (selectedPropertyIds.size === 0) return;
    setIsBulkUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/properties/bulk-update", { ids: Array.from(selectedPropertyIds), updates: { status } });
      if (!res.ok) throw new Error("Failed to update properties");
      const result = await res.json();
      toast({ title: "Status updated", description: `Updated ${result.updatedCount} propert${result.updatedCount === 1 ? "y" : "ies"} to "${status}".` });
      setSelectedPropertyIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    } catch (error: any) {
      toast({ title: "Couldn't update properties", description: `${error.message || "No properties were updated"} — their statuses are unchanged.`, variant: "destructive" });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkExportProperties = () => {
    if (selectedPropertyIds.size === 0) return;
    const selectedProps = properties?.filter(p => selectedPropertyIds.has(p.id)) || [];
    const headers = ["apn", "county", "state", "sizeAcres", "status", "purchasePrice", "marketValue"];
    const csvRows = [headers.join(",")];
    selectedProps.forEach(prop => {
      csvRows.push([prop.apn, prop.county, prop.state, prop.sizeAcres || "", prop.status, prop.purchasePrice || "", prop.marketValue || ""].map(v => `"${v || ""}"`).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `properties-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/properties/export', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to export');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'properties.csv';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "Export ready", description: `Downloaded ${filename}.` });
    } catch (error: any) {
      toast({
        title: "Couldn't export properties",
        description: `${error?.message || "We couldn't build your CSV"} — your property records are unchanged.`,
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setIsLoadingPreview(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/properties/import/preview', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to parse CSV');
      }
      
      const preview = await response.json();
      setImportPreview(preview);
    } catch (error: any) {
      setImportPreview(null);
      toast({
        title: "Couldn't read that CSV",
        description: error?.message || "The file couldn't be parsed. Check the column headers and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      
      const response = await fetch('/api/properties/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to import');
      }
      
      const result = await response.json();
      setImportResult(result);
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
    } catch (error: any) {
      toast({
        title: "Couldn't import properties",
        description: `${error?.message || "We couldn't import this file"} — your existing properties are unchanged.`,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const resetImportDialog = () => {
    setIsImportOpen(false);
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
  };

  const handleDelete = () => {
    if (deletingProperty) {
      deleteProperty(deletingProperty.id, {
        onSuccess: () => {
          toast({ title: "Property deleted", description: "It has been removed from your inventory." });
          setDeletingProperty(null);
        },
        onError: (error: Error) => {
          toast({
            title: "Couldn't delete property",
            description: `${error.message || "No changes were made"} — the property is still in your inventory.`,
            variant: "destructive",
          });
          setDeletingProperty(null);
        },
      });
    }
  };

  return (
    <PageShell label={propertyLabelPlural} embedded={embedded}>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="acr-cc-hero" style={{ marginTop: 0 }}>
              <div>
                <div className="acr-eyebrow">Inventory</div>
                <HeadingTag className="acr-cc-greeting" data-testid="text-page-title">
                  {properties && properties.length > 0 ? (
                    <>
                      {plural(properties.length, "parcel")}
                      <span className="acr-cc-greeting-soft">
                        {" "}across your portfolio.
                      </span>
                    </>
                  ) : (
                    <>
                      No parcels yet.
                      <span className="acr-cc-greeting-soft">
                        {" "}Add one to start tracking.
                      </span>
                    </>
                  )}
                </HeadingTag>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* List / Map view toggle */}
              <div className="flex items-center rounded-card border overflow-hidden" role="group" aria-label="View mode">
                <button
                  onClick={() => { setViewMode("list"); try { localStorage.setItem("properties-view-mode", "list"); } catch {} }}
                  className={`min-h-[44px] pointer-fine:md:min-h-9 px-3 text-sm font-medium transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  aria-pressed={viewMode === "list"}
                  data-testid="button-view-list"
                >
                  <ListIcon className="w-4 h-4" /> List
                </button>
                <button
                  onClick={() => { setViewMode("map"); try { localStorage.setItem("properties-view-mode", "map"); } catch {} }}
                  className={`min-h-[44px] pointer-fine:md:min-h-9 px-3 text-sm font-medium transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${viewMode === "map" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  aria-pressed={viewMode === "map"}
                  data-testid="button-view-map"
                >
                  <MapPin className="w-4 h-4" /> Map
                </button>
              </div>
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                className="min-h-[44px] pointer-fine:md:min-h-9"
                data-testid="button-export-properties"
              >
                {isExporting ? <Loader2 className="w-4 h-4 md:mr-2 animate-spin" /> : <Download className="w-4 h-4 md:mr-2" />}
                <span className="hidden md:inline">Export CSV</span>
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsImportOpen(true)}
                className="min-h-[44px] pointer-fine:md:min-h-9"
                data-testid="button-import-properties"
              >
                <Upload className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Import CSV</span>
              </Button>
              <Button 
                variant="outline" 
                onClick={() => fetchAllParcels()}
                disabled={isFetchingAllParcels}
                className="min-h-[44px] pointer-fine:md:min-h-9"
                data-testid="button-fetch-all-parcels"
              >
                {isFetchingAllParcels ? <Loader2 className="w-4 h-4 md:mr-2 animate-spin" /> : <MapIcon className="w-4 h-4 md:mr-2" />}
                <span className="hidden md:inline">{isFetchingAllParcels ? "Fetching..." : "Fetch Boundaries"}</span>
              </Button>
              <ResponsiveModal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <ResponsiveModalTrigger asChild>
                  <Button className="shadow-lg hover:shadow-primary/25 min-h-[44px] pointer-fine:md:min-h-9" data-testid="button-add-property">
                    <Plus className="w-4 h-4 mr-2" /> Add {propertyLabel}
                  </Button>
                </ResponsiveModalTrigger>
                <ResponsiveModalContent className="sm:max-w-[500px]">
                  <ResponsiveModalHeader>
                    <ResponsiveModalTitle>Add New Property</ResponsiveModalTitle>
                    <ResponsiveModalDescription>
                      Enter the property details including APN, location, and acreage.
                    </ResponsiveModalDescription>
                  </ResponsiveModalHeader>
                  <PropertyForm
                    onSuccess={() => setIsCreateOpen(false)}
                    prefill={addFromLocation ? {
                      county: addCounty,
                      state: addState,
                      latitude: addAtLat || undefined,
                      longitude: addAtLng || undefined,
                    } : undefined}
                  />
                </ResponsiveModalContent>
              </ResponsiveModal>
            </div>
          </div>

          {selectedPropertyIds.size > 0 && (
            <div className="p-3 bg-muted/50 border rounded-md space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3" data-testid="bulk-actions-toolbar-properties">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4" />
                <span className="text-sm font-medium" data-testid="text-selected-properties-count">{selectedPropertyIds.size} propert{selectedPropertyIds.size !== 1 ? "ies" : "y"} selected</span>
                <Button variant="ghost" size="icon" className="md:hidden min-h-[44px] min-w-[44px] ml-auto" onClick={() => setSelectedPropertyIds(new Set())} aria-label="Clear selection" data-testid="button-clear-selection-properties-mobile">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-2 md:ml-auto">
                <Button variant="outline" className="min-h-[44px] pointer-fine:md:min-h-8" onClick={handleBulkExportProperties} data-testid="button-bulk-export-properties">
                  <Download className="w-4 h-4 mr-1" /> Export
                </Button>
                {selectedPropertyIds.size >= 2 && (
                  <Button
                    variant="outline"
                    className="min-h-[44px] pointer-fine:md:min-h-8"
                    onClick={() => {
                      const ids = Array.from(selectedPropertyIds).slice(0, 4);
                      navigate(`/properties/compare?ids=${ids.join(",")}`);
                    }}
                    data-testid="button-bulk-compare-properties"
                  >
                    <Grid3x3 className="w-4 h-4 mr-1" aria-hidden="true" /> Compare
                  </Button>
                )}
                <Select onValueChange={handleBulkStatusChange} disabled={isBulkUpdating}>
                  <SelectTrigger className="min-h-[44px] pointer-fine:md:min-h-8 w-full md:w-[150px]" aria-label="Change status for selected properties" data-testid="select-bulk-status-properties">
                    <SelectValue placeholder={isBulkUpdating ? "Updating..." : "Status"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="under_contract">Under Contract</SelectItem>
                    <SelectItem value="due_diligence">Due Diligence</SelectItem>
                    <SelectItem value="closing">Closing</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                    <SelectItem value="listed">Listed</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="destructive" className="min-h-[44px] pointer-fine:md:min-h-8 col-span-2 md:col-span-1" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting} data-testid="button-bulk-delete-properties">
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
                <Button aria-label="Clear selection" variant="ghost" size="sm" className="hidden md:flex" onClick={() => setSelectedPropertyIds(new Set())} data-testid="button-clear-selection-properties">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {!delayedLoading && properties && properties.length > 0 && (
            <div className="space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3 p-2 bg-muted/30 rounded-md">
              <div className="flex items-center justify-between gap-2 md:justify-start">
                <div className="flex items-center gap-2 min-h-[44px] md:min-h-0">
                  <Checkbox
                    checked={filteredProperties.length > 0 && selectedPropertyIds.size === filteredProperties.length}
                    onCheckedChange={(checked) => handleSelectAll(checked === true)}
                    className="h-5 w-5 md:h-4 md:w-4"
                    aria-label="Select all properties"
                    data-testid="checkbox-select-all-properties"
                  />
                  <span className="text-sm text-muted-foreground">Select All</span>
                </div>
                {filteredProperties.length !== properties.length && (
                  <span className="text-xs md:hidden text-muted-foreground" data-testid="text-filtered-count-mobile">
                    {filteredProperties.length}/{properties.length}
                  </span>
                )}
              </div>
              <SavedViewsSelector
                entityType="property"
                currentFilters={{ status: statusFilter }}
                onApplyView={(view: SavedView) => {
                  if (view.filters && Array.isArray(view.filters)) {
                    const statusDef = view.filters.find((f: any) => f.field === "status");
                    setStatusFilter(statusDef ? String(statusDef.value) : "all");
                  } else {
                    setStatusFilter("all");
                  }
                }}
              />
              <GisFilters
                filters={gisFilters}
                onChange={setGisFilters}
                activeFilterCount={countActiveGisFilters(gisFilters)}
                onShare={getShareableUrl}
                onReset={resetGisFilters}
              />
              <Select value={distressFilter} onValueChange={setDistressFilter}>
                <SelectTrigger className="h-8 w-[160px]" aria-label="Filter by distress score" data-testid="select-distress-filter">
                  <SelectValue placeholder="Distress Score" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Distress: Any</SelectItem>
                  <SelectItem value="high">High (70+)</SelectItem>
                  <SelectItem value="medium">Medium (40–69)</SelectItem>
                  <SelectItem value="low">Low (&lt;40)</SelectItem>
                  <SelectItem value="none">No Score</SelectItem>
                </SelectContent>
              </Select>
              {filteredProperties.length !== properties.length && (
                <span className="hidden md:inline text-sm text-muted-foreground" data-testid="text-filtered-count">
                  Showing {filteredProperties.length} of {properties.length} properties
                </span>
              )}
            </div>
          )}

          {viewMode === "map" && !isLoading && (
            <div className="rounded-xl overflow-hidden border" style={{ height: "600px" }}>
              <PropertyMap
                properties={filteredProperties.filter(p => p.latitude && p.longitude).map(p => {
                  const lat = parseFloat(String(p.latitude));
                  const lng = parseFloat(String(p.longitude));
                  const d = 0.003;
                  return {
                    id: p.id,
                    apn: p.apn,
                    name: p.address || `${p.county}, ${p.state}`,
                    boundary: (p.parcelBoundary as any) || { type: "Polygon" as const, coordinates: [[[lng-d, lat-d],[lng+d, lat-d],[lng+d, lat+d],[lng-d, lat+d],[lng-d, lat-d]]] },
                    centroid: (p.parcelCentroid as any) || { lat, lng },
                    status: p.status || "default",
                  };
                })}
                height="600px"
                showLabels={(filteredProperties?.length ?? 0) < 50}
                interactive
                showControls
              />
            </div>
          )}

          {(viewMode === "list" || isLoading) && (
            <ContentReveal
              ready={!isLoading}
              skeleton={
                <div data-testid="skeleton-properties-grid">
                  <ListSkeleton count={6} variant="card" />
                </div>
              }
            >
              {error ? (
                <QueryErrorState
                  error={error}
                  onRetry={() => refetch()}
                  isRetrying={isRefetching}
                  title="Unable to load properties"
                  description="We couldn't fetch your property inventory. This might be a temporary issue."
                  testId="query-error-state-properties"
                />
              ) : (
                <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {paginatedProperties.map((property) => (
                <div key={property.id} className="relative">
                  <div className="absolute top-3 left-3 z-10">
                    <Checkbox
                      checked={selectedPropertyIds.has(property.id)}
                      onCheckedChange={(checked) => handleSelectProperty(property.id, checked === true)}
                      aria-label={`Select property ${property.county}, ${property.state}`}
                      data-testid={`checkbox-property-${property.id}`}
                      className="bg-background/80"
                    />
                  </div>
                  <PropertyCard
                    property={property}
                    onDelete={() => setDeletingProperty(property)}
                  />
                </div>
              ))}
              {filteredProperties.length === 0 && properties && properties.length > 0 && (
                <div className="col-span-full">
                  <EmptyFilter
                    filterCount={
                      (statusFilter !== "all" ? 1 : 0) +
                      (distressFilter !== "any" ? 1 : 0) +
                      countActiveGisFilters(gisFilters)
                    }
                    onClearFilters={() => {
                      resetGisFilters();
                      setStatusFilter("all");
                      setDistressFilter("any");
                    }}
                  />
                </div>
              )}
              {properties?.length === 0 && (
                <div className="col-span-full">
                  <FirstHelloEmpty
                    surface="properties"
                    cta={{
                      primary: { label: "Add a property", onClick: () => setIsCreateOpen(true) },
                      secondary: { label: "Import from CSV", onClick: () => setIsImportOpen(true) },
                    }}
                  />
                </div>
              )}
            </div>
            {serverTotal > pageSize && (
              <ListPagination
                currentPage={safePropertyPage}
                totalItems={totalPropertyItems}
                pageSize={pageSize}
                onPageChange={handlePropertyPageChange}
                onPageSizeChange={handlePropertyPageSizeChange}
              />
            )}
            </>
              )}
            </ContentReveal>
          )}


      <ConfirmDialog
        open={!!deletingProperty}
        onOpenChange={(open) => !open && setDeletingProperty(null)}
        title="Delete Property"
        description={`Are you sure you want to delete this property in ${deletingProperty?.county}, ${deletingProperty?.state} (APN: ${deletingProperty?.apn})? This action cannot be undone and will permanently remove the property from your inventory.`}
        confirmLabel="Delete Property"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={(open) => !open && setShowBulkDeleteConfirm(false)}
        title="Delete Selected Properties"
        description={`Are you sure you want to delete ${selectedPropertyIds.size} propert${selectedPropertyIds.size !== 1 ? "ies" : "y"}? This action cannot be undone and will permanently remove them from your inventory.`}
        confirmLabel={`Delete ${selectedPropertyIds.size} Propert${selectedPropertyIds.size !== 1 ? "ies" : "y"}`}
        onConfirm={handleBulkDelete}
        isLoading={isBulkDeleting}
        variant="destructive"
      />

      <ResponsiveModal open={isImportOpen} onOpenChange={(open) => !open && resetImportDialog()}>
        <ResponsiveModalContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Import Properties from CSV</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Upload a CSV file to bulk import properties. Required columns: apn, county, state, sizeAcres
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          
          {!importPreview && !importResult && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed rounded-card p-8 text-center">
                <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
                <label className="cursor-pointer block min-h-11 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 rounded">
                  <span className="text-sm text-muted-foreground">
                    {isLoadingPreview ? "Processing…" : "Click to select or drag a CSV file here"}
                  </span>
                  <Input
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={handleFileSelect}
                    disabled={isLoadingPreview}
                    aria-label="Select CSV file to import"
                    data-testid="input-import-property-file"
                  />
                </label>
                <p className="text-xs text-muted-foreground mt-2">Max file size: 5 MB.</p>
              </div>
              <div className="bg-muted/50 rounded-card p-4">
                <p className="text-sm font-medium mb-2">Expected columns:</p>
                <p className="text-xs text-muted-foreground">
                  apn, county, state, sizeAcres, address, city, zip, subdivision, lotNumber, zoning, terrain, roadAccess, status, assessedValue, marketValue, description, latitude, longitude
                </p>
              </div>
            </div>
          )}

          {importPreview && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-acr-pos" />
                <span>Found {importPreview.totalRows} rows to import</span>
              </div>
              
              <div className="border rounded-card overflow-hidden">
                <div className="bg-muted/50 p-2 text-sm font-medium">
                  Preview (first 5 rows)
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {importPreview.headers.slice(0, 5).map((header) => (
                          <TableHead key={header} className="text-xs whitespace-nowrap">
                            {header}
                          </TableHead>
                        ))}
                        {importPreview.headers.length > 5 && (
                          <TableHead className="text-xs">+{importPreview.headers.length - 5} more</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.preview.map((row, idx) => (
                        <TableRow key={idx}>
                          {importPreview.headers.slice(0, 5).map((header) => (
                            <TableCell key={header} className="text-xs max-w-[150px] truncate">
                              {row[header] || "-"}
                            </TableCell>
                          ))}
                          {importPreview.headers.length > 5 && (
                            <TableCell className="text-xs text-muted-foreground">...</TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {importResult && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-muted/50 rounded-card p-4">
                  <p className="text-2xl font-bold">{importResult.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div className="bg-acr-pos-soft dark:bg-acr-pos-soft rounded-card p-4">
                  <p className="text-2xl font-bold text-acr-pos dark:text-acr-pos">{importResult.successCount}</p>
                  <p className="text-xs text-acr-pos dark:text-acr-pos">Imported</p>
                </div>
                <div className="bg-acr-neg-soft dark:bg-acr-neg-soft rounded-card p-4">
                  <p className="text-2xl font-bold text-acr-neg dark:text-acr-neg">{importResult.errorCount}</p>
                  <p className="text-xs text-acr-neg dark:text-acr-neg">Failed</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="border border-acr-neg/30 dark:border-acr-neg/30 rounded-card overflow-hidden">
                  <div className="bg-acr-neg-soft dark:bg-acr-neg-soft p-2 text-sm font-medium text-acr-neg dark:text-acr-neg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Errors ({importResult.errors.length})
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="p-2 border-b last:border-0 text-xs">
                        <span className="font-medium">Row {err.row}:</span>{" "}
                        <span className="text-acr-neg dark:text-acr-neg">{err.error}</span>
                      </div>
                    ))}
                    {importResult.errors.length > 10 && (
                      <div className="p-2 text-xs text-muted-foreground">
                        ...and {importResult.errors.length - 10} more errors
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <ResponsiveModalFooter>
            {!importResult ? (
              <>
                <Button variant="outline" onClick={resetImportDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!importPreview || isImporting}
                  data-testid="button-confirm-import-properties"
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" /> Import {importPreview?.totalRows || 0} Properties</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={resetImportDialog} data-testid="button-close-import-properties">
                Done
              </Button>
            )}
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </PageShell>
  );
}

function PropertyCard({ property, onDelete }: {
  property: Property;
  onDelete: () => void;
}) {
  const { mutate: fetchParcel, isPending: isFetchingParcel } = useFetchPropertyParcel();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const { toast } = useToast();

  // Compute centroid from boundary if not present
  const effectiveCentroid = property.parcelCentroid || computeCentroidFromBoundary(property.parcelBoundary as { type: string; coordinates: number[][][] | number[][][][] } | null);
  const hasMapData = property.parcelBoundary && effectiveCentroid;

  const handleDownloadDeed = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDownloading(true);
    try {
      const response = await fetch(`/api/properties/${property.id}/deed`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to generate PDF');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warranty-deed-${property.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      toast({
        title: "Couldn't download deed",
        description: error?.message || "The PDF didn't generate. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card className="card-hover border-border/50 group" data-testid={`card-property-${property.id}`}>
      <div className="h-44 sm:h-40 bg-muted relative overflow-hidden">
        {hasMapData ? (
          <StaticPropertyMap
            boundary={property.parcelBoundary as { type: string; coordinates: number[][][] }}
            centroid={effectiveCentroid}
            height="176px"
            width={400}
            onClick={() => setIsDetailOpen(true)}
          />
        ) : property.apn?.startsWith("ONBOARD-SAMPLE") ? (
          // Sample / onboarding placeholder — no real parcel exists in any
          // provider, so "Fetch Map" would just 404. Show a friendly state
          // instead of a button that's guaranteed to fail.
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-4">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                Sample property — add a real APN or address to load the parcel map.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" aria-hidden="true" />
              <Button
                variant="outline"
                className="min-h-[44px] pointer-fine:sm:min-h-8"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchParcel(property.id);
                }}
                disabled={isFetchingParcel}
                data-testid={`button-fetch-parcel-${property.id}`}
              >
                {isFetchingParcel ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" aria-hidden="true" /> Fetching...</>
                ) : (
                  <><MapIcon className="w-4 h-4 mr-1" aria-hidden="true" /> Fetch Map</>
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 z-10 items-center">
          <LandCreditBadge propertyId={property.id} size="sm" />
          <Badge variant={property.status === 'available' ? 'default' : 'secondary'} className="capitalize shadow-sm text-xs">
            {property.status.replace(/_/g, ' ')}
          </Badge>
        </div>
        <div className="absolute top-2 left-2 flex gap-1 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <Button
            variant="destructive"
            size="icon"
            className="h-11 w-11 pointer-fine:sm:h-7 pointer-fine:sm:w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete property ${property.county}, ${property.state}`}
            data-testid={`button-delete-property-${property.id}`}
          >
            <Trash2 className="w-4 h-4 sm:w-3 sm:h-3" aria-hidden="true" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11 pointer-fine:sm:h-7 pointer-fine:sm:w-7"
            onClick={handleDownloadDeed}
            disabled={isDownloading}
            aria-label="Download deed"
            data-testid={`button-download-deed-${property.id}`}
          >
            {isDownloading
              ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" aria-hidden="true" />
              : <FileText className="w-4 h-4 sm:w-3 sm:h-3" aria-hidden="true" />}
          </Button>
          {hasMapData && (
            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 pointer-fine:sm:h-7 pointer-fine:sm:w-7"
              onClick={(e) => {
                e.stopPropagation();
                fetchParcel(property.id);
              }}
              disabled={isFetchingParcel}
              aria-label="Refresh parcel data"
              data-testid={`button-refresh-parcel-${property.id}`}
            >
              <RefreshCw
                className={`w-4 h-4 sm:w-3 sm:h-3 ${isFetchingParcel ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </Button>
          )}
        </div>
      </div>
      <CardContent className="p-4">
        <div className="mb-3">
          <div className="flex items-center gap-1.5">
            <h3 className="font-bold text-base truncate">{property.county}, {property.state}</h3>
            <PaxContextButton
              entityType="property"
              entityId={property.id}
              entityName={`${property.county}, ${property.state}`}
            />
          </div>
          <p className="text-xs text-muted-foreground font-mono">APN: {property.apn}</p>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{property.sizeAcres} Acres</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
            {/* r5 Eleanor: "$0" on a property card reads ambiguously
                (free? missing? broken?) for a low-tech-comfort persona.
                Show "—" when the value is unset, actual dollars when known. */}
            <span className="tabular-nums">
              {property.marketValue && Number(property.marketValue) > 0
                ? usd(property.marketValue, { noCents: true })
                : <span title="No market value on file yet">—</span>}
            </span>
          </div>
          {Number(property.marketValue) > 0 && Number(property.sizeAcres) > 0 && (
            <div className="flex items-center gap-1.5 col-span-2 pt-1 border-t border-border/50">
              <TrendingUp className="w-3.5 h-3.5 text-acr-pos" aria-hidden="true" />
              <span className="text-acr-pos dark:text-acr-pos font-medium tabular-nums">
                {usd(Math.round(Number(property.marketValue) / Number(property.sizeAcres)), { noCents: true })}/acre
              </span>
              {property.createdAt && (
                <span className="ml-auto text-muted-foreground/70">
                  {Math.floor((Date.now() - new Date(property.createdAt).getTime()) / 86400000)}d in portfolio
                </span>
              )}
            </div>
          )}
        </div>
        {(() => {
          const enrichment = property.enrichmentData as any;
          const score = enrichment?.scores?.overallScore ?? enrichment?.scores?.investmentScore;
          if (score == null) return null;
          const color = score >= 70
            ? "bg-acr-neg-soft text-acr-neg border-acr-neg/30"
            : score >= 40
            ? "bg-acr-warn-soft text-acr-warn border-acr-warn/30"
            : "bg-acr-pos-soft text-acr-pos border-acr-pos-soft";
          const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
          return (
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${color}`} data-testid={`badge-distress-${property.id}`}>
                <Flame className="w-3 h-3" aria-hidden="true" />
                Distress {label} {score}
              </span>
            </div>
          );
        })()}
        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setIsDetailOpen(true)}
            className="flex-1 min-h-[44px] pointer-fine:sm:min-h-8"
            data-testid={`button-view-details-${property.id}`}
          >
            <ClipboardCheck className="w-4 h-4 sm:w-3.5 sm:h-3.5 mr-1.5" aria-hidden="true" />
            <span className="text-sm">Due Diligence</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="min-h-[44px] min-w-[44px] pointer-fine:sm:min-h-8 pointer-fine:sm:min-w-8"
            onClick={() => setIsCalculatorOpen(true)}
            aria-label="Open calculator"
            data-testid={`button-calculator-${property.id}`}
          >
            <Calculator className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
      
      <PropertyDetailDialog 
        property={property} 
        open={isDetailOpen} 
        onOpenChange={setIsDetailOpen} 
      />
      
      <ResponsiveModal open={isCalculatorOpen} onOpenChange={setIsCalculatorOpen}>
        <ResponsiveModalContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              ROI Calculator - {property.county}, {property.state}
            </ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Analyze potential returns for this property. APN: {property.apn}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <DealCalculator
            property={property}
            showSaveButton={false}
          />
        </ResponsiveModalContent>
      </ResponsiveModal>
    </Card>
  );
}

const LAND_INVESTOR_TYPES = ["land_flipper", "note_investor", "hybrid"];

function PropertyForm({
  onSuccess,
  prefill,
}: {
  onSuccess: () => void;
  prefill?: { county?: string; state?: string; latitude?: string; longitude?: string };
}) {
  const { mutate, isPending } = useCreateProperty();
  const { toast } = useToast();
  const { data: organization } = useOrganization();
  const businessType = (organization?.onboardingData as any)?.businessType as string | undefined;
  const isLandType = !businessType || LAND_INVESTOR_TYPES.includes(businessType);
  const [showLandDetails, setShowLandDetails] = useState(isLandType);

  const form = useForm<z.input<typeof propertyFormSchema>, unknown, z.output<typeof propertyFormSchema>>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      apn: isLandType ? "" : "N/A",
      sizeAcres: "",
      county: prefill?.county || "",
      state: prefill?.state || "",
      purchasePrice: "",
      marketValue: "",
      description: prefill?.latitude && prefill?.longitude
        ? `Captured from current location: ${prefill.latitude}, ${prefill.longitude}`
        : "",
      status: "available",
    }
  });

  // Keep APN default in sync if businessType loads asynchronously
  useEffect(() => {
    if (!isLandType && !form.getValues("apn")) {
      form.setValue("apn", "N/A");
    }
  }, [isLandType, form]);

  const onSubmit = (data: z.infer<typeof propertyFormSchema>) => {
    // Ensure APN is never empty for non-land types
    if (!isLandType && (!data.apn || data.apn.trim() === "")) {
      data.apn = "N/A";
    }
    mutate(data, {
      onSuccess: () => {
        telemetry.actionCompleted('property_created', { county: data.county, state: data.state, acres: data.sizeAcres });
        toast({ title: "Property added", description: `${data.county}, ${data.state} saved to your inventory.` });
        onSuccess();
      },
      onError: (error: any) => {
        toast({
          title: "Couldn't add property",
          description: error?.message || "Save failed. Your form values are still here — try again.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        {isLandType && (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="apn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>APN</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="123-456-789" inputMode="numeric" autoComplete="off" data-testid="input-apn" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sizeAcres"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Acres</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="5.0" inputMode="decimal" autoComplete="off" data-testid="input-acres" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
        {!isLandType && (
          <div className="border rounded-md">
            <button
              type="button"
              className="w-full min-h-[44px] pointer-fine:md:min-h-9 flex items-center justify-between px-3 text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
              onClick={() => setShowLandDetails((v) => !v)}
              aria-expanded={showLandDetails}
              aria-controls="land-details-panel"
            >
              <span>Land Details (optional — APN, Acreage)</span>
              {showLandDetails
                ? <ChevronUp className="w-4 h-4" aria-hidden="true" />
                : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </button>
            {showLandDetails && (
              <div id="land-details-panel" className="grid grid-cols-2 gap-4 px-3 pb-3">
                <FormField
                  control={form.control}
                  name="apn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>APN</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="123-456-789 or N/A" inputMode="numeric" autoComplete="off" data-testid="input-apn" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sizeAcres"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Acres</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="5.0" inputMode="decimal" autoComplete="off" data-testid="input-acres" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="county"
            render={({ field }) => (
              <FormItem>
                <FormLabel>County</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="San Bernardino" data-testid="input-county" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="CA"
                    maxLength={2}
                    autoCapitalize="characters"
                    autoComplete="address-level1"
                    data-testid="input-state"
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
            name="purchasePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Price (USD)</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} placeholder="5000" type="number" inputMode="decimal" min="0" data-testid="input-purchase-price" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="marketValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Market Value (USD)</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} placeholder="15000" type="number" inputMode="decimal" min="0" data-testid="input-market-value" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ""} placeholder="Beautiful desert lot with road access…" data-testid="input-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full min-h-[44px] pointer-fine:md:min-h-9" disabled={isPending} data-testid="button-submit-property">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Adding...
              </>
            ) : (
              "Add Property"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function PropertyDetailDialog({ property, open, onOpenChange }: {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isAnalysisChatOpen, setIsAnalysisChatOpen] = useState(false);
  const { toast } = useToast();

  const { data: freshProperty, isLoading: isLoadingProperty, isError: isFreshPropertyError } = useQuery<Property>({
    queryKey: ['/api/properties', property.id],
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (isFreshPropertyError && open) {
      toast({
        title: "Couldn't refresh property",
        description: "Showing the last known version. Close and reopen to retry.",
        variant: "destructive",
      });
    }
  }, [isFreshPropertyError, open, toast]);

  const currentProperty = freshProperty || property;

  const utilities = currentProperty.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
  const parcelData = currentProperty.parcelData as { regridId?: string; owner?: string; ownerAddress?: string; taxAmount?: string; lastUpdated?: string } | null;

  const formatCurrency = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return "—";
    const num = Number(value);
    if (isNaN(num) || num === 0) return "—";
    return usd(num, { noCents: true });
  };

  // Compute centroid from boundary if not present
  const effectiveCentroid = currentProperty.parcelCentroid || computeCentroidFromBoundary(currentProperty.parcelBoundary as { type: string; coordinates: number[][][] | number[][][][] } | null);
  const hasMapData = currentProperty.parcelBoundary && effectiveCentroid;
  const hasOwnerData = parcelData?.owner || parcelData?.ownerAddress;
  const hasUtilities = utilities && Object.values(utilities).some(Boolean);

  // --- Quick Verdict: investment score computation ---
  const verdictData = useMemo(() => {
    let score = 0;
    const factors: { label: string; met: boolean }[] = [];
    const enrichment = currentProperty.enrichmentData as any;
    const ddData = currentProperty.dueDiligenceData as any;

    // Factor 1: Has assessed value
    const hasAssessedValue = !!currentProperty.assessedValue && Number(currentProperty.assessedValue) > 0;
    factors.push({ label: "Assessed value on file", met: hasAssessedValue });
    if (hasAssessedValue) score += 1;

    // Factor 2: Has market value or enrichment value data
    const hasMarketValue = !!currentProperty.marketValue && Number(currentProperty.marketValue) > 0;
    factors.push({ label: "Market value available", met: hasMarketValue });
    if (hasMarketValue) score += 1;

    // Factor 3: Taxes current (check DD data)
    const taxesCurrent = ddData?.taxesCurrent === true;
    factors.push({ label: "Taxes current", met: taxesCurrent });
    if (taxesCurrent) score += 1;

    // Factor 4: Has comps / enrichment intelligence data
    const hasIntelligence = !!(enrichment?.scores) || !!(ddData?.hazards) || !!currentProperty.parcelBoundary;
    factors.push({ label: "Intelligence / parcel data", met: hasIntelligence });
    if (hasIntelligence) score += 1;

    // Derive traffic light
    let signal: "green" | "yellow" | "red" | "gray";
    let signalLabel: string;
    if (factors.every(f => !f.met)) {
      signal = "gray";
      signalLabel = "Insufficient Data";
    } else if (score >= 3) {
      signal = "green";
      signalLabel = "Strong Buy";
    } else if (score === 2) {
      signal = "yellow";
      signalLabel = "Investigate";
    } else {
      signal = "red";
      signalLabel = "Pass";
    }

    // Key metrics
    const pricePerAcre = currentProperty.sizeAcres && Number(currentProperty.sizeAcres) > 0 && currentProperty.marketValue && Number(currentProperty.marketValue) > 0
      ? Number(currentProperty.marketValue) / Number(currentProperty.sizeAcres)
      : null;

    return { score, factors, signal, signalLabel, pricePerAcre };
  }, [currentProperty]);

  // Verdict decision mutation (Pursue = due_diligence, Pass = rejected).
  // Optimistic: the Pursue/Pass buttons collapse into the decision badge
  // instantly — the ["/api/properties"] prefix walk patches every cached
  // list AND the single-entity detail cache (["/api/properties", id])
  // in place, with snapshot + rollback on server reject. Deliberately no
  // detailKey here: the list-key prefix already matches the detail entry,
  // and passing both would snapshot the already-patched value.
  const buildVerdictPatch = (decision: "pursue" | "pass") => ({
    status: decision === "pursue" ? "due_diligence" : "rejected",
    dueDiligenceData: {
      ...((currentProperty.dueDiligenceData as any) || {}),
      verdictDecision: decision,
      verdictDecisionAt: new Date().toISOString(),
      verdictScore: verdictData.score,
    },
  });
  const verdictMutation = useOptimisticUpdate<{ decision: "pursue" | "pass" }, Property>(
    {
      mutationFn: async ({ decision }) => {
        const res = await apiRequest("PATCH", `/api/properties/${currentProperty.id}`, buildVerdictPatch(decision));
        if (!res.ok) throw new Error("Failed to update property decision");
        return res.json();
      },
      listKeys: [["/api/properties"]],
      getId: () => currentProperty.id,
      buildPatch: ({ decision }) => buildVerdictPatch(decision),
      extraInvalidateKeys: [["/api/properties", currentProperty.id]],
      successToast: false,
    },
    {
      onSuccess: (_data, { decision }) => {
        toast({
          title: decision === "pursue" ? "Moved to Due Diligence" : "Marked as Passed",
          description: decision === "pursue"
            ? "This property is now in Due Diligence. Continue verifying title, taxes, and hazards."
            : "You can still reopen this record — nothing is deleted.",
        });
      },
    },
  );

  const signalColors: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    green: { bg: "bg-acr-pos-soft dark:bg-acr-pos-soft/30", text: "text-acr-pos dark:text-acr-pos", border: "border-acr-pos-soft dark:border-acr-pos-soft", dot: "bg-acr-pos" },
    yellow: { bg: "bg-acr-warn-soft dark:bg-acr-warn-soft/30", text: "text-acr-warn dark:text-acr-warn", border: "border-acr-warn/30 dark:border-acr-warn/30", dot: "bg-acr-warn" },
    red: { bg: "bg-acr-neg-soft dark:bg-acr-neg-soft/30", text: "text-acr-neg dark:text-acr-neg", border: "border-acr-neg/30 dark:border-acr-neg/30", dot: "bg-acr-neg" },
    gray: { bg: "bg-muted/50", text: "text-muted-foreground", border: "border-muted", dot: "bg-muted-foreground" },
  };
  const sc = signalColors[verdictData.signal];
  const existingDecision = (currentProperty.dueDiligenceData as any)?.verdictDecision as string | undefined;

  return (
    <>
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <ResponsiveModalHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <ResponsiveModalTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <MapPin className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{currentProperty.address || `${currentProperty.county}, ${currentProperty.state}`}</span>
            </ResponsiveModalTitle>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              {/* r7 Ingrid WF-R7-002: data-heavy personas need property-level
                  export to move data into their own analysis environment
                  (Jupyter, PostgreSQL, etc). Copy-JSON keeps zero infra cost. */}
              <Button
                variant="outline"
                className="min-h-[44px] pointer-fine:sm:min-h-8 w-full sm:w-auto"
                onClick={() => {
                  const json = JSON.stringify(currentProperty, null, 2);
                  navigator.clipboard?.writeText(json).then(
                    () => toast({ title: "Property JSON copied to clipboard" }),
                    () => toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the JSON text and copy manually.", variant: "destructive" })
                  );
                }}
                data-testid="button-copy-property-json"
                aria-label="Copy property data as JSON"
                title="Copy all property fields as JSON"
              >
                Copy data
              </Button>
              <Button
                variant="default"
                className="min-h-[44px] pointer-fine:sm:min-h-8 w-full sm:w-auto"
                onClick={() => setIsAnalysisChatOpen(true)}
                data-testid="button-analyze-with-ai"
              >
                <Bot className="w-4 h-4 mr-2" aria-hidden="true" />
                Analyze with AI
              </Button>
            </div>
          </div>
          <ResponsiveModalDescription className="flex items-center gap-2 sm:gap-4 flex-wrap text-xs sm:text-sm">
            {/* r5 Eleanor WF-R5-002: glossary hints for abbreviations. APN
                is inline-explained here; longer tooltips elsewhere. */}
            <span title="Assessor Parcel Number — the county's unique identifier for this parcel">
              APN: {currentProperty.apn}
            </span>
            <span>{currentProperty.sizeAcres} Acres</span>
            <Badge
              variant="outline"
              className="capitalize"
              title={
                currentProperty.status === "prospect"
                  ? "Prospect: under consideration, not yet owned"
                  : currentProperty.status === "owned"
                  ? "Owned: in your portfolio"
                  : String(currentProperty.status).replace(/_/g, " ")
              }
            >
              {currentProperty.status.replace(/_/g, ' ')}
            </Badge>
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {/* FRICTION-0007: Quick Verdict — synthesized go/no-go recommendation */}
        <Card className={`${sc.bg} ${sc.border} border`} data-testid="quick-verdict-card">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Signal indicator + score */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${sc.dot} shrink-0`} data-testid="verdict-signal-dot" />
                  <div>
                    <div className={`text-sm font-semibold ${sc.text}`} data-testid="verdict-signal-label">
                      {verdictData.signalLabel}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Score: {verdictData.score}/4
                    </div>
                  </div>
                </div>
                <Target className={`w-5 h-5 ${sc.text} hidden sm:block`} aria-hidden="true" />
              </div>

              {/* Key metrics */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-xs">Est. Value</span>
                  <p className="font-semibold" data-testid="verdict-market-value">
                    {formatCurrency(currentProperty.marketValue || currentProperty.assessedValue)}
                  </p>
                  {(currentProperty.marketValue || currentProperty.assessedValue) && (
                    <DataProvenanceTag
                      source={currentProperty.marketValue ? (currentProperty.enrichedAt ? "AcreOS estimate" : "User entered") : "County assessor"}
                      asOf={parcelData?.lastUpdated || currentProperty.enrichedAt || currentProperty.updatedAt}
                    />
                  )}
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-xs">Price per acre</span>
                  <p className="font-semibold tabular-nums" data-testid="verdict-price-per-acre">
                    {verdictData.pricePerAcre ? usd(Math.round(verdictData.pricePerAcre), { noCents: true }) : "—"}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-xs">Tax status</span>
                  <p className="font-semibold" data-testid="verdict-tax-status">
                    {(currentProperty.dueDiligenceData as any)?.taxesCurrent === true
                      ? "Current"
                      : (currentProperty.dueDiligenceData as any)?.taxesCurrent === false
                        ? "Delinquent"
                        : "Unknown"}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-xs">Acreage</span>
                  <p className="font-semibold tabular-nums" data-testid="verdict-acreage">
                    {currentProperty.sizeAcres ? `${Number(currentProperty.sizeAcres).toLocaleString()} ac` : "—"}
                  </p>
                </div>
              </div>

              {/* Decision buttons */}
              <div className="flex gap-2 shrink-0">
                {existingDecision ? (
                  <Badge
                    variant={existingDecision === "pursue" ? "default" : "destructive"}
                    className="text-xs px-3 py-1.5"
                    data-testid="verdict-decision-badge"
                  >
                    {existingDecision === "pursue" ? "Pursuing" : "Passed"}
                  </Badge>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      className="min-h-[36px]"
                      onClick={() => verdictMutation.mutate({ decision: "pursue" })}
                      disabled={verdictMutation.isPending}
                      aria-label="Pursue this property"
                      data-testid="verdict-pursue-button"
                    >
                      {verdictMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" />
                      ) : (
                        <ThumbsUp className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      )}
                      Pursue
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[36px]"
                      onClick={() => verdictMutation.mutate({ decision: "pass" })}
                      disabled={verdictMutation.isPending}
                      aria-label="Pass on this property"
                      data-testid="verdict-pass-button"
                    >
                      {verdictMutation.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" />
                      ) : (
                        <ThumbsDown className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      )}
                      Pass
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Score factors (collapsed detail) */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs" data-testid="verdict-factors">
              {verdictData.factors.map((f) => (
                <span key={f.label} className={`flex items-center gap-1 ${f.met ? "text-foreground" : "text-muted-foreground"}`}>
                  {f.met ? (
                    <CheckCircle className="w-3 h-3 text-acr-pos" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-muted-foreground/50" aria-hidden="true" />
                  )}
                  {f.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="mt-4">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TooltipProvider delayDuration={300}>
              <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-5 gap-1">
                <TabsTrigger value="overview" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-overview">Overview</TabsTrigger>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="intelligence" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-intelligence">
                      <Brain className="w-3.5 h-3.5 mr-1 hidden sm:inline" aria-hidden="true" />
                      <span className="hidden md:inline">Intelligence</span>
                      <span className="md:hidden">Intel</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Market signals, enrichment data, and scoring</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="comps" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-comps">
                      <BarChart2 className="w-3.5 h-3.5 mr-1 hidden sm:inline" aria-hidden="true" />
                      <span className="hidden md:inline">Comparables</span>
                      <span className="md:hidden">Comps</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Recent nearby sales with $/acre benchmarks</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="ai-offer" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-ai-offer">
                      <Calculator className="w-3.5 h-3.5 mr-1 hidden sm:inline" aria-hidden="true" />
                      AI Offer
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Draft an offer price grounded in comps and taxes</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="due-diligence" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-due-diligence">
                      <span className="hidden md:inline">Due Diligence</span>
                      <span className="md:hidden">DD</span>
                    </TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Title, taxes, hazards, and access checklist</TooltipContent>
                </Tooltip>
              </TabsList>
            </TooltipProvider>
          </div>
          
          {isLoadingProperty && (
            <div
              className="flex items-center justify-center py-8 gap-2"
              data-testid="skeleton-property-detail-loading"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">Loading latest property details…</span>
            </div>
          )}
          
          <TabsContent value="overview" className="space-y-6 mt-4">
            {/* Research Summary Panel - consolidated view for offer decisions */}
            <ResearchSummaryPanel property={currentProperty} />
            
            {hasMapData && (
              <div className="rounded-md overflow-hidden border -mx-4 sm:mx-0">
                <div className="h-[250px] sm:h-[350px]">
                  <SinglePropertyMap
                    boundary={currentProperty.parcelBoundary as { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][]; }}
                    centroid={effectiveCentroid as { lat: number; lng: number }}
                    apn={currentProperty.apn}
                    height="100%"
                    enable3DTerrain={true}
                    state={currentProperty.state}
                    county={currentProperty.county}
                    showNearbyParcels={true}
                  />
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                  Location Details
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">County</span>
                    <p className="font-medium">{currentProperty.county}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">State</span>
                    <p className="font-medium">{currentProperty.state}</p>
                  </div>
                  {currentProperty.city && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">City</span>
                      <p className="font-medium">{currentProperty.city}</p>
                    </div>
                  )}
                  {currentProperty.zip && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">ZIP</span>
                      <p className="font-medium">{currentProperty.zip}</p>
                    </div>
                  )}
                  {currentProperty.subdivision && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Subdivision</span>
                      <p className="font-medium">{currentProperty.subdivision}</p>
                    </div>
                  )}
                  {currentProperty.lotNumber && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Lot Number</span>
                      <p className="font-medium">{currentProperty.lotNumber}</p>
                    </div>
                  )}
                  {currentProperty.latitude && currentProperty.longitude && (
                    <div className="space-y-1 col-span-2">
                      <span className="text-muted-foreground text-xs">Coordinates</span>
                      <p className="font-medium font-mono text-xs">{Number(currentProperty.latitude).toFixed(6)}, {Number(currentProperty.longitude).toFixed(6)}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Ruler className="w-4 h-4" aria-hidden="true" />
                  Property Characteristics
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Size</span>
                    <p className="font-medium">{currentProperty.sizeAcres} Acres</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Zoning</span>
                    <p className="font-medium">{currentProperty.zoning || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Terrain</span>
                    <p className="font-medium capitalize">{currentProperty.terrain || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Road Access</span>
                    <p className="font-medium capitalize">{currentProperty.roadAccess || "N/A"}</p>
                  </div>
                  {hasUtilities && (
                    <div className="space-y-1 col-span-2">
                      <span className="text-muted-foreground text-xs">Utilities</span>
                      <div className="flex gap-2 flex-wrap">
                        {utilities?.electric && <Badge variant="secondary">Electric</Badge>}
                        {utilities?.water && <Badge variant="secondary">Water</Badge>}
                        {utilities?.sewer && <Badge variant="secondary">Sewer</Badge>}
                        {utilities?.gas && <Badge variant="secondary">Gas</Badge>}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="w-4 h-4" aria-hidden="true" />
                  Financial Information
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Assessed Value <span className="text-muted-foreground/60">USD</span></span>
                    <p className="font-medium">{formatCurrency(currentProperty.assessedValue)}</p>
                    {currentProperty.assessedValue && Number(currentProperty.assessedValue) > 0 && (
                      <DataProvenanceTag
                        source="County assessor"
                        asOf={parcelData?.lastUpdated || currentProperty.enrichedAt}
                        confidence="high"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Market Value <span className="text-muted-foreground/60">USD</span></span>
                    <p className="font-medium">{formatCurrency(currentProperty.marketValue)}</p>
                    {currentProperty.marketValue && Number(currentProperty.marketValue) > 0 && (
                      <DataProvenanceTag
                        source={currentProperty.enrichedAt ? "AcreOS estimate" : "User entered"}
                        asOf={currentProperty.enrichedAt || currentProperty.updatedAt}
                        confidence={currentProperty.enrichedAt ? "medium" : undefined}
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Purchase Price <span className="text-muted-foreground/60">USD</span></span>
                    <p className="font-medium">{formatCurrency(currentProperty.purchasePrice)}</p>
                    {currentProperty.purchasePrice && Number(currentProperty.purchasePrice) > 0 && (
                      <DataProvenanceTag
                        source="User entered"
                        asOf={currentProperty.purchaseDate || currentProperty.updatedAt}
                        confidence="high"
                      />
                    )}
                  </div>
                  {currentProperty.purchaseDate && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Purchase Date</span>
                      <p className="font-medium">{formatDate(currentProperty.purchaseDate)}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">List Price <span className="text-muted-foreground/60">USD</span></span>
                    <p className="font-medium">{formatCurrency(currentProperty.listPrice)}</p>
                    {currentProperty.listPrice && Number(currentProperty.listPrice) > 0 && (
                      <DataProvenanceTag
                        source="User entered"
                        asOf={currentProperty.updatedAt}
                      />
                    )}
                  </div>
                  {currentProperty.soldPrice && (
                    <>
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Sold Price <span className="text-muted-foreground/60">USD</span></span>
                        <p className="font-medium">{formatCurrency(currentProperty.soldPrice)}</p>
                        <DataProvenanceTag
                          source="User entered"
                          asOf={currentProperty.soldDate || currentProperty.updatedAt}
                          confidence="high"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Sold Date</span>
                        <p className="font-medium">{formatDate(currentProperty.soldDate)}</p>
                      </div>
                    </>
                  )}
                  <HoldPeriodBadge
                    purchaseDate={currentProperty.purchaseDate}
                    soldDate={currentProperty.soldDate}
                    purchasePrice={currentProperty.purchasePrice}
                    soldPrice={currentProperty.soldPrice}
                  />
                  {parcelData?.taxAmount && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Annual Taxes <span className="text-muted-foreground/60">USD</span></span>
                      <p className="font-medium">{formatCurrency(parcelData.taxAmount)}</p>
                      <DataProvenanceTag
                        source="County records"
                        asOf={parcelData.lastUpdated}
                        confidence="high"
                      />
                    </div>
                  )}
                </div>
              </div>

              {(() => {
                // r7 Ingrid WF-R7-001: inline Distress Indicators section.
                // Renders only when at least one distress signal is flagged
                // on the parcel's dueDiligenceData.distress jsonb subtree.
                const distress = (currentProperty.dueDiligenceData as any)?.distress as
                  | {
                      taxDelinquent?: boolean;
                      taxDelinquentYears?: number;
                      taxPrincipalCents?: number;
                      taxPenaltyCents?: number;
                      taxInterestCents?: number;
                      taxPayoffAsOf?: string;
                      probate?: boolean;
                      codeViolation?: boolean;
                      source?: string;
                      updatedAt?: string;
                      lienState?: "tax-lien" | "tax-deed";
                      lienSoldDate?: string;
                      lienHolder?: string;
                      redemptionDeadline?: string;
                      auctionDate?: string;
                      openingBid?: number;
                    }
                  | undefined;
                const hasDistress = !!distress && (
                  distress.taxDelinquent ||
                  distress.probate ||
                  distress.codeViolation ||
                  (distress.taxDelinquentYears ?? 0) > 0
                );
                if (!hasDistress) return null;
                const cents = (n?: number) => n ? `$${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                const totalPayoffCents = (distress!.taxPrincipalCents ?? 0) + (distress!.taxPenaltyCents ?? 0) + (distress!.taxInterestCents ?? 0);
                return (
                  <div className="border-t pt-4" data-testid="section-distress-indicators">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-acr-warn dark:text-acr-warn">
                      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                      Distress Indicators
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      {distress!.taxDelinquent && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Tax Status</span>
                          <p className="font-medium text-acr-warn dark:text-acr-warn">
                            Delinquent
                            {distress!.taxDelinquentYears ? ` (${distress!.taxDelinquentYears} years)` : ""}
                          </p>
                        </div>
                      )}
                      {(distress!.taxPrincipalCents ?? 0) > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Tax Principal</span>
                          <p className="font-medium">{cents(distress!.taxPrincipalCents)}</p>
                        </div>
                      )}
                      {(distress!.taxPenaltyCents ?? 0) > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Penalty</span>
                          <p className="font-medium">{cents(distress!.taxPenaltyCents)}</p>
                        </div>
                      )}
                      {(distress!.taxInterestCents ?? 0) > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Accrued Interest</span>
                          <p className="font-medium">{cents(distress!.taxInterestCents)}</p>
                        </div>
                      )}
                      {totalPayoffCents > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Total Payoff</span>
                          <p className="font-semibold">{cents(totalPayoffCents)}</p>
                          {distress!.taxPayoffAsOf && (
                            <DataProvenanceTag
                              source={distress!.source ?? "County records"}
                              asOf={distress!.taxPayoffAsOf}
                              confidence="high"
                            />
                          )}
                        </div>
                      )}
                      {distress!.probate && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Probate</span>
                          <p className="font-medium text-acr-warn dark:text-acr-warn">Yes</p>
                        </div>
                      )}
                      {distress!.codeViolation && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Code Violation</span>
                          <p className="font-medium text-acr-warn dark:text-acr-warn">Yes</p>
                        </div>
                      )}
                      {/* Cycle 5 r2 Priya: tax-lien / tax-deed lifecycle
                          fields. Visible only when at least one of them
                          is populated. */}
                      {distress!.lienState && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Regime</span>
                          <p className="font-medium">{distress!.lienState === "tax-lien" ? "Tax-lien state" : "Tax-deed state"}</p>
                        </div>
                      )}
                      {distress!.lienSoldDate && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Lien Sold</span>
                          <p className="font-medium">{formatDate(distress!.lienSoldDate)}</p>
                        </div>
                      )}
                      {distress!.lienHolder && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Lien Holder</span>
                          <p className="font-medium">{distress!.lienHolder}</p>
                        </div>
                      )}
                      {distress!.redemptionDeadline && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Redemption Deadline</span>
                          <p className="font-medium text-acr-warn dark:text-acr-warn">{formatDate(distress!.redemptionDeadline)}</p>
                        </div>
                      )}
                      {distress!.auctionDate && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Auction Date</span>
                          <p className="font-medium text-acr-warn dark:text-acr-warn">{formatDate(distress!.auctionDate)}</p>
                        </div>
                      )}
                      {distress!.openingBid !== undefined && distress!.openingBid > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-xs">Opening Bid</span>
                          <p className="font-medium">{cents(distress!.openingBid)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {hasOwnerData && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" aria-hidden="true" />
                    Owner Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {parcelData?.owner && (
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Owner Name</span>
                        <p className="font-medium">{parcelData.owner}</p>
                      </div>
                    )}
                    {parcelData?.ownerAddress && (
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Owner Address</span>
                        <p className="font-medium">{parcelData.ownerAddress}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {currentProperty.legalDescription && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-2">Legal Description</h4>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md font-mono text-xs">
                    {currentProperty.legalDescription}
                  </p>
                </div>
              )}

              {currentProperty.description && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-2">Description</h4>
                  <p className="text-sm">{currentProperty.description}</p>
                </div>
              )}

              {parcelData?.lastUpdated && (
                <div className="text-xs text-muted-foreground pt-2">
                  Parcel data last updated: {formatDate(parcelData.lastUpdated)}
                </div>
              )}
            </div>
            
            <div className="pt-4 border-t">
              <CustomFieldValuesEditor entityType="property" entityId={currentProperty.id} />
            </div>
          </TabsContent>
          
          <TabsContent value="intelligence" className="mt-4">
            <PropertyIntelligenceTab property={currentProperty} />
          </TabsContent>
          
          <TabsContent value="comps" className="mt-4">
            <CompsAnalysis property={currentProperty} />
          </TabsContent>
          
          <TabsContent value="ai-offer" className="mt-4">
            <AIOfferGenerator property={currentProperty} />
          </TabsContent>
          
          <TabsContent value="due-diligence" className="mt-4">
            <DueDiligencePanel propertyId={currentProperty.id} />
          </TabsContent>
        </Tabs>
      </ResponsiveModalContent>
    </ResponsiveModal>
    
    <PropertyAnalysisChat 
      property={currentProperty} 
      open={isAnalysisChatOpen} 
      onOpenChange={setIsAnalysisChatOpen} 
    />
    </>
  );
}

interface EnrichmentData {
  enrichedAt?: Date | string;
  lookupTimeMs?: number;
  lastEnrichedAt?: string;
  hazards?: {
    floodZone?: string;
    floodRisk?: "low" | "medium" | "high";
    wetlandsPresent?: boolean;
    wetlandsPercentage?: number;
    earthquakeRisk?: "low" | "medium" | "high";
    wildfireRisk?: "low" | "medium" | "high";
    nearbySuperfundSites?: number;
    overallRiskScore?: number;
    overallRiskLevel?: "low" | "medium" | "high";
  };
  environment?: {
    soilType?: string;
    soilSuitability?: string;
    soilDrainage?: string;
    capabilityClass?: string;
    hydrologicGroup?: string;
    primeFarmland?: boolean;
    farmlandClass?: string;
    epaFacilitiesNearby?: number;
    epaRiskLevel?: "low" | "medium" | "high";
  };
  infrastructure?: {
    nearestHospitalMiles?: number;
    nearestFireStationMiles?: number;
    nearestSchoolMiles?: number;
    nearbyHospitals?: number;
    nearbyFireStations?: number;
    nearbySchools?: number;
    accessScore?: number;
  };
  demographics?: {
    population?: number;
    medianIncome?: number;
    medianHouseholdIncome?: number;
    medianHomeValue?: number;
    povertyRate?: number;
    collegeEducated?: number;
    ownerOccupancyRate?: number;
    vacancyRate?: number;
    avgCommuteMinutes?: number;
    unemployment?: string;
  };
  publicLands?: {
    nearBLM?: boolean;
    nearUSFS?: boolean;
    nearNPS?: boolean;
    federalLandWithinMiles?: number;
  };
  transportation?: {
    nearestHighwayMiles?: number;
    nearestBridgeMiles?: number;
    nearestRailMiles?: number;
    roadAccessScore?: number;
    hasPavedRoad?: boolean | null;
    hasDirtRoad?: boolean | null;
    localRoadCount?: number;
  };
  water?: {
    nearestStreamMiles?: number;
    nearestWaterBodyMiles?: number;
    waterAvailabilityScore?: number;
  };
  scores?: {
    investmentScore?: number;
    developmentScore?: number;
    riskScore?: number;
    overallScore?: number;
  };
  elevation?: {
    elevationFeet?: number;
    elevationMeters?: number;
    datum?: string;
    source?: string;
  };
  climate?: {
    avgHighTempF?: number;
    avgLowTempF?: number;
    annualPrecipInches?: number;
    period?: string;
    source?: string;
  };
  agriculturalValues?: {
    countyAvgPerAcre?: number | null;
    stateAvgPerAcre?: number | null;
    nationalAvgPerAcre?: number | null;
    dataYear?: number;
    notes?: string;
    source?: string;
  };
  landCover?: {
    nlcdClass?: number | null;
    className?: string;
    isAgricultural?: boolean;
    isDeveloped?: boolean;
    isForested?: boolean;
    isWetland?: boolean;
    year?: number;
    source?: string;
  };
  cropland?: {
    cropCode?: number | null;
    cropName?: string;
    year?: number;
    isAgriculturalCrop?: boolean;
    isPastureOrHay?: boolean;
    isCultivatedCrop?: boolean;
    isForest?: boolean;
    isWetland?: boolean;
    source?: string;
  };
  epaFacilities?: {
    totalCount?: number;
    superfundCount?: number;
    airViolationCount?: number;
    waterViolationCount?: number;
    hazWasteCount?: number;
    riskLevel?: "low" | "medium" | "high";
    searchRadiusMiles?: number;
    source?: string;
  };
  stormHistory?: {
    tornadoRisk?: string;
    hurricaneRisk?: string;
    hailRisk?: string;
    countyName?: string;
    note?: string;
    source?: string;
  };
  plss?: {
    section?: string;
    township?: string;
    range?: string;
    legalDescription?: string;
    source?: string;
  };
  watershed?: {
    huc8?: string;
    huc12?: string;
    watershedName?: string;
    source?: string;
  };
  femaNri?: {
    compositeScore?: number;
    riverineFloodRisk?: string;
    hurricaneRisk?: string;
    tornadoRisk?: string;
    wildfireRisk?: string;
    hailRisk?: string;
    source?: string;
  };
  usdaClu?: {
    cluId?: string;
    farmNumber?: string;
    tractNumber?: string;
    calculatedAcres?: number;
    source?: string;
  };
  errors?: Record<string, string>;
}

/**
 * Hold-period badge — surfaces short-term vs. long-term capital-gains
 * status for the property. §1222 distinguishes:
 *   - Holding period > 1 year = LONG-TERM (max 20% federal LTCG + 3.8% NIIT)
 *   - Holding period ≤ 1 year = SHORT-TERM (ordinary income, up to 37%)
 *
 * For unsold properties, the badge warns if the operator is approaching
 * the 1-year mark — selling at day 365 versus day 366 is a 17-22 point
 * tax-rate swing on the gain.
 *
 * Lisa Tanaka: this is the cheapest tax mistake to avoid. People close
 * 2 weeks before the 1-year mark to "get it done" and pay $50k more in
 * tax than they had to. Surface it loudly.
 */
function HoldPeriodBadge({
  purchaseDate,
  soldDate,
  purchasePrice,
  soldPrice,
}: {
  purchaseDate: Date | string | null | undefined;
  soldDate: Date | string | null | undefined;
  purchasePrice: string | number | null | undefined;
  soldPrice: string | number | null | undefined;
}) {
  if (!purchaseDate) return null;

  const purchase = new Date(purchaseDate);
  const end = soldDate ? new Date(soldDate) : new Date();
  const holdDays = Math.floor((end.getTime() - purchase.getTime()) / (1000 * 60 * 60 * 24));
  // §1222(3) — long-term = held "more than 1 year." Day 365 is still
  // short-term; day 366 is long-term. The IRS counts the day AFTER
  // acquisition as day 1 and counts through and including the sale day.
  const isLongTerm = holdDays > 365;
  const daysToLongTerm = 366 - holdDays;

  // Compute gain if both prices exist
  const gainNum = soldPrice && purchasePrice
    ? Number(soldPrice) - Number(purchasePrice)
    : null;
  const positiveGain = gainNum !== null && gainNum > 0;

  // SOLD path — show the actual treatment that hits
  if (soldDate) {
    return (
      <div className="space-y-1 col-span-2 md:col-span-3 mt-2 p-3 rounded-md border bg-muted/30" data-testid="hold-period-sold">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Holding period</span>
            <Badge
              variant={isLongTerm ? "default" : "destructive"}
              className="tabular-nums"
              aria-label={isLongTerm ? "Long-term capital gain treatment" : "Short-term capital gain — ordinary income rates"}
            >
              {isLongTerm ? "Long-term" : "Short-term"} · {holdDays}d
            </Badge>
          </div>
          {positiveGain && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Gain {usd(gainNum!, { noCents: true })}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {isLongTerm
            ? "§1222(3) long-term: max 20% federal + 3.8% NIIT IF investor-classified (not dealer property)."
            : "§1222(1) short-term: taxed as ORDINARY INCOME (up to 37% federal). No preferential rate."}
        </p>
        {!isLongTerm && positiveGain && (
          <p className="text-xs text-acr-warn">
            Sold {365 - holdDays + 1} {365 - holdDays + 1 === 1 ? "day" : "days"} before long-term threshold. At a 20%-vs-37% spread, the timing cost is roughly {usd((gainNum! * 0.17), { noCents: true })}.
          </p>
        )}
      </div>
    );
  }

  // STILL HELD path — warn if approaching the threshold
  return (
    <div className="space-y-1 col-span-2 md:col-span-3 mt-2 p-3 rounded-md border bg-muted/30" data-testid="hold-period-held">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Current holding period</span>
          <Badge
            variant={isLongTerm ? "default" : "secondary"}
            className="tabular-nums"
            aria-label={isLongTerm ? "Currently qualifies for long-term capital gains" : `Short-term — ${daysToLongTerm} days until long-term threshold`}
          >
            {isLongTerm ? "Long-term qualified" : "Short-term"} · {holdDays}d
          </Badge>
        </div>
      </div>
      {!isLongTerm && daysToLongTerm > 0 && daysToLongTerm <= 90 && (
        <p className="text-xs text-acr-warn font-medium">
          Selling now triggers SHORT-TERM rates (ordinary income, up to 37%). Wait {daysToLongTerm} {daysToLongTerm === 1 ? "day" : "days"} for §1222(3) long-term treatment (max 20% + 3.8% NIIT).
        </p>
      )}
      {!isLongTerm && daysToLongTerm > 90 && (
        <p className="text-xs text-muted-foreground">
          {daysToLongTerm} days remaining until §1222(3) long-term threshold.
        </p>
      )}
      {isLongTerm && (
        <p className="text-xs text-muted-foreground">
          Eligible for long-term capital-gain treatment IF you are classified as an investor (not a dealer). See the Tax Optimizer dealer/investor surface.
        </p>
      )}
    </div>
  );
}

function getRiskBadgeVariant(risk?: "low" | "medium" | "high"): "default" | "secondary" | "destructive" {
  switch (risk) {
    case "low": return "default";
    case "medium": return "secondary";
    case "high": return "destructive";
    default: return "secondary";
  }
}

function getRiskColor(risk?: "low" | "medium" | "high"): string {
  switch (risk) {
    case "low": return "text-acr-pos";
    case "medium": return "text-acr-warn";
    case "high": return "text-acr-neg";
    default: return "text-muted-foreground";
  }
}

function formatDistance(miles?: number): string {
  if (miles === undefined || miles === null) return "N/A";
  if (miles < 1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

function PropertyIntelligenceTab({ property }: { property: Property }) {
  const { mutate: enrichProperty, isPending: isEnriching } = useEnrichProperty();
  const { toast } = useToast();
  
  const enrichmentData = (property.enrichmentData as EnrichmentData | null) || (property.dueDiligenceData as EnrichmentData | null);
  const hasData = enrichmentData && (
    enrichmentData.hazards ||
    enrichmentData.environment ||
    enrichmentData.infrastructure ||
    enrichmentData.demographics ||
    enrichmentData.scores
  );
  
  const lastEnrichedAt = enrichmentData?.lastEnrichedAt || 
    (enrichmentData?.enrichedAt ? new Date(enrichmentData.enrichedAt).toISOString() : null);

  const handleRefresh = () => {
    enrichProperty(
      { propertyId: property.id, forceRefresh: true },
      {
        onSuccess: () => {
          toast({
            title: "Intelligence updated",
            description: "Fetched fresh environmental, hazard, and demographic data for this property.",
          });
        },
        onError: (error: any) => {
          toast({
            title: "Couldn't refresh intelligence",
            description: error.message || "One or more data sources didn't respond. Your existing data is unchanged — try again in a moment.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6" data-testid="property-intelligence-panel">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="w-5 h-5" aria-hidden="true" />
            Property Intelligence
          </h3>
          {lastEnrichedAt && (
            <p className="text-xs text-muted-foreground" data-testid="text-last-enriched">
              Last updated: {formatDateTime(lastEnrichedAt)}
            </p>
          )}
        </div>
        <Button
          onClick={handleRefresh}
          disabled={isEnriching || !property.latitude || !property.longitude}
          data-testid="button-refresh-intelligence"
          aria-label={isEnriching ? "Refreshing intelligence data…" : "Refresh intelligence data"}
        >
          {isEnriching ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Enriching…</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" /> Refresh Intelligence</>
          )}
        </Button>
      </div>

      {/* Data Completeness Widget */}
      {hasData && (enrichmentData as any)?.completenessScore !== undefined && (
        <Card data-testid="card-completeness">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" aria-hidden="true" />
                <h4 className="font-semibold text-sm" id="completeness-label">Data Completeness</h4>
              </div>
              <span className="text-lg font-bold tabular-nums" aria-hidden="true">
                {(enrichmentData as any).completenessScore}%
              </span>
            </div>
            <div
              className="w-full bg-muted rounded-full h-2 mb-3"
              role="progressbar"
              aria-labelledby="completeness-label"
              aria-valuenow={(enrichmentData as any).completenessScore}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${(enrichmentData as any).completenessScore}% of data sources populated`}
            >
              <div
                className={`h-2 rounded-full transition-all ${
                  (enrichmentData as any).completenessScore >= 80
                    ? "bg-acr-pos"
                    : (enrichmentData as any).completenessScore >= 50
                    ? "bg-acr-warn"
                    : "bg-acr-neg"
                }`}
                style={{ width: `${(enrichmentData as any).completenessScore}%` }}
              />
            </div>
            {(enrichmentData as any).completenessBreakdown && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-2">
                {Object.entries((enrichmentData as any).completenessBreakdown as Record<string, boolean>).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className={`text-xs px-1.5 py-0.5 rounded text-center truncate ${
                        value ? "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft dark:text-acr-pos" : "bg-muted text-muted-foreground"
                      }`}
                      title={key}
                    >
                      {key.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </div>
                  )
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!property.latitude || !property.longitude ? (
        <Card className="border-dashed" role="status">
          <CardContent className="py-8 text-center">
            <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
            <h4 className="font-medium mb-2">Missing Coordinates</h4>
            <p className="text-sm text-muted-foreground">
              This property needs GPS coordinates to fetch intelligence data.
              Fetch the parcel data first to get coordinates.
            </p>
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card className="border-dashed" role="status">
          <CardContent className="py-8 text-center">
            <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
            <h4 className="font-medium mb-2">No Intelligence Data</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Fetch environmental, hazard, and demographic data for this property.
            </p>
            <Button
              onClick={handleRefresh}
              disabled={isEnriching}
              data-testid="button-fetch-intelligence"
              aria-label={isEnriching ? "Fetching intelligence data…" : "Fetch intelligence data"}
            >
              {isEnriching ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Fetching…</>
              ) : (
                <><Brain className="w-4 h-4 mr-2" aria-hidden="true" /> Fetch Intelligence</>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {enrichmentData?.scores && (
            <Card data-testid="card-scores">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
                  <h4 className="font-semibold">Investment Scores</h4>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1" data-testid="score-overall">
                    <span className="text-muted-foreground text-xs">Overall Score</span>
                    <p className="font-bold text-xl">{enrichmentData.scores.overallScore ?? "N/A"}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                  </div>
                  <div className="space-y-1" data-testid="score-investment">
                    <span className="text-muted-foreground text-xs">Investment</span>
                    <p className="font-medium text-lg">{enrichmentData.scores.investmentScore ?? "N/A"}</p>
                  </div>
                  <div className="space-y-1" data-testid="score-development">
                    <span className="text-muted-foreground text-xs">Development</span>
                    <p className="font-medium">{enrichmentData.scores.developmentScore ?? "N/A"}</p>
                  </div>
                  <div className="space-y-1" data-testid="score-risk">
                    <span className="text-muted-foreground text-xs">Risk Score</span>
                    <p className={`font-medium ${(enrichmentData.scores.riskScore ?? 0) > 50 ? "text-acr-neg" : (enrichmentData.scores.riskScore ?? 0) > 25 ? "text-acr-warn" : "text-acr-pos"}`}>
                      {enrichmentData.scores.riskScore ?? "N/A"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Derived from the data below — not an appraisal. Use alongside your own diligence.
                </p>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.hazards && (
            <Card data-testid="card-flood-zone">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Droplets className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">Flood & Water Risk</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="flood-zone-code">
                    <span className="text-muted-foreground">Flood Zone</span>
                    <Badge variant="outline" title="FEMA National Flood Hazard Layer designation">{enrichmentData.hazards.floodZone || "Unknown"}</Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="flood-risk-level">
                    <span className="text-muted-foreground">Flood Risk</span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.floodRisk)} className="capitalize">
                      {enrichmentData.hazards.floodRisk || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="wetlands-present">
                    <span className="text-muted-foreground">Wetlands Present</span>
                    <span className={enrichmentData.hazards.wetlandsPresent ? "text-acr-warn" : "text-acr-pos"}>
                      {enrichmentData.hazards.wetlandsPresent ? `Yes (${enrichmentData.hazards.wetlandsPercentage}%)` : "No"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">FEMA NFHL</p>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.hazards && (
            <Card data-testid="card-natural-hazards">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  <h4 className="font-semibold">Natural Hazards</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="earthquake-risk">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Mountain className="w-3 h-3" aria-hidden="true" /> Earthquake
                    </span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.earthquakeRisk)} className="capitalize">
                      {enrichmentData.hazards.earthquakeRisk || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="wildfire-risk">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Flame className="w-3 h-3" aria-hidden="true" /> Wildfire
                    </span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.wildfireRisk)} className="capitalize">
                      {enrichmentData.hazards.wildfireRisk || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="overall-risk">
                    <span className="text-muted-foreground">Overall Risk</span>
                    <span className={getRiskColor(enrichmentData.hazards.overallRiskLevel)}>
                      {enrichmentData.hazards.overallRiskScore !== undefined 
                        ? `${enrichmentData.hazards.overallRiskScore}/100 (${enrichmentData.hazards.overallRiskLevel})`
                        : "N/A"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.environment && (
            <Card data-testid="card-environmental">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Leaf className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <h4 className="font-semibold">Environmental Factors</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="superfund-sites">
                    <span className="text-muted-foreground">EPA Sites Nearby</span>
                    <span className={enrichmentData.environment.epaFacilitiesNearby && enrichmentData.environment.epaFacilitiesNearby > 0 ? "text-acr-warn" : "text-acr-pos"}>
                      {enrichmentData.environment.epaFacilitiesNearby ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="epa-risk">
                    <span className="text-muted-foreground">EPA Risk Level</span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.environment.epaRiskLevel)} className="capitalize">
                      {enrichmentData.environment.epaRiskLevel || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="soil-type">
                    <span className="text-muted-foreground">Soil Type</span>
                    <span>{enrichmentData.environment.soilType || "Unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="soil-suitability">
                    <span className="text-muted-foreground">Soil Suitability</span>
                    <span className="capitalize">{enrichmentData.environment.soilSuitability || "Unknown"}</span>
                  </div>
                  {enrichmentData.environment.capabilityClass && (
                    <div className="flex items-center justify-between" data-testid="capability-class">
                      <span className="text-muted-foreground">Capability Class</span>
                      <Badge variant="outline">Class {enrichmentData.environment.capabilityClass}</Badge>
                    </div>
                  )}
                  {enrichmentData.environment.primeFarmland !== undefined && (
                    <div className="flex items-center justify-between" data-testid="prime-farmland">
                      <span className="text-muted-foreground">Prime Farmland</span>
                      <span className={enrichmentData.environment.primeFarmland ? "text-acr-pos" : "text-muted-foreground"}>
                        {enrichmentData.environment.primeFarmland ? "Yes" : "No"}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.infrastructure && (
            <Card data-testid="card-infrastructure">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <h4 className="font-semibold">Infrastructure</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="nearest-hospital">
                    <span className="text-muted-foreground">Nearest Hospital</span>
                    <span>{formatDistance(enrichmentData.infrastructure.nearestHospitalMiles)}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="nearest-fire-station">
                    <span className="text-muted-foreground">Nearest Fire Station</span>
                    <span>{formatDistance(enrichmentData.infrastructure.nearestFireStationMiles)}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="nearest-school">
                    <span className="text-muted-foreground">Nearest School</span>
                    <span>{formatDistance(enrichmentData.infrastructure.nearestSchoolMiles)}</span>
                  </div>
                  {enrichmentData.infrastructure.accessScore !== undefined && (
                    <div className="flex items-center justify-between" data-testid="access-score">
                      <span className="text-muted-foreground">Access Score</span>
                      <span className="font-medium">{enrichmentData.infrastructure.accessScore}/100</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.demographics && (
            <Card data-testid="card-demographics">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">Demographics</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="population">
                    <span className="text-muted-foreground">Population</span>
                    <span className="tabular-nums">{enrichmentData.demographics.population?.toLocaleString() || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="median-income">
                    <span className="text-muted-foreground">Median income</span>
                    <span className="tabular-nums">
                      {usd(
                        enrichmentData.demographics.medianHouseholdIncome ?? enrichmentData.demographics.medianIncome,
                        { noCents: true }
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="median-home-value">
                    <span className="text-muted-foreground">Median home value</span>
                    <span className="tabular-nums">
                      {usd(enrichmentData.demographics.medianHomeValue, { noCents: true })}
                    </span>
                  </div>
                  {enrichmentData.demographics.povertyRate !== undefined && (
                    <div className="flex items-center justify-between" data-testid="poverty-rate">
                      <span className="text-muted-foreground">Poverty rate</span>
                      <span className="tabular-nums">{enrichmentData.demographics.povertyRate.toFixed(1)}%</span>
                    </div>
                  )}
                  {enrichmentData.demographics.ownerOccupancyRate !== undefined && (
                    <div className="flex items-center justify-between" data-testid="owner-occupancy-rate">
                      <span className="text-muted-foreground">Owner Occupancy</span>
                      <span>{enrichmentData.demographics.ownerOccupancyRate}%</span>
                    </div>
                  )}
                  {enrichmentData.demographics.vacancyRate !== undefined && (
                    <div className="flex items-center justify-between" data-testid="vacancy-rate">
                      <span className="text-muted-foreground">Vacancy Rate</span>
                      <span>{enrichmentData.demographics.vacancyRate}%</span>
                    </div>
                  )}
                  {enrichmentData.demographics.avgCommuteMinutes !== undefined && (
                    <div className="flex items-center justify-between" data-testid="avg-commute">
                      <span className="text-muted-foreground">Avg Commute</span>
                      <span>{enrichmentData.demographics.avgCommuteMinutes} min</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.transportation && (
            <Card data-testid="card-transportation">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Car className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <h4 className="font-semibold">Transportation</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="nearest-highway">
                    <span className="text-muted-foreground">Nearest Highway</span>
                    <span>{formatDistance(enrichmentData.transportation.nearestHighwayMiles)}</span>
                  </div>
                  {enrichmentData.transportation.nearestBridgeMiles !== undefined && (
                    <div className="flex items-center justify-between" data-testid="nearest-bridge">
                      <span className="text-muted-foreground">Nearest Bridge</span>
                      <span>{formatDistance(enrichmentData.transportation.nearestBridgeMiles)}</span>
                    </div>
                  )}
                  {enrichmentData.transportation.nearestRailMiles !== undefined && (
                    <div className="flex items-center justify-between" data-testid="nearest-rail">
                      <span className="text-muted-foreground">Nearest Rail</span>
                      <span>{formatDistance(enrichmentData.transportation.nearestRailMiles)}</span>
                    </div>
                  )}
                  {enrichmentData.transportation.hasPavedRoad !== null &&
                    enrichmentData.transportation.hasPavedRoad !== undefined && (
                      <div className="flex items-center justify-between" data-testid="paved-road">
                        <span className="text-muted-foreground">Paved Road Access</span>
                        <span className={enrichmentData.transportation.hasPavedRoad ? "text-acr-pos" : "text-acr-warn"}>
                          {enrichmentData.transportation.hasPavedRoad ? "Yes" : "No"}
                        </span>
                      </div>
                  )}
                  {enrichmentData.transportation.roadAccessScore !== undefined && (
                    <div className="flex items-center justify-between" data-testid="road-access-score">
                      <span className="text-muted-foreground">Road Access Score</span>
                      <span className="font-medium">{enrichmentData.transportation.roadAccessScore}/100</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.publicLands && (
            <Card data-testid="card-public-lands">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TreePine className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <h4 className="font-semibold">Public Lands</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="near-blm">
                    <span className="text-muted-foreground">Near BLM Land</span>
                    <span>{enrichmentData.publicLands.nearBLM ? "Yes" : "No"}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="near-usfs">
                    <span className="text-muted-foreground">Near US Forest Service</span>
                    <span>{enrichmentData.publicLands.nearUSFS ? "Yes" : "No"}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="near-nps">
                    <span className="text-muted-foreground">Near National Parks</span>
                    <span>{enrichmentData.publicLands.nearNPS ? "Yes" : "No"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.water && (
            <Card data-testid="card-water-resources">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Droplets className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">Water Resources</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="nearest-stream">
                    <span className="text-muted-foreground">Nearest Stream</span>
                    <span>{formatDistance(enrichmentData.water.nearestStreamMiles)}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="nearest-water-body">
                    <span className="text-muted-foreground">Nearest Water Body</span>
                    <span>{formatDistance(enrichmentData.water.nearestWaterBodyMiles)}</span>
                  </div>
                  {enrichmentData.water.waterAvailabilityScore !== undefined && (
                    <div className="flex items-center justify-between" data-testid="water-availability-score">
                      <span className="text-muted-foreground">Water Availability</span>
                      <span className="font-medium">{enrichmentData.water.waterAvailabilityScore}/100</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.elevation && (
            <Card data-testid="card-elevation">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Mountain className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <h4 className="font-semibold">Elevation & Terrain</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.elevation.elevationFeet !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Elevation</span>
                      <span className="font-medium">{enrichmentData.elevation.elevationFeet?.toLocaleString()} ft ({enrichmentData.elevation.elevationMeters?.toFixed(0)} m)</span>
                    </div>
                  )}
                  {enrichmentData.elevation.datum && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Datum</span>
                      <span className="text-xs">{enrichmentData.elevation.datum}</span>
                    </div>
                  )}
                  {enrichmentData.elevation.source && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Source</span>
                      <Badge variant="outline" className="text-xs">{enrichmentData.elevation.source}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.climate && (
            <Card data-testid="card-climate">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Thermometer className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  <h4 className="font-semibold">Climate & Growing</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.climate.avgHighTempF !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg High Temp</span>
                      <span>{enrichmentData.climate.avgHighTempF}°F</span>
                    </div>
                  )}
                  {enrichmentData.climate.avgLowTempF !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Avg Low Temp</span>
                      <span>{enrichmentData.climate.avgLowTempF}°F</span>
                    </div>
                  )}
                  {enrichmentData.climate.annualPrecipInches !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Annual Precip</span>
                      <span>{enrichmentData.climate.annualPrecipInches}" / yr</span>
                    </div>
                  )}
                  {enrichmentData.climate.period && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Period</span>
                      <span className="text-xs text-muted-foreground">{enrichmentData.climate.period}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.agriculturalValues && (
            <Card data-testid="card-agricultural-values">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wheat className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  <h4 className="font-semibold">Agricultural values</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.agriculturalValues.countyAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">County avg / acre</span>
                      <span className="font-medium tabular-nums">{usd(enrichmentData.agriculturalValues.countyAvgPerAcre, { noCents: true })}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.stateAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">State avg / acre</span>
                      <span className="tabular-nums">{usd(enrichmentData.agriculturalValues.stateAvgPerAcre, { noCents: true })}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.nationalAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">National avg / acre</span>
                      <span className="tabular-nums">{usd(enrichmentData.agriculturalValues.nationalAvgPerAcre, { noCents: true })}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.dataYear && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Data year</span>
                      <span className="text-xs text-muted-foreground">{enrichmentData.agriculturalValues.dataYear} (USDA NASS)</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.landCover && (
            <Card data-testid="card-land-cover">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Leaf className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <h4 className="font-semibold">Land Cover</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.landCover.className && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Cover Type</span>
                      <Badge variant="outline" className="capitalize">{enrichmentData.landCover.className}</Badge>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {enrichmentData.landCover.isAgricultural && <Badge variant="secondary" className="text-xs">Agricultural</Badge>}
                    {enrichmentData.landCover.isDeveloped && <Badge variant="secondary" className="text-xs">Developed</Badge>}
                    {enrichmentData.landCover.isForested && <Badge variant="secondary" className="text-xs">Forested</Badge>}
                    {enrichmentData.landCover.isWetland && <Badge variant="secondary" className="text-xs">Wetland</Badge>}
                  </div>
                  {enrichmentData.landCover.year && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Year</span>
                      <span className="text-xs text-muted-foreground">NLCD {enrichmentData.landCover.year}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.cropland && (
            <Card data-testid="card-cropland">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wheat className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                  <h4 className="font-semibold">Cropland Data</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.cropland.cropName && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Dominant Crop</span>
                      <span className="font-medium capitalize">{enrichmentData.cropland.cropName}</span>
                    </div>
                  )}
                  {enrichmentData.cropland.year && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Survey Year</span>
                      <span className="text-xs text-muted-foreground">{enrichmentData.cropland.year} (USDA CDL)</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {enrichmentData.cropland.isCultivatedCrop && <Badge variant="secondary" className="text-xs">Cultivated</Badge>}
                    {enrichmentData.cropland.isPastureOrHay && <Badge variant="secondary" className="text-xs">Pasture/Hay</Badge>}
                    {enrichmentData.cropland.isForest && <Badge variant="secondary" className="text-xs">Forest</Badge>}
                    {enrichmentData.cropland.isWetland && <Badge variant="secondary" className="text-xs">Wetland</Badge>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.epaFacilities && (
            <Card data-testid="card-epa-facilities">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Factory className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <h4 className="font-semibold">EPA Facilities Nearby</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total Facilities</span>
                    <span className={enrichmentData.epaFacilities.totalCount && enrichmentData.epaFacilities.totalCount > 0 ? "text-acr-warn font-medium" : "text-acr-pos"}>{enrichmentData.epaFacilities.totalCount ?? 0}</span>
                  </div>
                  {(enrichmentData.epaFacilities.superfundCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Superfund Sites</span>
                      <span className="text-acr-neg font-medium">{enrichmentData.epaFacilities.superfundCount}</span>
                    </div>
                  )}
                  {(enrichmentData.epaFacilities.airViolationCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Air Violations</span>
                      <span className="text-acr-warn">{enrichmentData.epaFacilities.airViolationCount}</span>
                    </div>
                  )}
                  {(enrichmentData.epaFacilities.hazWasteCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Hazardous Waste</span>
                      <span className="text-acr-warn">{enrichmentData.epaFacilities.hazWasteCount}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Risk Level</span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.epaFacilities.riskLevel)} className="capitalize">
                      {enrichmentData.epaFacilities.riskLevel || "Unknown"}
                    </Badge>
                  </div>
                  {enrichmentData.epaFacilities.searchRadiusMiles && (
                    <p className="text-xs text-muted-foreground">Within {enrichmentData.epaFacilities.searchRadiusMiles} mile radius (EPA FRS)</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.stormHistory && (
            <Card data-testid="card-storm-history">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Cloud className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">Storm Risk</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tornado Risk</span>
                    <span className="capitalize font-medium">{enrichmentData.stormHistory.tornadoRisk || "Unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Hurricane Risk</span>
                    <span className="capitalize font-medium">{enrichmentData.stormHistory.hurricaneRisk || "Unknown"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Hail Risk</span>
                    <span className="capitalize font-medium">{enrichmentData.stormHistory.hailRisk || "Unknown"}</span>
                  </div>
                  {enrichmentData.stormHistory.source && (
                    <p className="text-xs text-muted-foreground">{enrichmentData.stormHistory.source}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.plss && (
            <Card data-testid="card-plss">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Grid3x3 className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">PLSS Legal Description</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.plss.legalDescription && (
                    <div>
                      <span className="text-muted-foreground text-xs">Legal Description</span>
                      <p className="font-mono font-medium mt-0.5">{enrichmentData.plss.legalDescription}</p>
                    </div>
                  )}
                  {enrichmentData.plss.section && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Section</span>
                      <span>{enrichmentData.plss.section}</span>
                    </div>
                  )}
                  {enrichmentData.plss.township && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Township</span>
                      <span>{enrichmentData.plss.township}</span>
                    </div>
                  )}
                  {enrichmentData.plss.range && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Range</span>
                      <span>{enrichmentData.plss.range}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">BLM CadNSDI</p>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.watershed && (
            <Card data-testid="card-watershed">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Waves className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  <h4 className="font-semibold">Watershed</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.watershed.watershedName && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Watershed Name</span>
                      <span className="font-medium text-right max-w-[60%]">{enrichmentData.watershed.watershedName}</span>
                    </div>
                  )}
                  {enrichmentData.watershed.huc8 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">HUC-8</span>
                      <span className="font-mono text-xs">{enrichmentData.watershed.huc8}</span>
                    </div>
                  )}
                  {enrichmentData.watershed.huc12 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">HUC-12</span>
                      <span className="font-mono text-xs">{enrichmentData.watershed.huc12}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">EPA NHD Plus / WATERS</p>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.femaNri && (
            <Card data-testid="card-fema-nri">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                  <h4 className="font-semibold">FEMA National Risk Index</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.femaNri.compositeScore !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Composite Risk Score</span>
                      <span className={`font-bold text-lg ${enrichmentData.femaNri.compositeScore > 70 ? "text-acr-neg" : enrichmentData.femaNri.compositeScore > 40 ? "text-acr-warn" : "text-acr-pos"}`}>
                        {enrichmentData.femaNri.compositeScore.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {enrichmentData.femaNri.riverineFloodRisk && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Riverine Flood</span>
                      <span className="capitalize">{enrichmentData.femaNri.riverineFloodRisk}</span>
                    </div>
                  )}
                  {enrichmentData.femaNri.tornadoRisk && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Tornado</span>
                      <span className="capitalize">{enrichmentData.femaNri.tornadoRisk}</span>
                    </div>
                  )}
                  {enrichmentData.femaNri.wildfireRisk && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Wildfire</span>
                      <span className="capitalize">{enrichmentData.femaNri.wildfireRisk}</span>
                    </div>
                  )}
                  {enrichmentData.femaNri.hailRisk && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Hail</span>
                      <span className="capitalize">{enrichmentData.femaNri.hailRisk}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">FEMA National Risk Index (Official)</p>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.usdaClu && (
            <Card data-testid="card-usda-clu">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wheat className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <h4 className="font-semibold">USDA Farm Records (CLU)</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.usdaClu.farmNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Farm Number</span>
                      <span className="font-mono">{enrichmentData.usdaClu.farmNumber}</span>
                    </div>
                  )}
                  {enrichmentData.usdaClu.tractNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Tract Number</span>
                      <span className="font-mono">{enrichmentData.usdaClu.tractNumber}</span>
                    </div>
                  )}
                  {enrichmentData.usdaClu.calculatedAcres !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Calculated Acres</span>
                      <span className="font-medium">{enrichmentData.usdaClu.calculatedAcres.toFixed(2)} ac</span>
                    </div>
                  )}
                  {enrichmentData.usdaClu.cluId && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">CLU ID</span>
                      <span className="font-mono text-xs">{enrichmentData.usdaClu.cluId}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">USDA FSA Common Land Units</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {enrichmentData?.errors && Object.keys(enrichmentData.errors).length > 0 && (
        <Card className="border-acr-warn/30 dark:border-acr-warn/30" data-testid="card-errors" role="status">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-acr-warn" aria-hidden="true" />
              <h4 className="font-semibold text-acr-warn dark:text-acr-warn">Some data couldn't be fetched</h4>
            </div>
            <ul className="text-sm text-muted-foreground space-y-1">
              {Object.entries(enrichmentData.errors).map(([category, error]) => (
                <li key={category} className="flex gap-2">
                  <span className="font-medium capitalize">{category.replace(/_/g, " ")}:</span>
                  <span>{error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
