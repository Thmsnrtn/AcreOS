/**
 * Note-tape import — V-Notes-1 N1 (Linnea's day-one path).
 *
 * Choose → map → preview → import. Nothing is written until "Import". The
 * server suggests a mapping; the operator confirms it. A required field left
 * unmapped refuses the file with the fields named. Every rejected row shows
 * the field, the cell, what is wrong and the fix, and can be corrected in
 * place (one cell of one row — the rest of the tape is not re-run by hand) or
 * explicitly excluded. Import stays disabled while any row is unresolved:
 * nothing is imported partially.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import { NOTE_TAPE_FIELDS, type NoteTapeFieldKey, type NoteTapeGroup } from "@shared/notes/noteTapeFields";

type Mapping = Partial<Record<NoteTapeFieldKey, number | null>>;
type Overrides = Record<string, Partial<Record<NoteTapeFieldKey, string>>>;

interface FieldError { field: NoteTapeFieldKey | "row"; column: string | null; value: string; message: string; fix: string }
interface Rejection { fileRow: number; raw: string[]; errors: FieldError[] }
interface PreparedNote {
  fileRow: number;
  noteNumber: string;
  payerName: string;
  currentBalanceCents: number;
  interestRateBps: number;
  maturityDate: string;
  status: string;
  documentsIncomplete: boolean;
}
interface Preview {
  headers: string[];
  fileSha256: string;
  mapping: Mapping;
  unmatchedHeaders: string[];
  validation: {
    unmappedRequired: Array<{ field: NoteTapeFieldKey; label: string; fix: string }>;
    valid: PreparedNote[];
    rejected: Rejection[];
    summary: { totalRows: number; validCount: number; rejectedCount: number; documentsIncomplete: number };
  };
}
interface Committed {
  status: "committed";
  created: number;
  appendedToExisting: number;
  excludedRows: number[];
  notes: Array<{ fileRow: number; noteId: string; noteNumber: string; created: boolean; collateral: string; documentsIncomplete: boolean; differingFields: string[] }>;
}

const GROUP_LABEL: Record<NoteTapeGroup, string> = { identity: "Loan", terms: "Terms", yield: "Yield fields", collateral: "Collateral", documents: "Documents" };
const NONE = "__none__";
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export function NoteTapeImport({ onDone }: { onDone?: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [asOf, setAsOf] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Committed | null>(null);

  async function runPreview(next: { mapping?: Mapping; overrides?: Overrides; text?: string; name?: string }) {
    const text = next.text ?? file?.text;
    const name = next.name ?? file?.name;
    if (!text || !name) return;
    setBusy("preview");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/note-tape/preview", { csv: text, fileName: name, mapping: next.mapping, overrides: next.overrides ?? overrides });
      const p = await readJson<Preview>(res);
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The tape could not be read.");
    } finally {
      setBusy(null);
    }
  }

  async function chooseFile(f: File | null) {
    if (!f) return;
    const text = await f.text();
    setFile({ name: f.name, text });
    setOverrides({});
    setExcluded(new Set());
    setCommitted(null);
    await runPreview({ text, name: f.name, overrides: {} });
  }

  function setField(key: NoteTapeFieldKey, value: string) {
    const next = { ...mapping, [key]: value === NONE ? null : Number(value) };
    setMapping(next);
    void runPreview({ mapping: next });
  }

  function applyFix(fileRow: number, field: NoteTapeFieldKey) {
    const k = `${fileRow}:${field}`;
    const next = { ...overrides, [fileRow]: { ...(overrides[fileRow] ?? {}), [field]: drafts[k] ?? "" } };
    setOverrides(next);
    void runPreview({ mapping, overrides: next });
  }

  function toggleExclude(fileRow: number, on: boolean) {
    const next = new Set(excluded);
    if (on) next.add(fileRow);
    else next.delete(fileRow);
    setExcluded(next);
  }

  const v = preview?.validation;
  const unresolved = useMemo(() => (v ? v.rejected.filter((r) => !excluded.has(r.fileRow)) : []), [v, excluded]);
  const toImport = v ? v.valid.filter((n) => !excluded.has(n.fileRow)).length : 0;
  const canCommit = !!v && v.unmappedRequired.length === 0 && unresolved.length === 0 && v.valid.some((n) => !excluded.has(n.fileRow)) && busy === null;

  async function commit() {
    if (!file || !preview) return;
    setBusy("commit");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/note-tape/commit", {
        csv: file.text,
        fileName: file.name,
        mapping,
        overrides,
        excludeRows: [...excluded],
        asOf: asOf || null,
      });
      setCommitted(await readJson<Committed>(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import was refused.");
    } finally {
      setBusy(null);
    }
  }

  if (committed) {
    return (
      <div className="space-y-4" data-testid="note-tape-committed">
        <Alert>
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            {committed.created} note{committed.created === 1 ? "" : "s"} added
            {committed.appendedToExisting > 0 ? `, ${committed.appendedToExisting} already in your book` : ""}
          </AlertTitle>
          <AlertDescription>
            Every value is recorded with the tape row it came from.
            {committed.appendedToExisting > 0 && " For notes already in your book, the tape's values were added beside the ones you had — nothing was overwritten; any difference shows on the note's page."}
            {committed.excludedRows.length > 0 && ` Rows you excluded: ${committed.excludedRows.join(", ")}.`}
          </AlertDescription>
        </Alert>
        <ul className="divide-y rounded-md border">
          {committed.notes.map((n) => (
            <li key={n.noteId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Link href={`/notes/${n.noteId}`} className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                {n.noteNumber}
              </Link>
              {!n.created && <Badge variant="secondary">already in book</Badge>}
              {n.documentsIncomplete && <Badge variant="destructive">documents incomplete</Badge>}
              {n.collateral === "unmatched" && <Badge variant="outline">collateral not matched</Badge>}
              {n.collateral === "not_searched" && <Badge variant="outline">no parcel id on tape</Badge>}
              {n.differingFields.length > 0 && <Badge variant="outline">{n.differingFields.length} value{n.differingFields.length === 1 ? "" : "s"} differ from your book</Badge>}
            </li>
          ))}
        </ul>
        {onDone && <Button onClick={onDone}>Done</Button>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="note-tape-file">Seller's note tape (CSV)</Label>
          <Input id="note-tape-file" type="file" accept=".csv,text/csv" onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)} data-testid="note-tape-file" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note-tape-asof">Tape as-of date (optional)</Label>
          <Input id="note-tape-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>That did not go through</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {busy === "preview" && !preview && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the tape…
        </p>
      )}

      {preview && v && (
        <>
          <section aria-labelledby="note-tape-mapping-h" className="space-y-3">
            <h3 id="note-tape-mapping-h" className="text-sm font-semibold">Columns — confirm the mapping</h3>
            {v.unmappedRequired.length > 0 && (
              <Alert variant="destructive" role="alert" data-testid="note-tape-unmapped">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Map every required column before importing</AlertTitle>
                <AlertDescription>
                  Nothing is checked or imported until these are mapped: {v.unmappedRequired.map((u) => u.label).join(", ")}.
                </AlertDescription>
              </Alert>
            )}
            {(Object.keys(GROUP_LABEL) as NoteTapeGroup[]).map((g) => (
              <fieldset key={g} className="space-y-2">
                <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{GROUP_LABEL[g]}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {NOTE_TAPE_FIELDS.filter((f) => f.group === g).map((f) => {
                    const id = `note-tape-map-${f.key}`;
                    const current = mapping[f.key];
                    return (
                      <div key={f.key} className="flex items-center gap-2">
                        <Label htmlFor={id} className="w-44 shrink-0 text-sm">
                          {f.label}
                          {f.required && <span className="text-destructive" aria-label="required"> *</span>}
                        </Label>
                        <Select value={current === null || current === undefined ? NONE : String(current)} onValueChange={(val) => setField(f.key, val)}>
                          <SelectTrigger id={id} className="h-8" aria-label={`Column for ${f.label}`}>
                            <SelectValue placeholder="Not on this tape" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Not on this tape</SelectItem>
                            {preview.headers.map((h, i) => (
                              <SelectItem key={`${h}-${i}`} value={String(i)}>{h || `(column ${i + 1})`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </section>

          {v.unmappedRequired.length === 0 && (
            <section aria-labelledby="note-tape-preview-h" className="space-y-3">
              <h3 id="note-tape-preview-h" className="text-sm font-semibold">
                Preview — {v.summary.validCount} ready, {v.summary.rejectedCount} need a fix
                {v.summary.documentsIncomplete > 0 ? `, ${v.summary.documentsIncomplete} with incomplete documents` : ""}
              </h3>

              {v.rejected.length > 0 && (
                <ul className="space-y-3" data-testid="note-tape-rejected">
                  {v.rejected.map((r) => (
                    <li key={r.fileRow} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">Row {r.fileRow}</span>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked={excluded.has(r.fileRow)} onCheckedChange={(c) => toggleExclude(r.fileRow, c === true)} aria-label={`Leave row ${r.fileRow} out of this import`} />
                          Leave this row out
                        </label>
                      </div>
                      <ul className="space-y-2">
                        {r.errors.map((e, i) => {
                          const k = `${r.fileRow}:${e.field}`;
                          const fixable = e.field !== "row";
                          return (
                            <li key={i} className="text-sm">
                              <p>
                                <span className="font-medium">{e.message}</span>
                                {e.column && <span className="text-muted-foreground"> — column “{e.column}”, cell “{e.value}”</span>}
                              </p>
                              <p className="text-muted-foreground">Fix: {e.fix}</p>
                              {fixable && !excluded.has(r.fileRow) && (
                                <div className="mt-1 flex items-center gap-2">
                                  <Label htmlFor={`fix-${k}`} className="sr-only">Corrected value for row {r.fileRow}</Label>
                                  <Input id={`fix-${k}`} className="h-8 max-w-xs" value={drafts[k] ?? overrides[r.fileRow]?.[e.field as NoteTapeFieldKey] ?? ""} onChange={(ev) => setDrafts({ ...drafts, [k]: ev.target.value })} placeholder="Corrected value" />
                                  <Button size="sm" variant="secondary" onClick={() => applyFix(r.fileRow, e.field as NoteTapeFieldKey)} disabled={busy !== null}>
                                    Apply to row {r.fileRow}
                                  </Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {v.valid.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Loan</TableHead>
                        <TableHead>Borrower</TableHead>
                        <TableHead className="text-right">UPB</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Maturity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Documents</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {v.valid.map((n) => (
                        <TableRow key={n.fileRow} className={excluded.has(n.fileRow) ? "opacity-50" : undefined}>
                          <TableCell>{n.fileRow}</TableCell>
                          <TableCell className="font-medium">{n.noteNumber}</TableCell>
                          <TableCell>{n.payerName}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(n.currentBalanceCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">{(n.interestRateBps / 100).toFixed(2)}%</TableCell>
                          <TableCell>{n.maturityDate}</TableCell>
                          <TableCell>{n.status.replace("_", " ")}</TableCell>
                          <TableCell>{n.documentsIncomplete ? <Badge variant="destructive">incomplete</Badge> : <Badge variant="secondary">complete</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => void commit()} disabled={!canCommit} data-testid="note-tape-commit">
                  {busy === "commit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {Verbs.IMPORT} {toImport} note{toImport === 1 ? "" : "s"}
                </Button>
                {unresolved.length > 0 && <p className="text-sm text-muted-foreground">Fix or leave out {unresolved.length} row{unresolved.length === 1 ? "" : "s"} first — nothing is imported partially.</p>}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
