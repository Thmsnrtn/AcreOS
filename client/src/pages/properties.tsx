import { PageShell } from "@/components/page-shell";
import { useProperties, useCreateProperty, useDeleteProperty, useEnrichProperty } from "@/hooks/use-properties";
import { queryClient } from "@/lib/queryClient";
import { telemetry } from "@/lib/telemetry";
import { ListSkeleton } from "@/components/list-skeleton";
import { useFetchPropertyParcel, useFetchAllParcels } from "@/hooks/use-parcels";
import { useState, useMemo } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPropertySchema, type Property, type DueDiligenceItem, type DueDiligenceTemplate } from "@shared/schema";
import { z } from "zod";
import {
  useDueDiligenceTemplates,
  usePropertyDueDiligence,
  useApplyDueDiligenceTemplate,
  useUpdateDueDiligenceItem,
  useCreateDueDiligenceItem,
} from "@/hooks/use-due-diligence";

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
    console.error("Failed to compute centroid from boundary:", e);
    return null;
  }
}

// Client-side form schema with enhanced validation
const propertyFormSchema = insertPropertySchema.omit({ organizationId: true }).extend({
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Ruler, DollarSign, Trash2, Loader2, Map as MapIcon, RefreshCw, FileText, Download, Upload, CheckCircle, AlertCircle, ClipboardCheck, Printer, Calculator, BarChart2, X, CheckSquare, Droplets, Leaf, Building2, Flame, Users, Brain, Shield, Zap, Mountain, TreePine, Car, TrendingUp, Thermometer, Cloud, Waves, Wheat, Factory, Grid3x3 } from "lucide-react";
import { LandCreditBadge } from "@/components/land-credit-badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DealCalculator } from "@/components/deal-calculator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { PropertiesEmptyState } from "@/components/empty-states";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { PropertyMap, SinglePropertyMap, StaticPropertyMap } from "@/components/property-map";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { CompsAnalysis } from "@/components/comps-analysis";
import { AIOfferGenerator } from "@/components/ai-offer-generator";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DueDiligencePanel } from "@/components/due-diligence-panel";
import { PropertyAnalysisChat } from "@/components/property-analysis-chat";
import { GisFilters, type GisFilterState, defaultGisFilters, countActiveGisFilters, applyGisFiltersToProperty } from "@/components/gis-filters";
import { SavedViewsSelector } from "@/components/saved-views-selector";
import type { SavedView } from "@shared/schema";
import { QueryErrorState } from "@/components/query-error-state";
import { Bot } from "lucide-react";

