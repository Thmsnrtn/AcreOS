/**
 * CsvImportSheet — column-mapping CSV importer (Hank fix).
 *
 * Hank's VA used to spend 60 minutes per import:
 *   1. Download county tax-delinquent CSV.
 *   2. Manually rename columns to AcreOS's expected shape.
 *   3. Remove duplicate APNs.
 *   4. Re-upload.
 *
 * This sheet collapses that workflow to ~60 seconds:
 *   1. Drop or pick the file.
 *   2. We auto-detect each header → field (shared/leads/csvImportMapping.ts):
 *      "Parcel #" → APN, "Owner Mailing Address" → the MAILING address mail
 *      is sent to, "Situs Address" / "Property Address" → the property.
 *      Operator can override each mapping via a dropdown.
 *   3. We preview the first 5 mapped rows so the operator can sanity-
 *      check before commit.
 *   4. On submit we POST /api/leads/csv-import which dedupes against
 *      existing leads.apn for the org and within the upload itself.
 *
 * W5b — one-click migration: an .xlsx is read on the server
 * (POST /api/lead-imports/parse-spreadsheet); a VERIFIED export layout
 * (shared/leads/importFormats.ts — Regrid, AcreOS) is recognised and mapped in
 * one click, and anything else gets this guided mapper with the reason no
 * preset exists. Every import is a batch (POST /api/lead-imports/batches) the
 * customer can undo; rows matching an owner who opted out are skipped
 * (isSuppressedForOutreach).
 *
 * Intentionally NOT a replacement for the legacy /api/leads/import path
 * (which uses fixed headers). That dialog still lives in /leads top-bar
 * for power users who already format their CSVs to spec.
 */

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { detectImportFormat, UNVERIFIED_SOURCES, type ImportFormatPreset } from "@shared/leads/importFormats";
import {
  CSV_IMPORT_MAX_ROWS_PER_REQUEST,
  CSV_IMPORT_TARGET_FIELDS,
  chunkCsvImportRows,
  mapCsvRow,
  parseCsv,
  suggestMapping,
  type CsvImportTargetField,
} from "@shared/leads/csvImportMapping";

// The header → field mapping (mailing vs property address, split names, every
// phone column, the DNC flag) and the per-request row limit live in
// shared/leads/csvImportMapping.ts, so they can be tested against real
// land-list shapes and the server enforces the same limit the sheet batches by.
const TARGET_FIELDS = CSV_IMPORT_TARGET_FIELDS;
type TargetFieldId = CsvImportTargetField;

export interface CsvImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: (result: ImportResult) => void;
}

interface ImportResult {
  imported: number;
  skippedExisting: number;
  skippedInvalid: number;
  skippedDuplicateInFile: number;
  skippedSuppressed?: number;
  importBatchId?: number | null;
  errors: Array<{ row: number; message: string }>;
}

interface UndoResult {
  removed: number;
  kept: Array<{ leadId: number; reason: string }>;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function CsvImportSheet({ open, onOpenChange, onImported }: CsvImportSheetProps) {
  const { toast } = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, TargetFieldId>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preset, setPreset] = useState<ImportFormatPreset | null>(null);
  const [undo, setUndo] = useState<UndoResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const reset = () => {
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileName(null);
    setResult(null);
    setPreset(null);
    setUndo(null);
    setFileError(null);
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    setUndo(null);
    setFileError(null);
    let h: string[];
    let r: string[][];
    if (/\.xlsx$/i.test(file.name) || file.type === XLSX_TYPE) {
      try {
        const res = await apiRequest("POST", "/api/lead-imports/parse-spreadsheet", {
          fileName: file.name,
          base64: await fileToBase64(file),
        });
        ({ headers: h, rows: r } = (await res.json()) as { headers: string[]; rows: string[][] });
      } catch (err: any) {
        setFileError(err?.message ?? "This spreadsheet couldn't be read.");
        return;
      }
    } else {
      ({ headers: h, rows: r } = parseCsv(await file.text()));
    }
    setHeaders(h);
    setRows(r);
    // A verified export layout maps in one click; columns it doesn't name,
    // and every file from an unverified tool, fall back to the header
    // heuristic (a bare "City" is the property's when the file also has a
    // "Mailing City") — and every mapping stays editable below.
    const heuristic = suggestMapping(h);
    const detected = detectImportFormat(h);
    setPreset(detected?.preset ?? null);
    setMapping(
      detected
        ? Object.fromEntries(h.map((col) => [col, detected.mapping[col] ?? heuristic[col] ?? "skip"])) as Record<string, TargetFieldId>
        : heuristic,
    );
  };

