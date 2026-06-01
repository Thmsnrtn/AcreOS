/**
 * /notes/import — tape-import flow for note investors.
 *
 * Rachel: "Monday tape review (NoteTrader + Paperstac drops). Tuesday I
 * order BPOs on the diligence shortlist. Without bulk-create on the
 * pipeline, every tape is a retype-300-rows-by-hand job."
 *
 * Flow:
 *   1. Drop a CSV (or paste rows). XLSX users export to CSV first — we
 *      don't bundle the XLSX parser; the format isn't standard across
 *      tape vendors anyway.
 *   2. Auto-detect columns against NoteTrader / Paperstac field names.
 *      Confirm the map; sample row preview rides alongside.
 *   3. Choose a funding pool (free-form) and a source label (broker /
 *      tape vendor / individual).
 *   4. Submit — every row lands as a note_acquisitions row at stage
 *      'sourcing' with the standard diligence checklist pre-populated.
 *
 * Server endpoint: POST /api/note-acquisitions/tape-import
 */

import { useState, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Layers,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

// Acquisition row shape posted to the server. Mirrors the route's
// `tapeRowSchema` — keep in sync.
interface AcquisitionRow {
  payerName: string;
  propertyAddress?: { line1?: string; city?: string; state?: string; zip?: string };
  sourcedFrom?: string;
  proposedFaceValueCents?: number;
  proposedAcquisitionPriceCents?: number;
  bpoValueCents?: number;
  interestRateBps?: number;
  termMonths?: number;
  internalNotes?: string;
}

// Field IDs that the mapping UI lets the user assign columns to.
type FieldId =
  | "payerName"
  | "addressLine1"
  | "addressCity"
  | "addressState"
  | "addressZip"
  | "proposedFaceValueCents"
  | "proposedAcquisitionPriceCents"
  | "bpoValueCents"
  | "interestRateBps"
  | "termMonths"
  | "internalNotes"
  | "__skip__";

const FIELDS: Array<{ value: FieldId; label: string; required?: boolean }> = [
  { value: "payerName", label: "Borrower / payer *", required: true },
  { value: "addressLine1", label: "Property address line 1" },
  { value: "addressCity", label: "Property city" },
  { value: "addressState", label: "Property state" },
  { value: "addressZip", label: "Property zip" },
  { value: "proposedFaceValueCents", label: "Face value (UPB) — dollars" },
  { value: "proposedAcquisitionPriceCents", label: "Ask / proposed price — dollars" },
  { value: "bpoValueCents", label: "BPO value — dollars" },
  { value: "interestRateBps", label: "Interest rate (e.g. 8.5)" },
  { value: "termMonths", label: "Term (months)" },
  { value: "internalNotes", label: "Notes / comments" },
  { value: "__skip__", label: "— Skip this column —" },
];

// Auto-detect against NoteTrader / Paperstac column conventions and
// generic seller-tape headers.
function autoDetect(csvCol: string): FieldId {
  const k = csvCol.toLowerCase().replace(/[_\s\-/.]+/g, "");
  if (!k) return "__skip__";
  if (k.includes("borrower") || k === "payer" || k === "payername" || k.includes("obligor") || k === "name") return "payerName";
  if (k.includes("street") || k === "address" || k === "addressline1" || k === "address1" || k === "propertyaddress") return "addressLine1";
  if (k === "city") return "addressCity";
  if (k === "state" || k === "st") return "addressState";
  if (k === "zip" || k === "zipcode" || k === "postal" || k === "postalcode") return "addressZip";
  if (k === "facevalue" || k === "upb" || k === "balance" || k === "currentbalance" || k === "principal" || k === "currentprincipal") return "proposedFaceValueCents";
  if (k === "ask" || k === "askprice" || k === "askingprice" || k === "price" || k === "proposedprice" || k === "offerprice") return "proposedAcquisitionPriceCents";
  if (k === "bpo" || k === "bpovalue" || k === "valuation" || k === "marketvalue") return "bpoValueCents";
  if (k === "interestrate" || k === "rate" || k === "intrate" || k === "couponrate") return "interestRateBps";
  if (k === "term" || k === "termmonths" || k === "remainingterm" || k === "remainingmonths") return "termMonths";
  if (k === "notes" || k === "comments" || k === "comment" || k === "remarks") return "internalNotes";
  return "__skip__";
}

// Minimal CSV parser — handles quoted fields with commas. Same shape as
// the server-side parseCSV. We don't ship XLSX support in the browser.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row.");
  }
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (vals[idx] ?? "").replace(/^"|"$/g, "");
    });
    rows.push(row);
  }
  return { headers, rows };
}

// "$15,000.00" / "15000" → 1500000 cents. Returns undefined on empty / NaN.
function parseDollarsToCents(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

// "8.5" / "8.5%" / "850" (already bps) — heuristic: values < 100 are
// treated as percent and converted to bps.
function parseRateToBps(s: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[%\s]/g, "");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (n < 100) return Math.round(n * 100);
  return Math.round(n);
}

function parseIntSafe(s: string): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s.replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

