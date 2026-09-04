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
 *   2. We auto-detect each header → field by substring heuristic
 *      (e.g. "Parcel #" → APN, "Owner Mailing Address" → address).
 *      Operator can override each mapping via a dropdown.
 *   3. We preview the first 5 mapped rows so the operator can sanity-
 *      check before commit.
 *   4. On submit we POST /api/leads/csv-import which dedupes against
 *      existing leads.apn for the org and within the upload itself.
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

/** Canonical AcreOS lead fields the importer can route a CSV column into. */
const TARGET_FIELDS = [
  { id: "skip", label: "— Don't import —" },
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "ownerName", label: "Owner name (split into first/last)" },
  { id: "address", label: "Address" },
  { id: "city", label: "City" },
  { id: "state", label: "State" },
  { id: "zip", label: "ZIP" },
  { id: "phone", label: "Phone" },
  { id: "email", label: "Email" },
  { id: "apn", label: "APN / Parcel number" },
] as const;

type TargetFieldId = (typeof TARGET_FIELDS)[number]["id"];

/**
 * Heuristic: lowercase the header and match substrings. The first hit
 * wins, so order is important — put narrow matches before broad ones
 * (e.g. "owner name" before "name", "parcel" before "owner parcel"
 * doesn't matter because "parcel" only maps to APN regardless).
 */
function suggestField(header: string): TargetFieldId {
  const h = header.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  // Order: longest-specific first.
  if (/\b(apn|parcel|pin)\b/.test(h)) return "apn";
  if (/owner.*name|name.*owner/.test(h)) return "ownerName";
  if (/\bfirst\b/.test(h) && /\bname\b/.test(h)) return "firstName";
  if (/\blast\b/.test(h) && /\bname\b/.test(h)) return "lastName";
  if (/\bemail\b/.test(h)) return "email";
  if (/\bphone\b|\bmobile\b|\btel\b/.test(h)) return "phone";
  if (/\bzip\b|\bpostal\b/.test(h)) return "zip";
  if (/\bstate\b|\bst\b/.test(h)) return "state";
  if (/\bcity\b|town/.test(h)) return "city";
  if (/\baddress\b|\bstreet\b|\bsitus\b|\bproperty\b.*\baddr/.test(h)) return "address";
  if (/^name$/.test(h) || /full.*name|owner/.test(h)) return "ownerName";
  return "skip";
}

/**
 * Lightweight CSV parser. Handles double-quote-escaped commas + CRLF.
 * Not RFC 4180-perfect, but sufficient for county tax lists (which are
 * the actual hot use case). Server-side import handles the strict edge
 * cases for power users via /api/leads/import (preview path).
 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Treat "" inside quotes as literal "
      if (inQuotes && text[i + 1] === '"') {
        buf += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (buf.length > 0 || lines.length === 0) lines.push(buf);
      buf = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) lines.push(buf);

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur);
    return cells.map((s) => s.trim());
  };

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).filter((r) => r.some((c) => c.length > 0));
  return { headers, rows };
}

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
  errors: Array<{ row: number; message: string }>;
}

export function CsvImportSheet({ open, onOpenChange, onImported }: CsvImportSheetProps) {
  const { toast } = useToast();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, TargetFieldId>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileName(null);
    setResult(null);
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const { headers: h, rows: r } = parseCsv(text);
    setHeaders(h);
    setRows(r);
    // Pre-fill mapping from heuristic.
    const initial: Record<string, TargetFieldId> = {};
    for (const header of h) initial[header] = suggestField(header);
    setMapping(initial);
  };

  // Compute mapped preview + counts.
  const { mappedRows, warnings, apnDupesInFile } = useMemo(() => {
    const mappedRows: Array<Record<string, string>> = [];
    const warnings: string[] = [];
    const apnSeen = new Set<string>();
    let apnDupesInFile = 0;
    for (const r of rows) {
      const out: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        const target = mapping[headers[i]];
        if (!target || target === "skip") continue;
        const val = r[i] ?? "";
        if (val) out[target] = val;
      }
      // APN within-file dedupe count (preview only — server reconfirms).
      const apn = (out.apn ?? "").trim();
      if (apn) {
        if (apnSeen.has(apn)) apnDupesInFile++;
        else apnSeen.add(apn);
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
    return { mappedRows, warnings, apnDupesInFile };
  }, [headers, rows, mapping]);

  const importMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/csv-import", {
        rows: mappedRows,
      });
      return (await res.json()) as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Import complete",
        description: `${data.imported} imported · ${data.skippedExisting} skipped (existing APN) · ${data.skippedInvalid} invalid`,
      });
      onImported?.(data);
    },
    onError: (err: any) => {
      toast({
        title: "Import failed",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    },
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
                Click to select or drop a CSV here
              </span>
              <Input
                id="csv-importer-file"
                type="file"
                accept=".csv,text/csv"
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
          </div>
        )}

        {headers.length > 0 && !result && (
          <div className="mt-6 space-y-6">
            {fileName && (
              <div className="text-sm text-muted-foreground">
                <CheckCircle2 className="inline w-4 h-4 text-acr-pos mr-1" />
                {fileName} · {rows.length.toLocaleString()} rows
                {apnDupesInFile > 0 && (
                  <span className="ml-2 text-acr-warn">
                    {apnDupesInFile} duplicate APN
                    {apnDupesInFile === 1 ? "" : "s"} within file will be skipped
                  </span>
                )}
              </div>
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
                      <TableHead>Address</TableHead>
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
                  ? "Importing…"
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
            </div>
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