  // Compute mapped preview + counts.
  const { mappedRows, warnings, apnDupesInFile } = useMemo(() => {
    const mappedRows: Array<Record<string, string>> = [];
    const warnings: string[] = [];
    const apnSeen = new Set<string>();
    let apnDupesInFile = 0;
    for (const r of rows) {
      // First non-empty value per field wins, in column order.
      const out = mapCsvRow(headers, r, mapping);
      // APN within-file dedupe count (preview only — server reconfirms).
      // A parcel is APN + state + county, so the same APN in two counties is
      // two parcels, not a duplicate.
      const apn = (out.apn ?? "").trim();
      if (apn) {
        const key = [out.state, out.county, apn].map((v) => (v ?? "").trim().toUpperCase()).join("|");
        if (apnSeen.has(key)) apnDupesInFile++;
        else apnSeen.add(key);
      }
      mappedRows.push(out);
    }
    const fieldsSet = new Set(Object.values(mapping));
    if (!fieldsSet.has("firstName") && !fieldsSet.has("lastName") && !fieldsSet.has("ownerName")) {
      warnings.push("No name column mapped — every row will be skipped as invalid.");
    }
    if (!fieldsSet.has("apn")) {
      warnings.push("No APN column mapped — re-imports of the same list will create duplicate leads.");
    }
    if (!fieldsSet.has("address") && fieldsSet.has("propertyAddress")) {
      warnings.push("No mailing address column mapped — leads will have no address to mail to (the property address is not where the owner receives mail).");
    }
    return { mappedRows, warnings, apnDupesInFile };
  }, [headers, rows, mapping]);

  const [progress, setProgress] = useState<string | null>(null);