interface ImportResult {
  totalRows: number;
  createdCount: number;
  created: Array<{ id: string; payerName: string }>;
}

type Step = "upload" | "map" | "submitting" | "done";

export default function NotesImportPage() {
  useDocumentTitle("Import note tape — AcreOS");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, FieldId>>({});
  const [defaultSourcedFrom, setDefaultSourcedFrom] = useState("");
  const [defaultFundingPoolId, setDefaultFundingPoolId] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setFieldMap({});
    setResult(null);
  };

  const handleFile = useCallback(
    (f: File | null) => {
      if (!f) return;
      setFile(f);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const { headers, rows } = parseCsv(text);
          if (rows.length === 0) {
            toast({
              title: "Empty file",
              description: "Need at least one data row.",
              variant: "destructive",
            });
            return;
          }
          setCsvHeaders(headers);
          setCsvRows(rows);
          const detected: Record<string, FieldId> = {};
          headers.forEach((h) => {
            detected[h] = autoDetect(h);
          });
          setFieldMap(detected);
          setStep("map");
        } catch (err: any) {
          toast({
            title: "Couldn't parse CSV",
            description: err?.message ?? "Check the file format.",
            variant: "destructive",
          });
        }
      };
      reader.readAsText(f);
    },
    [toast],
  );

  // Map column→field and assemble the post body. Skipped columns and
  // unmapped fields are simply absent from each row object.
  const mapped: AcquisitionRow[] = useMemo(() => {
    if (csvRows.length === 0) return [];
    return csvRows.map((row) => {
      const out: AcquisitionRow = { payerName: "" };
      const addr: { line1?: string; city?: string; state?: string; zip?: string } = {};
      let hasAddr = false;
      for (const [col, field] of Object.entries(fieldMap)) {
        const v = (row[col] ?? "").trim();
        if (!v || field === "__skip__") continue;
        switch (field) {
          case "payerName":
            out.payerName = v;
            break;
          case "addressLine1":
            addr.line1 = v;
            hasAddr = true;
            break;
          case "addressCity":
            addr.city = v;
            hasAddr = true;
            break;
          case "addressState":
            addr.state = v.slice(0, 2).toUpperCase();
            hasAddr = true;
            break;
          case "addressZip":
            addr.zip = v;
            hasAddr = true;
            break;
          case "proposedFaceValueCents":
            out.proposedFaceValueCents = parseDollarsToCents(v);
            break;
          case "proposedAcquisitionPriceCents":
            out.proposedAcquisitionPriceCents = parseDollarsToCents(v);
            break;
          case "bpoValueCents":
            out.bpoValueCents = parseDollarsToCents(v);
            break;
          case "interestRateBps":
            out.interestRateBps = parseRateToBps(v);
            break;
          case "termMonths":
            out.termMonths = parseIntSafe(v);
            break;
          case "internalNotes":
            out.internalNotes = v;
            break;
        }
      }
      if (hasAddr) out.propertyAddress = addr;
      return out;
    });
  }, [csvRows, fieldMap]);

  const validRows = mapped.filter((r) => r.payerName && r.payerName.trim().length > 0);
  const invalidCount = mapped.length - validRows.length;

  const importMutation = useMutation({
    mutationFn: async () => {
      const csrf =
        document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch("/api/note-acquisitions/tape-import", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrf),
        },
        body: JSON.stringify({
          rows: validRows,
          defaultSourcedFrom: defaultSourcedFrom.trim() || undefined,
          defaultFundingPoolId: defaultFundingPoolId.trim() || undefined,
          seedChecklist: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.message || `Import failed (${res.status})`);
      }
      return json as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/note-acquisitions"] });
      toast({
        title: "Tape imported",
        description: `${data.createdCount} acquisition${data.createdCount === 1 ? "" : "s"} at sourcing.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Import failed",
        description: err.message,
        variant: "destructive",
      });
      setStep("map");
    },
  });

  const handleSubmit = () => {
    if (validRows.length === 0) {
      toast({
        title: "Nothing to import",
        description: "Map the borrower column before submitting.",
        variant: "destructive",
      });
      return;
    }
    setStep("submitting");
    importMutation.mutate();
  };

  return (
    <PageShell label="Import note tape">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Import note tape</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Drop a NoteTrader / Paperstac CSV (or any tape export). Every row
          lands in the acquisition pipeline at <span className="font-mono text-xs">sourcing</span>{" "}
          with the standard diligence checklist pre-populated, so you can walk
          BPO ordering on Tuesday without retyping.
        </p>
      </div>

      {/* Step: upload */}
      {step === "upload" && (
        <Card>
          <div className="p-6 space-y-4">
            <button
              type="button"
              className="w-full border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
              onClick={() => document.getElementById("tape-csv-input")?.click()}
              aria-label="Upload CSV tape: drop a file here or activate to browse"
              data-testid="tape-dropzone"
            >
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
              <p className="font-medium mb-1">Drop your tape CSV here or click to browse</p>
              <p className="text-sm text-muted-foreground">
                NoteTrader / Paperstac / generic CSV. XLSX: export to CSV first.
              </p>
            </button>
            <input
              id="tape-csv-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
            />
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-card p-3 space-y-1">
              <p className="font-medium text-foreground">What you'll get:</p>
              <p>
                Each row creates a <span className="font-mono">note_acquisitions</span> row at{" "}
                <span className="font-mono">stage='sourcing'</span> with diligence
                checklist (note copy, mortgage/DOT, payment history, title commitment,
                prior assignments, borrower verification, lien position) pre-populated
                but unchecked.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Step: map */}
      {step === "map" && (
        <Card>
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{file?.name ?? "(no file)"}</span>
                <span className="text-muted-foreground">
                  · {csvRows.length} row{csvRows.length === 1 ? "" : "s"} · {validRows.length} valid
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                data-testid="tape-restart"
              >
                Start over
              </Button>
            </div>

            <Separator />

            {/* Defaults for sourcedFrom + fundingPoolId. Both apply when a row
                doesn't carry its own value. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sourcedFrom">Source label (default)</Label>
                <Input
                  id="sourcedFrom"
                  placeholder="NoteTrader / Paperstac / broker name"
                  value={defaultSourcedFrom}
                  onChange={(e) => setDefaultSourcedFrom(e.target.value)}
                  data-testid="tape-default-sourced"
                />
                <p className="text-xs text-muted-foreground">
                  Stamped on every row's <span className="font-mono">sourcedFrom</span>.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fundingPool" className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  Funding pool (default)
                </Label>
                <Input
                  id="fundingPool"
                  placeholder="Fund I / Bridge / JV-Henderson"
                  value={defaultFundingPoolId}
                  onChange={(e) => setDefaultFundingPoolId(e.target.value)}
                  data-testid="tape-default-pool"
                />
                <p className="text-xs text-muted-foreground">
                  Tags every acquisition with the LP fund source for per-LP P&L
                  roll-ups. Free-form until the Pool entity ships.
                </p>
              </div>
            </div>

            <Separator />

            <div>
              <p className="text-sm font-medium mb-2">Map your columns</p>
              <div className="rounded-card border border-border overflow-hidden">
                <div className="grid grid-cols-3 bg-muted/50 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
                  <div>CSV column</div>
                  <div>Sample value</div>
                  <div>Map to AcreOS field</div>
                </div>
                <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
                  {csvHeaders.map((col) => (
                    <div
                      key={col}
                      className="grid grid-cols-3 px-4 py-2.5 items-center gap-2"
                    >
                      <div className="text-sm font-medium truncate" title={col}>
                        {col}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {csvRows[0]?.[col] || "—"}
                      </div>
                      <Select
                        value={fieldMap[col] || "__skip__"}
                        onValueChange={(val) =>
                          setFieldMap((prev) => ({ ...prev, [col]: val as FieldId }))
                        }
                      >
                        <SelectTrigger
                          className="h-8 text-xs"
                          data-testid={`tape-map-${col}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELDS.map((f) => (
                            <SelectItem
                              key={f.value}
                              value={f.value}
                              className="text-xs"
                            >
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Borrower / payer is required. Dollar fields accept "$15,000" or
                "15000"; rate fields accept "8.5" or "8.5%".
              </p>
              {invalidCount > 0 && (
                <p className="text-xs text-acr-warning mt-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {invalidCount} row{invalidCount === 1 ? "" : "s"} missing a borrower
                  name — those will be skipped.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button variant="outline" onClick={() => setStep("upload")}>
                <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={validRows.length === 0}
                data-testid="tape-submit"
              >
                Create {validRows.length} acquisition{validRows.length === 1 ? "" : "s"}
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step: submitting */}
      {step === "submitting" && (
        <Card>
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="p-10 flex flex-col items-center gap-4"
          >
            <Loader2 className="w-10 h-10 text-primary animate-spin" aria-hidden="true" />
            <p className="font-medium">Creating acquisitions…</p>
            <p className="text-sm text-muted-foreground">
              {validRows.length} row{validRows.length === 1 ? "" : "s"} into pipeline.
            </p>
          </div>
        </Card>
      )}

      {/* Step: done */}
      {step === "done" && result && (
        <Card className="border-acr-pos/30 bg-acr-pos/5">
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-acr-pos shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Tape imported</p>
                <p className="text-sm text-muted-foreground">
                  {result.createdCount} of {result.totalRows} row
                  {result.totalRows === 1 ? "" : "s"} created at sourcing.
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate("/notes/pipeline")} data-testid="tape-go-pipeline">
                Open pipeline
              </Button>
              <Button variant="outline" onClick={reset} data-testid="tape-import-another">
                Import another tape
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Step: upload empty state — never actually shown when step="upload"
          because the dropzone is itself the entry. Keeps the import surface
          consistent with the rest of the notes pages. */}
      {step === "upload" && csvRows.length === 0 && file === null && null}
      {step === "upload" && csvRows.length === 0 && file !== null && (
        <Card className="mt-4">
          <div className="p-5">
            <EmptyState
              icon={Upload}
              title="No rows parsed"
              description="The file uploaded but no data rows were found. Confirm the file has a header row plus at least one record."
            />
          </div>
        </Card>
      )}
    </PageShell>
  );
}
