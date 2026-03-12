import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

const ACREOS_NOTE_FIELDS = [
  { value: "borrowerFirstName", label: "Borrower First Name *" },
  { value: "borrowerLastName", label: "Borrower Last Name *" },
  { value: "borrowerEmail", label: "Borrower Email" },
  { value: "borrowerPhone", label: "Borrower Phone" },
  { value: "originalPrincipal", label: "Original Principal *" },
  { value: "currentBalance", label: "Current Balance" },
  { value: "interestRate", label: "Interest Rate" },
  { value: "termMonths", label: "Term (Months)" },
  { value: "monthlyPayment", label: "Monthly Payment" },
  { value: "paymentDayOfMonth", label: "Payment Day of Month" },
  { value: "serviceFee", label: "Service Fee" },
  { value: "lateFeeAmount", label: "Late Fee Amount" },
  { value: "gracePeriodDays", label: "Grace Period (Days)" },
  { value: "status", label: "Status" },
  { value: "propertyAddress", label: "Property Address" },
  { value: "internalNotes", label: "Internal Notes" },
  { value: "__skip__", label: "— Skip this column —" },
];

// Auto-detect AcreOS field from a raw CSV column header
function autoDetectField(csvCol: string): string {
  const lower = csvCol.toLowerCase().replace(/[_\s-]+/g, "");
  if (lower.includes("borrowerfirst") || lower === "firstname") return "borrowerFirstName";
  if (lower.includes("borrowerlast") || lower === "lastname") return "borrowerLastName";
  if (lower.includes("email")) return "borrowerEmail";
  if (lower.includes("phone")) return "borrowerPhone";
  if (lower.includes("notea") || lower.includes("originalprincipal") || lower === "principal" || lower === "amount") return "originalPrincipal";
  if (lower.includes("currentbalance") || lower === "balance") return "currentBalance";
  if (lower.includes("interestrate") || lower === "rate") return "interestRate";
  if (lower.includes("term")) return "termMonths";
  if (lower.includes("monthlypayment") || lower === "payment") return "monthlyPayment";
  if (lower.includes("paymentday")) return "paymentDayOfMonth";
  if (lower.includes("servicefee")) return "serviceFee";
  if (lower.includes("latefee")) return "lateFeeAmount";
  if (lower.includes("grace")) return "gracePeriodDays";
  if (lower === "status") return "status";
  if (lower.includes("address")) return "propertyAddress";
  if (lower === "notes" || lower === "comments" || lower === "comment") return "internalNotes";
  return "__skip__";
}

type Step = "upload" | "map" | "importing" | "done";

interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; error: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotesImportDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("upload");
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStep("upload");
    setCsvColumns([]);
    setPreviewRows([]);
    setFieldMap({});
    setFile(null);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleFileChange = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) {
        toast({ title: "Invalid CSV", description: "File must have a header row and at least one data row.", variant: "destructive" });
        return;
      }
      // Parse header
      const headerLine = lines[0];
      const cols = headerLine.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      setCsvColumns(cols);

      // Parse up to 3 preview rows
      const rows: Record<string, string>[] = [];
      for (let i = 1; i <= Math.min(3, lines.length - 1); i++) {
        const vals = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        const row: Record<string, string> = {};
        cols.forEach((col, idx) => { row[col] = vals[idx] || ""; });
        rows.push(row);
      }
      setPreviewRows(rows);

      // Auto-detect field mappings
      const detected: Record<string, string> = {};
      cols.forEach((col) => { detected[col] = autoDetectField(col); });
      setFieldMap(detected);
      setStep("map");
    };
    reader.readAsText(f);
  }, [toast]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      // Exclude __skip__ mappings
      const effectiveMap: Record<string, string> = {};
      for (const [col, field] of Object.entries(fieldMap)) {
        if (field && field !== "__skip__") effectiveMap[col] = field;
      }
      formData.append("fieldMap", JSON.stringify(effectiveMap));

      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/import/notes", {
        method: "POST",
        headers: { "x-csrf-token": decodeURIComponent(csrfToken) },
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Import failed" }));
        throw new Error(err.message || "Import failed");
      }
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/money/notes"] });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
      setStep("map");
    },
  });

  const handleImport = () => {
    setStep("importing");
    importMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Import Notes from CSV
          </DialogTitle>
          <DialogDescription>
            Import seller-financed notes from GeekPay or any CSV file. We'll auto-detect your
            columns — review the mapping before importing.
          </DialogDescription>
        </DialogHeader>

        {/* Step: Upload */}
        {step === "upload" && (
          <div className="space-y-4 py-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFileChange(f);
              }}
              onClick={() => document.getElementById("notes-csv-input")?.click()}
            >
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium mb-1">Drop your CSV here or click to browse</p>
              <p className="text-sm text-muted-foreground">
                Supports GeekPay exports and any CSV with note data
              </p>
              <input
                id="notes-csv-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              />
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 space-y-1">
              <p className="font-medium text-foreground">GeekPay export instructions:</p>
              <p>1. Log in to GeekPay → Notes → Export CSV</p>
              <p>2. Upload the downloaded file here</p>
              <p>3. Review the field mapping in the next step</p>
            </div>
          </div>
        )}

        {/* Step: Field mapping */}
        {step === "map" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span className="font-medium text-foreground">{file?.name}</span>
              <span>· {previewRows.length > 0 ? "Preview ready" : ""}</span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-3 bg-muted/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                <div>CSV column</div>
                <div>Sample value</div>
                <div>Map to AcreOS field</div>
              </div>
              <div className="divide-y divide-border/50 max-h-64 overflow-y-auto">
                {csvColumns.map((col) => (
                  <div key={col} className="grid grid-cols-3 px-4 py-2.5 items-center gap-2">
                    <div className="text-sm font-medium truncate" title={col}>{col}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {previewRows[0]?.[col] || "—"}
                    </div>
                    <Select
                      value={fieldMap[col] || "__skip__"}
                      onValueChange={(val) => setFieldMap((prev) => ({ ...prev, [col]: val }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACREOS_NOTE_FIELDS.map((f) => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Fields marked * are required. Columns mapped to "Skip" will be ignored.
            </p>
          </div>
        )}

        {/* Step: Importing */}
        {step === "importing" && (
          <div className="py-12 flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="font-medium">Importing notes…</p>
            <p className="text-sm text-muted-foreground">
              Creating borrower profiles and note records.
            </p>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && result && (
          <div className="py-6 space-y-5">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Import complete</p>
                <p className="text-sm text-muted-foreground">
                  {result.successCount} of {result.totalRows} notes imported successfully.
                  {result.errorCount > 0 && ` ${result.errorCount} rows had errors.`}
                </p>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> Rows with errors
                </p>
                <div className="rounded-lg border border-destructive/20 divide-y divide-border/50 max-h-40 overflow-y-auto">
                  {result.errors.slice(0, 20).map((e) => (
                    <div key={e.row} className="px-3 py-2 text-xs">
                      <span className="font-medium">Row {e.row}:</span>{" "}
                      <span className="text-muted-foreground">{e.error}</span>
                    </div>
                  ))}
                  {result.errors.length > 20 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      …and {result.errors.length - 20} more
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "upload" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "map" && (
            <>
              <Button variant="outline" onClick={() => setStep("upload")}>
                ← Back
              </Button>
              <Button onClick={handleImport}>
                Import {csvColumns.length > 0 ? "notes" : ""}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