  // A large list goes up in request-sized batches (the server takes at most
  // CSV_IMPORT_MAX_ROWS_PER_REQUEST rows per request). Results are summed; a
  // failed batch stops the import and says exactly which rows did and did not
  // go in, so the customer knows where to resume.
  const importMut = useMutation({
    mutationFn: async () => {
      const total: ImportResult = { imported: 0, skippedExisting: 0, skippedInvalid: 0, skippedDuplicateInFile: 0, skippedSuppressed: 0, errors: [] };
      // One undoable batch for the whole file.
      const batchRes = await apiRequest("POST", "/api/lead-imports/batches", {
        sourceFormat: preset?.id ?? "mapped",
        fileName,
        rowCount: mappedRows.length,
      });
      const { id: importBatchId } = (await batchRes.json()) as { id: number };
      total.importBatchId = importBatchId;
      const batches = chunkCsvImportRows(mappedRows);
      for (const batch of batches) {
        const first = batch.offset + 1;
        const last = batch.offset + batch.rows.length;
        if (batches.length > 1) setProgress(`Importing rows ${first.toLocaleString()}–${last.toLocaleString()} of ${mappedRows.length.toLocaleString()}…`);
        let data: ImportResult;
        try {
          const res = await apiRequest("POST", "/api/leads/csv-import", { rows: batch.rows, importBatchId });
          data = (await res.json()) as ImportResult;
        } catch (err: any) {
          const done = batch.offset > 0
            ? `Rows 1–${batch.offset.toLocaleString()} were imported (${total.imported.toLocaleString()} new leads). `
            : "";
          throw new Error(
            `${done}Rows ${first.toLocaleString()}–${mappedRows.length.toLocaleString()} were not imported: ${err?.message ?? "the request failed"}. ` +
              (batch.offset > 0 ? `Re-importing the same file is safe — rows already imported are skipped by APN.` : "Try again."),
          );
        }
        total.imported += data.imported;
        total.skippedExisting += data.skippedExisting;
        total.skippedInvalid += data.skippedInvalid;
        total.skippedDuplicateInFile += data.skippedDuplicateInFile;
        total.skippedSuppressed = (total.skippedSuppressed ?? 0) + (data.skippedSuppressed ?? 0);
        total.errors.push(...data.errors.map((e) => ({ ...e, row: e.row + batch.offset })));
      }
      return total;
    },
    onSuccess: (data) => {
      setProgress(null);
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Import complete",
        description: `${data.imported} imported · ${data.skippedExisting} skipped (existing APN) · ${data.skippedInvalid} invalid`,
      });
      onImported?.(data);
    },
    onError: (err: any) => {
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Import stopped",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    },
  });

  const undoMut = useMutation({
    mutationFn: async (batchId: number) => (await (await apiRequest("POST", `/api/lead-imports/batches/${batchId}/undo`, {})).json()) as UndoResult,
    onSuccess: (data) => {
      setUndo(data);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Import undone", description: `${data.removed} lead${data.removed === 1 ? "" : "s"} removed${data.kept.length ? ` · ${data.kept.length} kept` : ""}` });
    },
    onError: (err: any) => toast({ title: "Couldn't undo the import", description: err?.message ?? "Try again.", variant: "destructive" }),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Smart CSV import</SheetTitle>
          <SheetDescription>
            We auto-map columns and dedupe by APN against your existing
            leads. Override any mapping below before importing.
          </SheetDescription>
        </SheetHeader>

        {!headers.length && (
          <div className="mt-6 border-2 border-dashed rounded-lg p-8 text-center">
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" aria-hidden />
            <Label
              htmlFor="csv-importer-file"
              className="cursor-pointer block min-h-11 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 rounded"
            >
              <span className="text-sm text-muted-foreground">
                Click to select a CSV or Excel (.xlsx) file
              </span>
              <Input
                id="csv-importer-file"
                type="file"
                accept={`.csv,text/csv,.xlsx,${XLSX_TYPE}`}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
                data-testid="csv-importer-file"
              />
            </Label>
            <p className="text-xs text-muted-foreground mt-2">
              Headers stay yours — we only map them; we don't rewrite the file.
            </p>
            {fileError && (
              <p className="text-sm text-acr-neg mt-3" role="alert" data-testid="csv-importer-file-error">{fileError}</p>
            )}
          </div>
        )}

        {headers.length > 0 && !result && (
          <div className="mt-6 space-y-6">
            {fileName && (
              <div className="text-sm text-muted-foreground">
                <CheckCircle2 className="inline w-4 h-4 text-acr-pos mr-1" />
                {fileName} · {rows.length.toLocaleString()} rows
                {rows.length > CSV_IMPORT_MAX_ROWS_PER_REQUEST && (
                  <span className="ml-2">
                    · sent in {Math.ceil(rows.length / CSV_IMPORT_MAX_ROWS_PER_REQUEST)} batches of{" "}
                    {CSV_IMPORT_MAX_ROWS_PER_REQUEST}
                  </span>
                )}
                {apnDupesInFile > 0 && (
                  <span className="ml-2 text-acr-warn">
                    {apnDupesInFile} duplicate APN
                    {apnDupesInFile === 1 ? "" : "s"} within file will be skipped
                  </span>
                )}
              </div>
            )}

            {/* Source format: a verified preset, or why there isn't one */}
            {preset ? (
              <div className="rounded-md border p-3 text-sm" data-testid="csv-importer-preset">
                <CheckCircle2 className="inline w-4 h-4 text-acr-pos mr-1" aria-hidden />
                Recognised: <span className="font-medium">{preset.label}</span> — columns mapped from its published layout
                ({preset.source}). Check them below.
              </div>
            ) : (
              <details className="rounded-md border p-3 text-sm" data-testid="csv-importer-no-preset">
                <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                  No verified layout matched — map the columns below. Why no preset for PropStream, LandInsights, DataTree…?
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {UNVERIFIED_SOURCES.map((u) => (
                    <li key={u.tool}><span className="font-medium text-foreground">{u.tool}:</span> {u.why}.</li>
                  ))}
                </ul>
              </details>
            )}

            {/* Mapping grid */}
            <div>
              <h3 className="text-sm font-medium mb-2">Column mapping</h3>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
                {headers.map((h) => (
                  <div key={h} className="grid grid-cols-2 items-center gap-2">
                    <div className="text-sm truncate" title={h}>
                      <span className="text-muted-foreground">CSV:</span>{" "}
                      <span className="font-medium">{h}</span>
                    </div>
                    <Select
                      value={mapping[h] ?? "skip"}
                      onValueChange={(v) =>
                        setMapping((m) => ({ ...m, [h]: v as TargetFieldId }))
                      }
                    >
                      <SelectTrigger
                        className="h-9"
                        data-testid={`csv-mapping-${h}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TARGET_FIELDS.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-md border border-acr-warn bg-acr-warn-soft p-3 text-sm">
                <div className="flex gap-2 items-start">
                  <AlertCircle className="w-4 h-4 mt-0.5 text-acr-warn" />
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Preview — first 5 mapped rows */}
            <div>
              <h3 className="text-sm font-medium mb-2">
                Preview (first 5 mapped rows)
              </h3>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Mailing address</TableHead>
                      <TableHead>Property</TableHead>
                      <TableHead>APN</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappedRows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">
                          {r.firstName || r.lastName
                            ? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()
                            : r.ownerName || (
                                <span className="text-acr-neg">
                                  (missing)
                                </span>
                              )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {[r.address, r.city, r.state, r.zip]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.propertyAddress || "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {r.apn || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{r.phone || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={reset}
                disabled={importMut.isPending}
                data-testid="csv-importer-reset"
              >
                Start over
              </Button>
              <Button
                onClick={() => importMut.mutate()}
                disabled={importMut.isPending || mappedRows.length === 0}
                data-testid="csv-importer-submit"
              >
                {importMut.isPending
                  ? (progress ?? "Importing…")
                  : `Import ${mappedRows.length.toLocaleString()} rows`}
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-center">
              <Stat label="Imported" value={result.imported} tone="pos" />
              <Stat label="Skipped (existing APN)" value={result.skippedExisting} />
              <Stat label="Skipped (invalid)" value={result.skippedInvalid} tone="neg" />
              <Stat
                label="Duplicates in file"
                value={result.skippedDuplicateInFile}
              />
              <Stat label="Skipped (owner opted out)" value={result.skippedSuppressed ?? 0} />
            </div>
            {result.importBatchId && result.imported > 0 && !undo && (
              <div className="rounded-md border p-3 text-sm flex items-center justify-between gap-3 flex-wrap" data-testid="csv-importer-undo">
                <span>Imported the wrong file? Undo removes the leads this import created that haven&apos;t been worked yet.</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  onClick={() => undoMut.mutate(result.importBatchId!)}
                  disabled={undoMut.isPending}
                  data-testid="csv-importer-undo-button"
                >
                  Undo this import
                </Button>
              </div>
            )}
            {undo && (
              <div className="rounded-md border p-3 text-sm" role="status" data-testid="csv-importer-undo-result">
                Removed {undo.removed} lead{undo.removed === 1 ? "" : "s"}.
                {undo.kept.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground list-disc pl-4">
                    {undo.kept.slice(0, 10).map((k, i) => (
                      <li key={i}>{k.leadId ? `Lead #${k.leadId} kept: ${k.reason}` : `Kept: ${k.reason}`}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {result.errors.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Per-row errors ({result.errors.length})
                </summary>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((e) => (
                    <li key={e.row} className="text-xs">
                      <span className="font-medium">Row {e.row}:</span>{" "}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset} data-testid="csv-importer-import-more">
                Import another file
              </Button>
              <Button onClick={() => onOpenChange(false)} data-testid="csv-importer-close">
                Done
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "pos" | "neg";
}) {
  const toneClass =
    tone === "pos"
      ? "bg-acr-pos-soft text-acr-pos-soft-ink"
      : tone === "neg"
        ? "bg-acr-neg-soft text-acr-neg-soft-ink"
        : "bg-muted text-foreground";
  return (
    <div className={`rounded-md p-3 ${toneClass}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

export default CsvImportSheet;
