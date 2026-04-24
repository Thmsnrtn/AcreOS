import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle, 
  XCircle,
  ArrowRight,
  Download
} from "lucide-react";

const TAX_DELINQUENT_COLUMNS = [
  { key: 'parcel_id', label: 'Parcel ID', required: false },
  { key: 'owner_name', label: 'Owner name', required: true },
  { key: 'mailing_address', label: 'Mailing address', required: false },
  { key: 'property_address', label: 'Property address', required: false },
  { key: 'assessed_value', label: 'Assessed value', required: false },
  { key: 'taxes_owed', label: 'Taxes owed', required: false },
  { key: 'tax_year', label: 'Tax year', required: false },
  { key: 'county', label: 'County', required: false },
  { key: 'state', label: 'State', required: false },
];

type ColumnMapping = Record<string, string>;

interface TaxDelinquentImporterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaxDelinquentImporter({ open, onOpenChange }: TaxDelinquentImporterProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview' | 'importing' | 'complete'>('upload');
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [importResult, setImportResult] = useState<{ successCount: number; errorCount: number; errors: any[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
      const values = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || '';
      });
      return row;
    });
  };

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({
        title: "Invalid file type",
        description: "Only CSV files are supported — no data was imported. Choose a .csv file and try again.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const data = parseCSV(text);

      if (data.length === 0) {
        toast({
          title: "Empty file",
          description: "The CSV file has no data rows — no leads were imported.",
          variant: "destructive",
        });
        return;
      }
      
      const headers = Object.keys(data[0]);
      setCsvData(data);
      setCsvHeaders(headers);
      
      const autoMapping: ColumnMapping = {};
      TAX_DELINQUENT_COLUMNS.forEach(col => {
        const match = headers.find(h => 
          h.toLowerCase().includes(col.key.replace(/_/g, ' ')) ||
          h.toLowerCase().includes(col.key.replace('_', '')) ||
          h.toLowerCase() === col.key.replace(/_/g, ' ') ||
          h.toLowerCase() === col.key
        );
        if (match) {
          autoMapping[col.key] = match;
        }
      });
      setColumnMapping(autoMapping);
      setStep('mapping');
    };
    reader.readAsText(file);
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const getMappedData = () => {
    return csvData.map(row => {
      const mappedRow: Record<string, string> = {};
      Object.entries(columnMapping).forEach(([targetCol, sourceCol]) => {
        if (sourceCol) {
          mappedRow[targetCol] = row[sourceCol] || '';
        }
      });
      return mappedRow;
    });
  };

  const importMutation = useMutation({
    mutationFn: async (mappedData: Record<string, string>[]) => {
      const res = await apiRequest('POST', '/api/leads/import/tax-delinquent', { mappedData, columnMapping });
      return res.json() as Promise<{ successCount: number; errorCount: number; errors: any[] }>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      setStep('complete');
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't import tax-delinquent list",
        description: `${err.message} — no leads were imported. Review the file and try again.`,
        variant: "destructive",
      });
      setStep('preview');
    },
  });

  const handleImport = () => {
    setStep('importing');
    const mappedData = getMappedData();
    importMutation.mutate(mappedData);
  };

  const resetImporter = () => {
    setStep('upload');
    setCsvData([]);
    setCsvHeaders([]);
    setColumnMapping({});
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetImporter();
    onOpenChange(false);
  };

  const isRequiredMappingComplete = () => {
    return TAX_DELINQUENT_COLUMNS
      .filter(c => c.required)
      .every(c => columnMapping[c.key]);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-y-auto" data-testid="dialog-tax-delinquent-import">
        <DialogHeader>
          <DialogTitle>Import tax-delinquent list</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing tax-delinquent property records to import as leads.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4 py-4">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              data-testid="dropzone-tax-delinquent"
            >
              <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
              <label className="cursor-pointer block min-h-11">
                <span className="text-sm text-muted-foreground">
                  Drag and drop your CSV file here, or click to browse
                </span>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                  aria-label="Tax-delinquent CSV file"
                  data-testid="input-tax-delinquent-file"
                />
              </label>
              <p className="text-xs text-muted-foreground mt-2">Max <span className="tabular-nums">500</span> rows per import.</p>
            </div>

            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium mb-2">Expected columns</p>
              <ul className="flex flex-wrap gap-2" aria-label="Expected CSV columns">
                {TAX_DELINQUENT_COLUMNS.map(col => (
                  <li key={col.key}>
                    <Badge variant="outline" className="text-xs">
                      {col.label}
                      {col.required && <span className="text-destructive ml-1" aria-label="required">*</span>}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Map your CSV columns</p>
              <Badge aria-label={`${csvData.length} rows in file`}>
                <span className="tabular-nums">{csvData.length}</span> rows
              </Badge>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {TAX_DELINQUENT_COLUMNS.map(col => (
                <div key={col.key} className="flex items-center gap-4">
                  <div className="w-1/3">
                    <span className="text-sm font-medium">
                      {col.label}
                      {col.required && <span className="text-destructive ml-1" aria-label="required">*</span>}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  <Select
                    value={columnMapping[col.key] || 'unmapped'}
                    onValueChange={(value) => {
                      setColumnMapping(prev => ({
                        ...prev,
                        [col.key]: value === 'unmapped' ? '' : value
                      }));
                    }}
                  >
                    <SelectTrigger
                      className="flex-1"
                      aria-label={`Map ${col.label}${col.required ? ' (required)' : ''} to a CSV column`}
                      data-testid={`select-map-${col.key}`}
                    >
                      <SelectValue placeholder="Select column…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unmapped">— Not mapped —</SelectItem>
                      {csvHeaders.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <DialogFooter className="flex gap-2">
              <Button variant="outline" className="min-h-11" onClick={resetImporter}>
                Back
              </Button>
              <Button
                onClick={() => setStep('preview')}
                disabled={!isRequiredMappingComplete()}
                className="min-h-11"
                data-testid="button-preview-mapping"
              >
                Preview data
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Preview (first <span className="tabular-nums">10</span> rows)</p>
              <Badge>
                <span className="tabular-nums">{csvData.length}</span> total rows
              </Badge>
            </div>

            <div className="border rounded-lg overflow-x-auto" role="region" tabIndex={0} aria-label="Mapped CSV preview">
              <Table>
                <TableHeader>
                  <TableRow>
                    {TAX_DELINQUENT_COLUMNS.filter(c => columnMapping[c.key]).map(col => (
                      <TableHead key={col.key} scope="col" className="text-xs whitespace-nowrap">
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getMappedData().slice(0, 10).map((row, idx) => (
                    <TableRow key={idx} data-testid={`preview-row-${idx}`}>
                      {TAX_DELINQUENT_COLUMNS.filter(c => columnMapping[c.key]).map(col => (
                        <TableCell key={col.key} className="text-xs max-w-[150px] truncate">
                          {row[col.key] || '—'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="flex gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => setStep('mapping')}>
                Back
              </Button>
              <Button onClick={handleImport} className="min-h-11" data-testid="button-import-tax-delinquent">
                <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                Import <span className="tabular-nums mx-1">{csvData.length}</span> leads
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4 py-8 text-center" role="status" aria-live="polite">
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Importing tax-delinquent records…</p>
            <p className="text-xs text-muted-foreground">This may take a moment for large files.</p>
            <Progress value={undefined} className="w-full" aria-label="Importing" />
          </div>
        )}

        {step === 'complete' && importResult && (
          <div className="space-y-4 py-4">
            <div className="text-center py-4" role="status" aria-live="polite">
              {importResult.errorCount === 0 ? (
                <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-500" aria-hidden="true" />
              ) : (
                <XCircle className="w-12 h-12 mx-auto mb-4 text-amber-500" aria-hidden="true" />
              )}
              <h3 className="text-lg font-semibold mb-2">Import complete</h3>
              <p className="text-sm text-muted-foreground">
                Successfully imported <span className="tabular-nums">{importResult.successCount}</span> lead{importResult.successCount === 1 ? "" : "s"}
                {importResult.errorCount > 0 && <> (<span className="tabular-nums">{importResult.errorCount}</span> error{importResult.errorCount === 1 ? "" : "s"})</>}.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <dd className="text-2xl font-bold text-emerald-600 tabular-nums" data-testid="text-import-success-count">
                  {importResult.successCount}
                </dd>
                <dt className="text-xs text-muted-foreground">Imported</dt>
              </div>
              <div className="text-center">
                <dd className="text-2xl font-bold text-red-600 tabular-nums" data-testid="text-import-error-count">
                  {importResult.errorCount}
                </dd>
                <dt className="text-xs text-muted-foreground">Errors</dt>
              </div>
            </dl>

            {importResult.errors && importResult.errors.length > 0 && (
              <div className="border rounded-lg p-4 max-h-[150px] overflow-y-auto" role="alert">
                <p className="text-xs font-medium mb-2">Errors</p>
                {importResult.errors.slice(0, 10).map((err, idx) => (
                  <p key={idx} className="text-xs text-destructive">
                    Row <span className="tabular-nums">{err.row}</span>: {err.error}
                  </p>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button onClick={handleClose} className="min-h-11" data-testid="button-close-import">
                <CheckCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