export default function PropertiesPage() {
  const { data: properties, isLoading, error, refetch, isRefetching } = useProperties();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const actionFromUrl = urlParams.get("action");

  const [viewMode, setViewMode] = useState<"list" | "map">(() => {
    try { return (localStorage.getItem("properties-view-mode") as "list" | "map") || "list"; } catch { return "list"; }
  });
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new");
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
  const [gisFilters, setGisFilters] = useState<GisFilterState>(defaultGisFilters);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [distressFilter, setDistressFilter] = useState<string>("any");
  const { toast } = useToast();
  const { mutate: fetchAllParcels, isPending: isFetchingAllParcels } = useFetchAllParcels();

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
      toast({ title: "Success", description: `Deleted ${result.deletedCount} properties.` });
      setSelectedPropertyIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete properties", variant: "destructive" });
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
      toast({ title: "Success", description: `Updated ${result.updatedCount} properties to "${status}".` });
      setSelectedPropertyIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update properties", variant: "destructive" });
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
    } catch (error) {
      console.error('Export error:', error);
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
    } catch (error) {
      console.error('Preview error:', error);
      setImportPreview(null);
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
    } catch (error) {
      console.error('Import error:', error);
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
          toast({ title: "Success", description: "Property deleted successfully." });
          setDeletingProperty(null);
        },
        onError: (error: Error) => {
          toast({ 
            title: "Error", 
            description: error.message || "Failed to delete property", 
            variant: "destructive" 
          });
          setDeletingProperty(null);
        },
      });
    }
  };

  return (
    <PageShell>
        
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Inventory</h1>
              <p className="text-muted-foreground">Track land parcels and their status.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* List / Map view toggle */}
              <div className="flex items-center rounded-lg border overflow-hidden">
                <button
                  onClick={() => { setViewMode("list"); try { localStorage.setItem("properties-view-mode", "list"); } catch {} }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  aria-pressed={viewMode === "list"}
                >
                  <MapIcon className="w-4 h-4 rotate-0" style={{ display: "none" }} />
                  ☰ List
                </button>
                <button
                  onClick={() => { setViewMode("map"); try { localStorage.setItem("properties-view-mode", "map"); } catch {} }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1.5 ${viewMode === "map" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  aria-pressed={viewMode === "map"}
                >
                  <MapPin className="w-3.5 h-3.5" /> Map
                </button>
              </div>
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                className="min-h-[44px] md:min-h-9"
                data-testid="button-export-properties"
              >
                {isExporting ? <Loader2 className="w-4 h-4 md:mr-2 animate-spin" /> : <Download className="w-4 h-4 md:mr-2" />}
                <span className="hidden md:inline">Export CSV</span>
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsImportOpen(true)}
                className="min-h-[44px] md:min-h-9"
                data-testid="button-import-properties"
              >
                <Upload className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Import CSV</span>
              </Button>
              <Button 
                variant="outline" 
                onClick={() => fetchAllParcels()}
                disabled={isFetchingAllParcels}
                className="min-h-[44px] md:min-h-9"
                data-testid="button-fetch-all-parcels"
              >
                {isFetchingAllParcels ? <Loader2 className="w-4 h-4 md:mr-2 animate-spin" /> : <MapIcon className="w-4 h-4 md:mr-2" />}
                <span className="hidden md:inline">{isFetchingAllParcels ? "Fetching..." : "Fetch Boundaries"}</span>
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="shadow-lg hover:shadow-primary/25 min-h-[44px] md:min-h-9" data-testid="button-add-property">
                    <Plus className="w-4 h-4 mr-2" /> <span className="hidden sm:inline">Add</span> Property
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Add New Property</DialogTitle>
                    <DialogDescription>
                      Enter the property details including APN, location, and acreage.
                    </DialogDescription>
                  </DialogHeader>
                  <PropertyForm onSuccess={() => setIsCreateOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {selectedPropertyIds.size > 0 && (
            <div className="p-3 bg-muted/50 border rounded-md space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3" data-testid="bulk-actions-toolbar-properties">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4" />
                <span className="text-sm font-medium" data-testid="text-selected-properties-count">{selectedPropertyIds.size} propert{selectedPropertyIds.size !== 1 ? "ies" : "y"} selected</span>
                <Button variant="ghost" size="icon" className="md:hidden min-h-[44px] min-w-[44px] ml-auto" onClick={() => setSelectedPropertyIds(new Set())} data-testid="button-clear-selection-properties-mobile">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-2 md:ml-auto">
                <Button variant="outline" className="min-h-[44px] md:min-h-8" onClick={handleBulkExportProperties} data-testid="button-bulk-export-properties">
                  <Download className="w-4 h-4 mr-1" /> Export
                </Button>
                <Select onValueChange={handleBulkStatusChange} disabled={isBulkUpdating}>
                  <SelectTrigger className="min-h-[44px] md:min-h-8 w-full md:w-[150px]" data-testid="select-bulk-status-properties">
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
                <Button variant="destructive" className="min-h-[44px] md:min-h-8 col-span-2 md:col-span-1" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting} data-testid="button-bulk-delete-properties">
                  <Trash2 className="w-4 h-4 mr-1" /> Delete
                </Button>
                <Button variant="ghost" size="sm" className="hidden md:flex" onClick={() => setSelectedPropertyIds(new Set())} data-testid="button-clear-selection-properties">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {!isLoading && properties && properties.length > 0 && (
            <div className="space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-3 p-2 bg-muted/30 rounded-md">
              <div className="flex items-center justify-between gap-2 md:justify-start">
                <div className="flex items-center gap-2 min-h-[44px] md:min-h-0">
                  <Checkbox
                    checked={filteredProperties.length > 0 && selectedPropertyIds.size === filteredProperties.length}
                    onCheckedChange={(checked) => handleSelectAll(checked === true)}
                    className="h-5 w-5 md:h-4 md:w-4"
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
              />
              <Select value={distressFilter} onValueChange={setDistressFilter}>
                <SelectTrigger className="h-8 w-[160px]" data-testid="select-distress-filter">
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

          {(viewMode === "list" || isLoading) && (isLoading ? (
            <div data-testid="skeleton-properties-grid">
              <ListSkeleton count={6} variant="card" />
            </div>
          ) : error ? (
            <QueryErrorState
              error={error}
              onRetry={() => refetch()}
              isRetrying={isRefetching}
              title="Unable to load properties"
              description="We couldn't fetch your property inventory. This might be a temporary issue."
              testId="query-error-state-properties"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProperties.map((property) => (
                <div key={property.id} className="relative">
                  <div className="absolute top-3 left-3 z-10">
                    <Checkbox
                      checked={selectedPropertyIds.has(property.id)}
                      onCheckedChange={(checked) => handleSelectProperty(property.id, checked === true)}
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
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  No properties match the current GIS filters. Try adjusting your filter criteria.
                </div>
              )}
              {properties?.length === 0 && (
                <div className="col-span-full">
                  <PropertiesEmptyState
                    onAddProperty={() => setIsCreateOpen(true)}
                    onImportProperties={() => setIsImportOpen(true)}
                  />
                </div>
              )}
            </div>
          ))}

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

      <Dialog open={isImportOpen} onOpenChange={(open) => !open && resetImportDialog()}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Properties from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file to bulk import properties. Required columns: apn, county, state, sizeAcres
            </DialogDescription>
          </DialogHeader>
          
          {!importPreview && !importResult && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
                <label className="cursor-pointer">
                  <span className="text-sm text-muted-foreground">
                    {isLoadingPreview ? "Processing..." : "Click to select or drag a CSV file here"}
                  </span>
                  <Input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={isLoadingPreview}
                    data-testid="input-import-property-file"
                  />
                </label>
                <p className="text-xs text-muted-foreground mt-2">Max file size: 5MB</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4">
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
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Found {importPreview.totalRows} rows to import</span>
              </div>
              
              <div className="border rounded-lg overflow-hidden">
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
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-2xl font-bold">{importResult.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-4">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">{importResult.successCount}</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Imported</p>
                </div>
                <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-4">
                  <p className="text-2xl font-bold text-red-700 dark:text-red-300">{importResult.errorCount}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">Failed</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
                  <div className="bg-red-50 dark:bg-red-900/30 p-2 text-sm font-medium text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Errors ({importResult.errors.length})
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="p-2 border-b last:border-0 text-xs">
                        <span className="font-medium">Row {err.row}:</span>{" "}
                        <span className="text-red-600 dark:text-red-400">{err.error}</span>
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

          <DialogFooter>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    } catch (error) {
      console.error('Download error:', error);
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
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <Button
                variant="outline"
                className="min-h-[44px] sm:min-h-8"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchParcel(property.id);
                }}
                disabled={isFetchingParcel}
                data-testid={`button-fetch-parcel-${property.id}`}
              >
                {isFetchingParcel ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Fetching...</>
                ) : (
                  <><MapIcon className="w-4 h-4 mr-1" /> Fetch Map</>
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 z-10 items-center">
          <LandCreditBadge propertyId={property.id} size="sm" />
          <Badge variant={property.status === 'available' ? 'default' : 'secondary'} className="capitalize shadow-sm text-xs">
            {property.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="absolute top-2 left-2 flex gap-1 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <Button 
            variant="destructive" 
            size="icon"
            className="h-10 w-10 sm:h-7 sm:w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`button-delete-property-${property.id}`}
          >
            <Trash2 className="w-4 h-4 sm:w-3 sm:h-3" />
          </Button>
          <Button 
            variant="secondary" 
            size="icon"
            className="h-10 w-10 sm:h-7 sm:w-7"
            onClick={handleDownloadDeed}
            disabled={isDownloading}
            data-testid={`button-download-deed-${property.id}`}
          >
            {isDownloading ? <Loader2 className="w-4 h-4 sm:w-3 sm:h-3 animate-spin" /> : <FileText className="w-4 h-4 sm:w-3 sm:h-3" />}
          </Button>
          {hasMapData && (
            <Button 
              variant="secondary" 
              size="icon"
              className="h-10 w-10 sm:h-7 sm:w-7"
              onClick={(e) => {
                e.stopPropagation();
                fetchParcel(property.id);
              }}
              disabled={isFetchingParcel}
              data-testid={`button-refresh-parcel-${property.id}`}
            >
              <RefreshCw className={`w-4 h-4 sm:w-3 sm:h-3 ${isFetchingParcel ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </div>
      <CardContent className="p-4">
        <div className="mb-3">
          <h3 className="font-bold text-base truncate">{property.county}, {property.state}</h3>
          <p className="text-xs text-muted-foreground font-mono">APN: {property.apn}</p>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Ruler className="w-3.5 h-3.5" />
            <span>{property.sizeAcres} Acres</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" />
            <span>${Number(property.marketValue || 0).toLocaleString()}</span>
          </div>
          {Number(property.marketValue) > 0 && Number(property.sizeAcres) > 0 && (
            <div className="flex items-center gap-1.5 col-span-2 pt-1 border-t border-border/50">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                ${Math.round(Number(property.marketValue) / Number(property.sizeAcres)).toLocaleString()}/acre
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
            ? "bg-red-100 text-red-700 border-red-200"
            : score >= 40
            ? "bg-yellow-100 text-yellow-700 border-yellow-200"
            : "bg-green-100 text-green-700 border-green-200";
          const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
          return (
            <div className="mt-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${color}`} data-testid={`badge-distress-${property.id}`}>
                <Flame className="w-3 h-3" />
                Distress {label} {score}
              </span>
            </div>
          );
        })()}
        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
          <Button 
            variant="outline" 
            onClick={() => setIsDetailOpen(true)}
            className="flex-1 min-h-[44px] sm:min-h-8"
            data-testid={`button-view-details-${property.id}`}
          >
            <ClipboardCheck className="w-4 h-4 sm:w-3.5 sm:h-3.5 mr-1.5" />
            <span className="text-sm">Due Diligence</span>
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            className="min-h-[44px] min-w-[44px] sm:min-h-8 sm:min-w-8"
            onClick={() => setIsCalculatorOpen(true)}
            data-testid={`button-calculator-${property.id}`}
          >
            <Calculator className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </Button>
        </div>
      </CardContent>
      
      <PropertyDetailDialog 
        property={property} 
        open={isDetailOpen} 
        onOpenChange={setIsDetailOpen} 
      />
      
      <Dialog open={isCalculatorOpen} onOpenChange={setIsCalculatorOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              ROI Calculator - {property.county}, {property.state}
            </DialogTitle>
            <DialogDescription>
              Analyze potential returns for this property. APN: {property.apn}
            </DialogDescription>
          </DialogHeader>
          <DealCalculator 
            property={property}
            showSaveButton={false}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PropertyForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateProperty();
  const form = useForm<z.infer<typeof propertyFormSchema>>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      apn: "",
      sizeAcres: "",
      county: "",
      state: "",
      purchasePrice: "",
      marketValue: "",
      description: "",
      status: "available",
    }
  });

  const onSubmit = (data: z.infer<typeof propertyFormSchema>) => {
    mutate(data, {
      onSuccess: () => {
        telemetry.actionCompleted('property_created', { county: data.county, state: data.state, acres: data.sizeAcres });
        onSuccess();
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="apn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>APN</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="123-456-789" data-testid="input-apn" />
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
                  <Input {...field} placeholder="5.0" data-testid="input-acres" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
                  <Input {...field} placeholder="CA" data-testid="input-state" />
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
                <FormLabel>Purchase Price</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} placeholder="5000" type="number" data-testid="input-purchase-price" />
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
                <FormLabel>Market Value</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ""} placeholder="15000" type="number" data-testid="input-market-value" />
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
                <Input {...field} value={field.value ?? ""} placeholder="Beautiful desert lot with road access..." data-testid="input-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-property">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
  
  const { data: freshProperty, isLoading: isLoadingProperty } = useQuery<Property>({
    queryKey: ['/api/properties', property.id],
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  
  const currentProperty = freshProperty || property;
  
  const utilities = currentProperty.utilities as { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
  const parcelData = currentProperty.parcelData as { regridId?: string; owner?: string; ownerAddress?: string; taxAmount?: string; lastUpdated?: string } | null;
  
  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString();
  };

  const formatCurrency = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return "N/A";
    const num = Number(value);
    if (isNaN(num) || num === 0) return "N/A";
    return `$${num.toLocaleString()}`;
  };

  // Compute centroid from boundary if not present
  const effectiveCentroid = currentProperty.parcelCentroid || computeCentroidFromBoundary(currentProperty.parcelBoundary as { type: string; coordinates: number[][][] | number[][][][] } | null);
  const hasMapData = currentProperty.parcelBoundary && effectiveCentroid;
  const hasOwnerData = parcelData?.owner || parcelData?.ownerAddress;
  const hasUtilities = utilities && Object.values(utilities).some(Boolean);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <MapPin className="w-5 h-5 flex-shrink-0" />
              <span className="truncate">{currentProperty.address || `${currentProperty.county}, ${currentProperty.state}`}</span>
            </DialogTitle>
            <Button 
              variant="default" 
              className="min-h-[44px] sm:min-h-8 w-full sm:w-auto"
              onClick={() => setIsAnalysisChatOpen(true)}
              data-testid="button-analyze-with-ai"
            >
              <Bot className="w-4 h-4 mr-2" />
              Analyze with AI
            </Button>
          </div>
          <DialogDescription className="flex items-center gap-2 sm:gap-4 flex-wrap text-xs sm:text-sm">
            <span>APN: {currentProperty.apn}</span>
            <span>{currentProperty.sizeAcres} Acres</span>
            <Badge variant="outline" className="capitalize">{currentProperty.status.replace('_', ' ')}</Badge>
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="mt-4">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:w-full sm:grid-cols-5 gap-1">
              <TabsTrigger value="overview" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-overview">Overview</TabsTrigger>
              <TabsTrigger value="intelligence" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-intelligence">
                <Brain className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
                Intel
              </TabsTrigger>
              <TabsTrigger value="comps" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-comps">
                <BarChart2 className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
                Comps
              </TabsTrigger>
              <TabsTrigger value="ai-offer" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-ai-offer">
                <Calculator className="w-3.5 h-3.5 mr-1 hidden sm:inline" />
                AI Offer
              </TabsTrigger>
              <TabsTrigger value="due-diligence" className="min-h-[40px] px-3 sm:px-2 whitespace-nowrap" data-testid="tab-due-diligence">DD</TabsTrigger>
            </TabsList>
          </div>
          
          {isLoadingProperty && (
            <div className="flex items-center justify-center py-8 gap-2" data-testid="skeleton-property-detail-loading">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Updating property details...</span>
            </div>
          )}
          
          <TabsContent value="overview" className="space-y-6 mt-4">
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
                  <MapPin className="w-4 h-4" />
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
                  <Ruler className="w-4 h-4" />
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
                  <DollarSign className="w-4 h-4" />
                  Financial Information
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Assessed Value</span>
                    <p className="font-medium">{formatCurrency(currentProperty.assessedValue)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Market Value</span>
                    <p className="font-medium">{formatCurrency(currentProperty.marketValue)}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">Purchase Price</span>
                    <p className="font-medium">{formatCurrency(currentProperty.purchasePrice)}</p>
                  </div>
                  {currentProperty.purchaseDate && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Purchase Date</span>
                      <p className="font-medium">{formatDate(currentProperty.purchaseDate)}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <span className="text-muted-foreground text-xs">List Price</span>
                    <p className="font-medium">{formatCurrency(currentProperty.listPrice)}</p>
                  </div>
                  {currentProperty.soldPrice && (
                    <>
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Sold Price</span>
                        <p className="font-medium">{formatCurrency(currentProperty.soldPrice)}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Sold Date</span>
                        <p className="font-medium">{formatDate(currentProperty.soldDate)}</p>
                      </div>
                    </>
                  )}
                  {parcelData?.taxAmount && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Annual Taxes</span>
                      <p className="font-medium">{parcelData.taxAmount}</p>
                    </div>
                  )}
                </div>
              </div>

              {hasOwnerData && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
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
      </DialogContent>
    </Dialog>
    
    <PropertyAnalysisChat 
      property={currentProperty} 
      open={isAnalysisChatOpen} 
      onOpenChange={setIsAnalysisChatOpen} 
    />
    </>
  );
}

function DueDiligenceTab({ propertyId }: { propertyId: number }) {
  const { data: items, isLoading: isLoadingItems } = usePropertyDueDiligence(propertyId);
  const { data: templates, isLoading: isLoadingTemplates } = useDueDiligenceTemplates();
  const { mutate: applyTemplate, isPending: isApplyingTemplate } = useApplyDueDiligenceTemplate();
  const { mutate: updateItem, isPending: isUpdating } = useUpdateDueDiligenceItem();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [editingNotes, setEditingNotes] = useState<{ [key: number]: string }>({});

  const itemsByCategory = items?.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, DueDiligenceItem[]>) || {};

  const completedCount = items?.filter(item => item.completed).length || 0;
  const totalCount = items?.length || 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleApplyTemplate = () => {
    if (selectedTemplate) {
      applyTemplate({ propertyId, templateId: Number(selectedTemplate) });
    }
  };

  const handleToggleComplete = (item: DueDiligenceItem) => {
    updateItem({
      itemId: item.id,
      propertyId,
      updates: { completed: !item.completed },
    });
  };

  const handleSaveNotes = (item: DueDiligenceItem) => {
    const notes = editingNotes[item.id];
    if (notes !== undefined) {
      updateItem({
        itemId: item.id,
        propertyId,
        updates: { notes },
      });
      setEditingNotes(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoadingItems || isLoadingTemplates) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium mb-2">No Due Diligence Checklist</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Select a template to create a checklist for this property
          </p>
          <div className="flex items-center gap-2 justify-center flex-wrap">
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="w-[200px]" data-testid="select-template">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates?.map(template => (
                  <SelectItem key={template.id} value={String(template.id)}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              onClick={handleApplyTemplate} 
              disabled={!selectedTemplate || isApplyingTemplate}
              data-testid="button-apply-template"
            >
              {isApplyingTemplate ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Apply Template
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{completedCount} of {totalCount} completed</span>
            <span className="text-xs text-muted-foreground">({Math.round(progressPercent)}%)</span>
          </div>
          <Progress value={progressPercent} className="h-2" data-testid="progress-due-diligence" />
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-checklist">
          <Printer className="w-4 h-4 mr-2" />
          Print
        </Button>
      </div>

      <div className="space-y-6 print:space-y-4">
        {Object.entries(itemsByCategory).map(([category, categoryItems]) => (
          <div key={category} className="space-y-2">
            <h4 className="font-semibold text-sm border-b pb-1">{category}</h4>
            <div className="space-y-2">
              {categoryItems.map(item => (
                <div 
                  key={item.id} 
                  className={`flex items-start gap-3 p-3 rounded-md border ${item.completed ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-muted/50'}`}
                  data-testid={`dd-item-${item.id}`}
                >
                  <Checkbox
                    checked={item.completed}
                    onCheckedChange={() => handleToggleComplete(item)}
                    disabled={isUpdating}
                    data-testid={`checkbox-${item.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${item.completed ? 'line-through text-muted-foreground' : ''}`}>
                        {item.itemName}
                      </span>
                      {item.completed && item.completedAt && (
                        <Badge variant="outline" className="text-xs">
                          <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
                          {new Date(item.completedAt).toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    {editingNotes[item.id] !== undefined ? (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          value={editingNotes[item.id]}
                          onChange={(e) => setEditingNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Add notes..."
                          className="text-xs min-h-[60px]"
                          data-testid={`textarea-notes-${item.id}`}
                        />
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => setEditingNotes(prev => { const n = {...prev}; delete n[item.id]; return n; })}
                          >
                            Cancel
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={() => handleSaveNotes(item)}
                            disabled={isUpdating}
                            data-testid={`button-save-notes-${item.id}`}
                          >
                            Save Notes
                          </Button>
                        </div>
                      </div>
                    ) : item.notes ? (
                      <p 
                        className="text-xs text-muted-foreground mt-1 cursor-pointer hover:text-foreground"
                        onClick={() => setEditingNotes(prev => ({ ...prev, [item.id]: item.notes || "" }))}
                      >
                        {item.notes}
                      </p>
                    ) : (
                      <button 
                        className="text-xs text-muted-foreground mt-1 hover:text-foreground"
                        onClick={() => setEditingNotes(prev => ({ ...prev, [item.id]: "" }))}
                      >
                        + Add notes
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
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
    case "low": return "text-green-600";
    case "medium": return "text-yellow-600";
    case "high": return "text-red-600";
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
            title: "Property Enriched",
            description: "Property intelligence data has been updated successfully.",
          });
        },
        onError: (error: any) => {
          toast({
            title: "Enrichment Failed",
            description: error.message || "Failed to enrich property. Please try again.",
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
            <Brain className="w-5 h-5" />
            Property Intelligence
          </h3>
          {lastEnrichedAt && (
            <p className="text-xs text-muted-foreground" data-testid="text-last-enriched">
              Last updated: {new Date(lastEnrichedAt).toLocaleDateString()} at {new Date(lastEnrichedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button 
          onClick={handleRefresh}
          disabled={isEnriching || !property.latitude || !property.longitude}
          data-testid="button-refresh-intelligence"
        >
          {isEnriching ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enriching...</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-2" /> Refresh Intelligence</>
          )}
        </Button>
      </div>

      {/* Data Completeness Widget */}
      {hasData && (enrichmentData as any)?.completenessScore !== undefined && (
        <Card data-testid="card-completeness">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm">Data Completeness</h4>
              </div>
              <span className="text-lg font-bold tabular-nums">
                {(enrichmentData as any).completenessScore}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 mb-3">
              <div
                className={`h-2 rounded-full transition-all ${
                  (enrichmentData as any).completenessScore >= 80
                    ? "bg-green-500"
                    : (enrichmentData as any).completenessScore >= 50
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
                style={{ width: `${(enrichmentData as any).completenessScore}%` }}
              />
            </div>
            {(enrichmentData as any).completenessBreakdown && (
              <div className="grid grid-cols-4 gap-1 mt-2">
                {Object.entries((enrichmentData as any).completenessBreakdown as Record<string, boolean>).map(
                  ([key, value]) => (
                    <div
                      key={key}
                      className={`text-xs px-1.5 py-0.5 rounded text-center truncate ${
                        value ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
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
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h4 className="font-medium mb-2">Missing Coordinates</h4>
            <p className="text-sm text-muted-foreground">
              This property needs GPS coordinates to fetch intelligence data.
              Fetch the parcel data first to get coordinates.
            </p>
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h4 className="font-medium mb-2">No Intelligence Data</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Refresh Intelligence" to fetch environmental, hazard, and demographic data for this property.
            </p>
            <Button 
              onClick={handleRefresh}
              disabled={isEnriching}
              data-testid="button-fetch-intelligence"
            >
              {isEnriching ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Fetching...</>
              ) : (
                <><Brain className="w-4 h-4 mr-2" /> Fetch Intelligence</>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {enrichmentData?.scores && (
            <Card data-testid="card-scores">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-primary" />
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
                    <p className={`font-medium ${(enrichmentData.scores.riskScore ?? 0) > 50 ? "text-red-600" : (enrichmentData.scores.riskScore ?? 0) > 25 ? "text-yellow-600" : "text-green-600"}`}>
                      {enrichmentData.scores.riskScore ?? "N/A"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.hazards && (
            <Card data-testid="card-flood-zone">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Droplets className="w-4 h-4 text-blue-500" />
                  <h4 className="font-semibold">Flood & Water Risk</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="flood-zone-code">
                    <span className="text-muted-foreground">Flood Zone</span>
                    <Badge variant="outline">{enrichmentData.hazards.floodZone || "Unknown"}</Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="flood-risk-level">
                    <span className="text-muted-foreground">Flood Risk</span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.floodRisk)} className="capitalize">
                      {enrichmentData.hazards.floodRisk || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="wetlands-present">
                    <span className="text-muted-foreground">Wetlands Present</span>
                    <span className={enrichmentData.hazards.wetlandsPresent ? "text-yellow-600" : "text-green-600"}>
                      {enrichmentData.hazards.wetlandsPresent ? `Yes (${enrichmentData.hazards.wetlandsPercentage}%)` : "No"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {enrichmentData?.hazards && (
            <Card data-testid="card-natural-hazards">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <h4 className="font-semibold">Natural Hazards</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="earthquake-risk">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Mountain className="w-3 h-3" /> Earthquake
                    </span>
                    <Badge variant={getRiskBadgeVariant(enrichmentData.hazards.earthquakeRisk)} className="capitalize">
                      {enrichmentData.hazards.earthquakeRisk || "Unknown"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between" data-testid="wildfire-risk">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Flame className="w-3 h-3" /> Wildfire
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
                  <Leaf className="w-4 h-4 text-green-600" />
                  <h4 className="font-semibold">Environmental Factors</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="superfund-sites">
                    <span className="text-muted-foreground">EPA Sites Nearby</span>
                    <span className={enrichmentData.environment.epaFacilitiesNearby && enrichmentData.environment.epaFacilitiesNearby > 0 ? "text-yellow-600" : "text-green-600"}>
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
                      <span className={enrichmentData.environment.primeFarmland ? "text-green-600" : "text-muted-foreground"}>
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
                  <Building2 className="w-4 h-4 text-muted-foreground" />
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
                  <Users className="w-4 h-4 text-indigo-500" />
                  <h4 className="font-semibold">Demographics</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between" data-testid="population">
                    <span className="text-muted-foreground">Population</span>
                    <span>{enrichmentData.demographics.population?.toLocaleString() || "N/A"}</span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="median-income">
                    <span className="text-muted-foreground">Median Income</span>
                    <span>
                      {(enrichmentData.demographics.medianHouseholdIncome ?? enrichmentData.demographics.medianIncome)
                        ? `$${(enrichmentData.demographics.medianHouseholdIncome ?? enrichmentData.demographics.medianIncome)!.toLocaleString()}`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between" data-testid="median-home-value">
                    <span className="text-muted-foreground">Median Home Value</span>
                    <span>{enrichmentData.demographics.medianHomeValue 
                      ? `$${enrichmentData.demographics.medianHomeValue.toLocaleString()}` 
                      : "N/A"}
                    </span>
                  </div>
                  {enrichmentData.demographics.povertyRate !== undefined && (
                    <div className="flex items-center justify-between" data-testid="poverty-rate">
                      <span className="text-muted-foreground">Poverty Rate</span>
                      <span>{enrichmentData.demographics.povertyRate.toFixed(1)}%</span>
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
                  <Car className="w-4 h-4 text-muted-foreground" />
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
                        <span className={enrichmentData.transportation.hasPavedRoad ? "text-green-600" : "text-yellow-600"}>
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
                  <TreePine className="w-4 h-4 text-green-700" />
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
                  <Droplets className="w-4 h-4 text-cyan-500" />
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
                  <Mountain className="w-4 h-4 text-slate-500" />
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
                  <Thermometer className="w-4 h-4 text-orange-400" />
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
                  <Wheat className="w-4 h-4 text-yellow-600" />
                  <h4 className="font-semibold">Agricultural Values</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.agriculturalValues.countyAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">County Avg / Acre</span>
                      <span className="font-medium">${enrichmentData.agriculturalValues.countyAvgPerAcre.toLocaleString()}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.stateAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">State Avg / Acre</span>
                      <span>${enrichmentData.agriculturalValues.stateAvgPerAcre.toLocaleString()}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.nationalAvgPerAcre != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">National Avg / Acre</span>
                      <span>${enrichmentData.agriculturalValues.nationalAvgPerAcre.toLocaleString()}</span>
                    </div>
                  )}
                  {enrichmentData.agriculturalValues.dataYear && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Data Year</span>
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
                  <Leaf className="w-4 h-4 text-emerald-500" />
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
                  <Wheat className="w-4 h-4 text-amber-500" />
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
                  <Factory className="w-4 h-4 text-gray-500" />
                  <h4 className="font-semibold">EPA Facilities Nearby</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total Facilities</span>
                    <span className={enrichmentData.epaFacilities.totalCount && enrichmentData.epaFacilities.totalCount > 0 ? "text-yellow-600 font-medium" : "text-green-600"}>{enrichmentData.epaFacilities.totalCount ?? 0}</span>
                  </div>
                  {(enrichmentData.epaFacilities.superfundCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Superfund Sites</span>
                      <span className="text-red-600 font-medium">{enrichmentData.epaFacilities.superfundCount}</span>
                    </div>
                  )}
                  {(enrichmentData.epaFacilities.airViolationCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Air Violations</span>
                      <span className="text-orange-500">{enrichmentData.epaFacilities.airViolationCount}</span>
                    </div>
                  )}
                  {(enrichmentData.epaFacilities.hazWasteCount ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Hazardous Waste</span>
                      <span className="text-orange-500">{enrichmentData.epaFacilities.hazWasteCount}</span>
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
                  <Cloud className="w-4 h-4 text-blue-400" />
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
                  <Grid3x3 className="w-4 h-4 text-teal-600" />
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
                  <Waves className="w-4 h-4 text-blue-500" />
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
                  <Shield className="w-4 h-4 text-red-500" />
                  <h4 className="font-semibold">FEMA National Risk Index</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {enrichmentData.femaNri.compositeScore !== undefined && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Composite Risk Score</span>
                      <span className={`font-bold text-lg ${enrichmentData.femaNri.compositeScore > 70 ? "text-red-600" : enrichmentData.femaNri.compositeScore > 40 ? "text-yellow-600" : "text-green-600"}`}>
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
                  <Wheat className="w-4 h-4 text-green-600" />
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
        <Card className="border-yellow-200 dark:border-yellow-800" data-testid="card-errors">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <h4 className="font-semibold text-yellow-700 dark:text-yellow-400">Some data could not be fetched</h4>
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
