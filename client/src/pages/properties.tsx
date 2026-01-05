import { Sidebar } from "@/components/layout-sidebar";
import { useProperties, useCreateProperty, useDeleteProperty } from "@/hooks/use-properties";
import { queryClient } from "@/lib/queryClient";
import { ListSkeleton } from "@/components/list-skeleton";
import { useFetchPropertyParcel } from "@/hooks/use-parcels";
import { useState } from "react";
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

const propertyFormSchema = insertPropertySchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Ruler, DollarSign, Trash2, Loader2, Map as MapIcon, RefreshCw, FileText, Download, Upload, CheckCircle, AlertCircle, ClipboardCheck, Printer, Calculator, BarChart2 } from "lucide-react";
import { DealCalculator } from "@/components/deal-calculator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { SinglePropertyMap } from "@/components/property-map";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { CompsAnalysis } from "@/components/comps-analysis";
import { AIOfferGenerator } from "@/components/ai-offer-generator";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { DueDiligencePanel } from "@/components/due-diligence-panel";

export default function PropertiesPage() {
  const { data: properties, isLoading } = useProperties();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
        onSuccess: () => setDeletingProperty(null),
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
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Inventory</h1>
              <p className="text-muted-foreground">Track land parcels and their status.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                data-testid="button-export-properties"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export CSV
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsImportOpen(true)}
                data-testid="button-import-properties"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="shadow-lg hover:shadow-primary/25" data-testid="button-add-property">
                    <Plus className="w-4 h-4 mr-2" /> Add Property
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Add New Property</DialogTitle>
                  </DialogHeader>
                  <PropertyForm onSuccess={() => setIsCreateOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {isLoading ? (
            <div data-testid="skeleton-properties-grid">
              <ListSkeleton count={6} variant="card" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties?.map((property) => (
                <PropertyCard 
                  key={property.id} 
                  property={property} 
                  onDelete={() => setDeletingProperty(property)}
                />
              ))}
              {properties?.length === 0 && (
                <div className="col-span-full">
                  <EmptyState
                    icon={MapPin}
                    title="No properties yet"
                    description="Track your land inventory here. Add properties you're evaluating, under contract, or ready to sell."
                    secondaryDescription="Keep all your property details, due diligence, and comps in one place."
                    tips={[
                      "Add properties you're researching or have under contract",
                      "Run due diligence checklists to ensure nothing is missed",
                      "Use comps analysis to determine fair market value"
                    ]}
                    actionLabel="Add Your First Property"
                    onAction={() => setIsCreateOpen(true)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

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
    </div>
  );
}

function PropertyCard({ property, onDelete }: { property: Property; onDelete: () => void }) {
  const { mutate: fetchParcel, isPending: isFetchingParcel } = useFetchPropertyParcel();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const hasMapData = property.parcelBoundary && property.parcelCentroid;

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
      <div className="h-40 bg-slate-100 dark:bg-slate-900 relative overflow-hidden">
        {hasMapData ? (
          <SinglePropertyMap
            boundary={property.parcelBoundary}
            centroid={property.parcelCentroid}
            apn={property.apn}
            height="160px"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchParcel(property.id);
                }}
                disabled={isFetchingParcel}
                data-testid={`button-fetch-parcel-${property.id}`}
              >
                {isFetchingParcel ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Fetching...</>
                ) : (
                  <><MapIcon className="w-3 h-3 mr-1" /> Fetch Map</>
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 z-10">
          <Badge variant={property.status === 'available' ? 'default' : 'secondary'} className="capitalize shadow-sm text-xs">
            {property.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="absolute top-2 left-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="destructive" 
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`button-delete-property-${property.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button 
            variant="secondary" 
            size="icon"
            className="h-7 w-7"
            onClick={handleDownloadDeed}
            disabled={isDownloading}
            data-testid={`button-download-deed-${property.id}`}
          >
            {isDownloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
          </Button>
          {hasMapData && (
            <Button 
              variant="secondary" 
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                fetchParcel(property.id);
              }}
              disabled={isFetchingParcel}
              data-testid={`button-refresh-parcel-${property.id}`}
            >
              <RefreshCw className={`w-3 h-3 ${isFetchingParcel ? 'animate-spin' : ''}`} />
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
        </div>
        <div className="mt-3 pt-3 border-t flex items-center justify-between gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setIsDetailOpen(true)}
            className="flex-1"
            data-testid={`button-view-details-${property.id}`}
          >
            <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" />
            Due Diligence
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => setIsCalculatorOpen(true)}
            data-testid={`button-calculator-${property.id}`}
          >
            <Calculator className="w-3.5 h-3.5" />
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
    mutate(data, { onSuccess });
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            {property.county}, {property.state}
          </DialogTitle>
          <DialogDescription>
            APN: {property.apn} - {property.sizeAcres} Acres
          </DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="comps" data-testid="tab-comps">
              <BarChart2 className="w-3.5 h-3.5 mr-1" />
              Comps
            </TabsTrigger>
            <TabsTrigger value="ai-offer" data-testid="tab-ai-offer">
              <Calculator className="w-3.5 h-3.5 mr-1" />
              AI Offer
            </TabsTrigger>
            <TabsTrigger value="due-diligence" data-testid="tab-due-diligence">Due Diligence</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Status:</span>
                <Badge variant="outline" className="ml-2 capitalize">{property.status.replace('_', ' ')}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Zoning:</span>
                <span className="ml-2">{property.zoning || "N/A"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Market Value:</span>
                <span className="ml-2">${Number(property.marketValue || 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Purchase Price:</span>
                <span className="ml-2">${Number(property.purchasePrice || 0).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Road Access:</span>
                <span className="ml-2 capitalize">{property.roadAccess || "N/A"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Terrain:</span>
                <span className="ml-2 capitalize">{property.terrain || "N/A"}</span>
              </div>
            </div>
            {property.description && (
              <div className="pt-2">
                <span className="text-muted-foreground text-sm">Description:</span>
                <p className="text-sm mt-1">{property.description}</p>
              </div>
            )}
            
            <div className="pt-4">
              <CustomFieldValuesEditor entityType="property" entityId={property.id} />
            </div>
          </TabsContent>
          
          <TabsContent value="comps" className="mt-4">
            <CompsAnalysis property={property} />
          </TabsContent>
          
          <TabsContent value="ai-offer" className="mt-4">
            <AIOfferGenerator property={property} />
          </TabsContent>
          
          <TabsContent value="due-diligence" className="mt-4">
            <DueDiligencePanel propertyId={property.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
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
