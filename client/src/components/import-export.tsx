import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Upload, 
  Download, 
  FileText, 
  Check, 
  X, 
  AlertTriangle, 
  Database,
  Loader2,
  FileDown,
  Users,
  Home,
  Briefcase,
  FileSpreadsheet
} from "lucide-react";

type EntityType = "leads" | "properties" | "deals";
type ExportEntityType = EntityType | "notes";

interface ImportPreviewRow {
  rowNumber: number;
  data: Record<string, string>;
  valid: boolean;
  errors: string[];
}

interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ImportPreviewRow[];
  columns: string[];
}

interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{
    row: number;
    data: Record<string, string>;
    error: string;
  }>;
}

export function ImportExportManager() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("import");
  const [selectedImportType, setSelectedImportType] = useState<EntityType>("leads");
  const [selectedExportType, setSelectedExportType] = useState<ExportEntityType>("leads");
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportFilters, setExportFilters] = useState({
    status: "",
    type: "",
    startDate: "",
    endDate: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: expectedColumns } = useQuery<{ columns: string[] }>({
    queryKey: ["/api/import", selectedImportType, "columns"],
    queryFn: async () => {
      const res = await fetch(`/api/import/${selectedImportType}/columns`);
      if (!res.ok) throw new Error("Failed to fetch columns");
      return res.json();
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/import/${selectedImportType}/preview`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to preview import");
      }
      return res.json() as Promise<ImportPreview>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setImportResult(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Preview failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/import/${selectedImportType}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to import");
      }
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setPreview(null);
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api", selectedImportType] });
      toast({
        title: "Import completed",
        description: `Successfully imported ${data.successCount} of ${data.totalRows} rows.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams();
      params.append("format", exportFormat);
      if (exportFilters.status) params.append("status", exportFilters.status);
      if (exportFilters.type) params.append("type", exportFilters.type);
      if (exportFilters.startDate) params.append("startDate", exportFilters.startDate);
      if (exportFilters.endDate) params.append("endDate", exportFilters.endDate);
      
      const url = `/api/export/${selectedExportType}?${params.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to export");
      }
      const blob = await res.blob();
      const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] 
        || `${selectedExportType}_export.${exportFormat}`;
      downloadBlob(blob, filename);
    },
    onSuccess: () => {
      toast({
        title: "Export completed",
        description: `${selectedExportType} exported successfully as ${exportFormat.toUpperCase()}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const backupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/export/backup", { credentials: "include" });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create backup");
      }
      const blob = await res.blob();
      const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] 
        || "backup.json";
      downloadBlob(blob, filename);
    },
    onSuccess: () => {
      toast({
        title: "Backup created",
        description: "Your data backup has been downloaded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Backup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      setSelectedFile(file);
      previewMutation.mutate(file);
    } else {
      toast({
        title: "Invalid file",
        description: "Please upload a CSV file.",
        variant: "destructive",
      });
    }
  }, [previewMutation, toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      previewMutation.mutate(file);
    }
  };

  const handleImportTypeChange = (value: EntityType) => {
    setSelectedImportType(value);
    setSelectedFile(null);
    setPreview(null);
    setImportResult(null);
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "leads": return <Users className="w-4 h-4" />;
      case "properties": return <Home className="w-4 h-4" />;
      case "deals": return <Briefcase className="w-4 h-4" />;
      case "notes": return <FileSpreadsheet className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5" />
          Import / Export Data
        </CardTitle>
        <CardDescription>
          Import data from CSV files or export your data for backup
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="import" data-testid="tab-import">
              <Upload className="w-4 h-4 mr-2" />
              Import
            </TabsTrigger>
            <TabsTrigger value="export" data-testid="tab-export">
              <Download className="w-4 h-4 mr-2" />
              Export
            </TabsTrigger>
            <TabsTrigger value="backup" data-testid="tab-backup">
              <Database className="w-4 h-4 mr-2" />
              Backup
            </TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="space-y-2">
                <Label htmlFor="import-type">Import Type</Label>
                <Select 
                  value={selectedImportType} 
                  onValueChange={(v) => handleImportTypeChange(v as EntityType)}
                >
                  <SelectTrigger 
                    id="import-type" 
                    className="w-[180px]"
                    data-testid="select-import-type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">
                      <span className="flex items-center gap-2">
                        <Users className="w-4 h-4" /> Leads
                      </span>
                    </SelectItem>
                    <SelectItem value="properties">
                      <span className="flex items-center gap-2">
                        <Home className="w-4 h-4" /> Properties
                      </span>
                    </SelectItem>
                    <SelectItem value="deals">
                      <span className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" /> Deals
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {expectedColumns && (
                <div className="flex-1">
                  <Label>Expected Columns</Label>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {expectedColumns.columns.map((col) => (
                      <Badge key={col} variant="secondary" className="text-xs">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div
              className={`border-2 border-dashed rounded-md p-8 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-testid="dropzone-import"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file-import"
              />
              <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag and drop a CSV file here, or
              </p>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={previewMutation.isPending}
                data-testid="button-select-file"
              >
                {previewMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4 mr-2" />
                )}
                Select File
              </Button>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>

            {preview && (
              <div className="space-y-4" data-testid="import-preview">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Badge variant="outline">
                      Total: {preview.totalRows} rows
                    </Badge>
                    <Badge variant="default" className="bg-green-500">
                      <Check className="w-3 h-3 mr-1" />
                      Valid: {preview.validRows}
                    </Badge>
                    {preview.invalidRows > 0 && (
                      <Badge variant="destructive">
                        <X className="w-3 h-3 mr-1" />
                        Invalid: {preview.invalidRows}
                      </Badge>
                    )}
                  </div>
                  <Button
                    onClick={() => selectedFile && importMutation.mutate(selectedFile)}
                    disabled={importMutation.isPending || preview.validRows === 0}
                    data-testid="button-confirm-import"
                  >
                    {importMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Import {preview.validRows} Valid Rows
                  </Button>
                </div>

                <ScrollArea className="h-[300px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead className="w-24">Status</TableHead>
                        {preview.columns.slice(0, 5).map((col) => (
                          <TableHead key={col}>{col}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map((row) => (
                        <TableRow 
                          key={row.rowNumber}
                          className={row.valid ? "" : "bg-destructive/10"}
                          data-testid={`row-preview-${row.rowNumber}`}
                        >
                          <TableCell className="font-mono text-xs">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell>
                            {row.valid ? (
                              <Badge variant="default" className="bg-green-500">
                                <Check className="w-3 h-3" />
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {row.errors.length}
                              </Badge>
                            )}
                          </TableCell>
                          {preview.columns.slice(0, 5).map((col) => (
                            <TableCell key={col} className="text-xs max-w-[150px] truncate">
                              {row.data[col] || "-"}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                {preview.invalidRows > 0 && (
                  <div className="space-y-2">
                    <Label className="text-destructive">Validation Errors</Label>
                    <div className="max-h-[150px] overflow-auto space-y-1">
                      {preview.rows
                        .filter((r) => !r.valid)
                        .map((row) => (
                          <div
                            key={row.rowNumber}
                            className="text-xs p-2 bg-destructive/10 rounded"
                            data-testid={`error-row-${row.rowNumber}`}
                          >
                            <span className="font-medium">Row {row.rowNumber}:</span>{" "}
                            {row.errors.join(", ")}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {importResult && (
              <div 
                className="p-4 bg-muted rounded-md space-y-2"
                data-testid="import-result"
              >
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500" />
                  <span className="font-medium">Import Complete</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span>Total: {importResult.totalRows}</span>
                  <span className="text-green-600">
                    Success: {importResult.successCount}
                  </span>
                  {importResult.errorCount > 0 && (
                    <span className="text-destructive">
                      Errors: {importResult.errorCount}
                    </span>
                  )}
                </div>
                {importResult.errors.length > 0 && (
                  <div className="mt-2 max-h-[100px] overflow-auto">
                    {importResult.errors.map((err, i) => (
                      <div key={i} className="text-xs text-destructive">
                        Row {err.row}: {err.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="export" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label htmlFor="export-type">Export Type</Label>
                <Select
                  value={selectedExportType}
                  onValueChange={(v) => setSelectedExportType(v as ExportEntityType)}
                >
                  <SelectTrigger 
                    id="export-type"
                    data-testid="select-export-type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leads">
                      <span className="flex items-center gap-2">
                        <Users className="w-4 h-4" /> Leads
                      </span>
                    </SelectItem>
                    <SelectItem value="properties">
                      <span className="flex items-center gap-2">
                        <Home className="w-4 h-4" /> Properties
                      </span>
                    </SelectItem>
                    <SelectItem value="deals">
                      <span className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4" /> Deals
                      </span>
                    </SelectItem>
                    <SelectItem value="notes">
                      <span className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4" /> Notes
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="export-format">Format</Label>
                <Select
                  value={exportFormat}
                  onValueChange={(v) => setExportFormat(v as "csv" | "json")}
                >
                  <SelectTrigger 
                    id="export-format"
                    data-testid="select-export-format"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">
                      <span className="flex items-center gap-2">
                        <FileText className="w-4 h-4" /> CSV
                      </span>
                    </SelectItem>
                    <SelectItem value="json">
                      <span className="flex items-center gap-2">
                        <FileText className="w-4 h-4" /> JSON
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-status">Status Filter</Label>
                <Input
                  id="filter-status"
                  placeholder="e.g., new, active"
                  value={exportFilters.status}
                  onChange={(e) =>
                    setExportFilters((f) => ({ ...f, status: e.target.value }))
                  }
                  data-testid="input-filter-status"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-start-date">Start Date</Label>
                <Input
                  id="filter-start-date"
                  type="date"
                  value={exportFilters.startDate}
                  onChange={(e) =>
                    setExportFilters((f) => ({ ...f, startDate: e.target.value }))
                  }
                  data-testid="input-filter-start-date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-end-date">End Date</Label>
                <Input
                  id="filter-end-date"
                  type="date"
                  value={exportFilters.endDate}
                  onChange={(e) =>
                    setExportFilters((f) => ({ ...f, endDate: e.target.value }))
                  }
                  data-testid="input-filter-end-date"
                />
              </div>
            </div>

            <Button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              data-testid="button-export"
            >
              {exportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4 mr-2" />
              )}
              Export {selectedExportType.charAt(0).toUpperCase() + selectedExportType.slice(1)} to {exportFormat.toUpperCase()}
            </Button>
          </TabsContent>

          <TabsContent value="backup" className="space-y-4">
            <div className="p-6 border rounded-md text-center space-y-4">
              <Database className="w-12 h-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="font-medium text-lg">Full Data Backup</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Download all your organization data including leads, properties,
                  deals, and notes in a single backup file.
                </p>
              </div>
              <Button
                size="lg"
                onClick={() => backupMutation.mutate()}
                disabled={backupMutation.isPending}
                data-testid="button-create-backup"
              >
                {backupMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                Create Backup
              </Button>
              <p className="text-xs text-muted-foreground">
                The backup will be downloaded as a JSON file containing all your data.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
