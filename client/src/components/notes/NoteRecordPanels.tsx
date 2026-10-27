/**
 * The note record — V-Notes-1 N2. Terms and status first, the collateral's
 * data picture second (the existing payment ledger below is the timeline).
 *
 * No number without provenance: every value carries a chip that opens to the
 * tape row and cell it came from, its as-of and its confidence — or says "no
 * source recorded". Absence is never a confident blank: unknown, not on the
 * tape, searched-and-not-found and never-searched each read as themselves,
 * and an empty collateral block says what to do next.
 */
import { useQuery } from "@tanstack/react-query";
import { FileWarning, Info, MapPinOff, SearchX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { NOTE_TAPE_FIELD, type NoteTapeFieldKey } from "@shared/notes/noteTapeFields";

interface ObservationView {
  value: unknown;
  kind: "value" | "searched_none";
  source: "note_tape" | "operator_correction" | "warehouse" | string;
  sourceRef: { fileName?: string; fileRow?: number; column?: string | null; raw?: string };
  asOf: string | null;
  confidence: string;
  confidenceBasis: string;
  observedAt: string;
}
interface RecordedValue { field: NoteTapeFieldKey; label: string; value: unknown; provenance: ObservationView | null; observations: ObservationView[] }
type Absence = { status: "not_on_record" | "never_searched"; reason: string };
interface NoteRecord {
  noteId: string;
  terms: RecordedValue[];
  yieldFields: RecordedValue[];
  investmentToValue: { ratio: number; basis: string } | Absence;
  documents: {
    entries: Array<{ field: NoteTapeFieldKey; label: string; critical: boolean; state: "present" | "missing" | "exception" | "not_recorded"; provenance: ObservationView | null }>;
    exceptionNote: string | null;
    complete: boolean;
    gaps: string[];
  };
  collateral: {
    status: "matched" | "unmatched" | "not_searched";
    searchedFor: { state: string; county: string; apn: string } | null;
    reason: string;
    parcel: null | {
      parcelKey: string;
      apid: string | null;
      apidReason: string | null;
      source: { name: string; retrievedAt: string | null };
      value: { marketValueCents: number | null; assessedValueCents: number | null } | Absence;
      tax: { taxAmountCents: number | null; taxYear: number | null; delinquency: Absence };
      seniorLiens: Absence;
      hazards: Absence;
    };
  };
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const SOURCE_LABEL: Record<string, string> = { note_tape: "Seller's note tape", operator_correction: "Corrected during import", warehouse: "AcreOS parcel record" };

function format(field: NoteTapeFieldKey, v: unknown): string {
  if (v === null || v === undefined) return "";
  switch (NOTE_TAPE_FIELD[field]?.kind) {
    case "money": return usd(Number(v));
    case "rate": return `${(Number(v) / 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
    case "status": return String(v).replace("_", " ");
    case "int": return `${v} months`;
    default: return String(v);
  }
}

function ProvenanceChip({ p, label }: { p: ObservationView | null; label: string }) {
  if (!p) {
    return <span className="text-xs text-muted-foreground" data-testid="provenance-none">no source recorded</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Where ${label} came from`}
          data-testid="provenance-chip"
        >
          {SOURCE_LABEL[p.source] ?? p.source}
          {p.asOf ? ` · as of ${p.asOf}` : ""}
          {` · ${p.confidence}`}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <dl className="space-y-1.5">
          <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{SOURCE_LABEL[p.source] ?? p.source}{p.sourceRef.fileName ? ` — ${p.sourceRef.fileName}` : ""}</dd></div>
          {p.sourceRef.fileRow !== undefined && (
            <div><dt className="text-xs text-muted-foreground">Where in the file</dt><dd>Row {p.sourceRef.fileRow}{p.sourceRef.column ? `, column “${p.sourceRef.column}”` : ""}{p.sourceRef.raw !== undefined ? `, cell “${p.sourceRef.raw}”` : ""}</dd></div>
          )}
          <div><dt className="text-xs text-muted-foreground">As of</dt><dd>{p.asOf ?? "the tape states no as-of date"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confidence</dt><dd>{p.confidence} — {p.confidenceBasis}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Recorded</dt><dd>{new Date(p.observedAt).toLocaleString()}</dd></div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function ValueRow({ r, emptyText }: { r: RecordedValue; emptyText: string }) {
  const shown = r.value === null || r.value === undefined ? null : format(r.field, r.value);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5" data-testid={`note-record-${r.field}`}>
      <dt className="text-sm text-muted-foreground">{r.label}</dt>
      <dd className="flex flex-wrap items-center gap-2 text-sm">
        {shown === null ? <span className="text-muted-foreground">{emptyText}</span> : <span className="font-medium tabular-nums">{shown}</span>}
        {shown !== null && <ProvenanceChip p={r.provenance} label={r.label} />}
      </dd>
    </div>
  );
}

function AbsenceLine({ label, a }: { label: string; a: Absence }) {
  return (
    <div className="py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        <Badge variant="outline" className="mr-2">{a.status === "never_searched" ? "not searched" : "not on record"}</Badge>
        <span className="text-muted-foreground">{a.reason}</span>
      </dd>
    </div>
  );
}

const DOC_BADGE: Record<string, { text: string; variant: "secondary" | "destructive" | "outline" }> = {
  present: { text: "present", variant: "secondary" },
  missing: { text: "missing", variant: "destructive" },
  exception: { text: "exception", variant: "destructive" },
  not_recorded: { text: "no record", variant: "outline" },
};

export function NoteRecordPanels({ noteId }: { noteId: string }) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<NoteRecord>({ queryKey: [`/api/notes/${noteId}/record`] });

  if (isLoading) {
    return (
      <div className="mb-6 grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading the note record">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (isError || !data) {
    return <QueryErrorState error={error} onRetry={() => void refetch()} isRetrying={isFetching} title="The note record could not be loaded" className="mb-6" />;
  }
  const c = data.collateral;
  const itv = data.investmentToValue;

  return (
    <div className="mb-6 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5" data-testid="note-record-terms">
          <h2 className="mb-1 text-sm font-semibold">Terms as recorded</h2>
          <p className="mb-3 text-xs text-muted-foreground">Each value shows where it came from. Tap a source to see the file row and cell.</p>
          <dl className="divide-y">
            {data.terms.map((r) => <ValueRow key={r.field} r={r} emptyText="not on record" />)}
          </dl>
        </Card>

        <div className="space-y-4">
          <Card className="p-5" data-testid="note-record-yield">
            <h2 className="mb-3 text-sm font-semibold">Yield fields</h2>
            <dl className="divide-y">
              {data.yieldFields.map((r) => <ValueRow key={r.field} r={r} emptyText="not on the tape" />)}
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-testid="note-record-itv">
                <dt className="text-sm text-muted-foreground">Investment-to-value</dt>
                <dd className="text-sm">
                  {"ratio" in itv ? (
                    <span className="font-medium tabular-nums" title={itv.basis}>{(itv.ratio * 100).toFixed(1)}% <span className="font-normal text-muted-foreground">({itv.basis})</span></span>
                  ) : (
                    <span className="text-muted-foreground">{itv.reason}</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className={`p-5 ${data.documents.complete ? "" : "border-destructive/40"}`} data-testid="note-record-documents">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Document set</h2>
              {data.documents.complete ? <Badge variant="secondary">complete</Badge> : <Badge variant="destructive">incomplete</Badge>}
            </div>
            {!data.documents.complete && (
              <p className="mb-3 flex items-start gap-2 text-sm" role="note">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <span>Not serviceable as-is: {data.documents.gaps.join("; ")}.</span>
              </p>
            )}
            <ul className="divide-y">
              {data.documents.entries.map((d) => (
                <li key={d.field} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                  <span>{d.label}{d.critical && <span className="text-muted-foreground"> (critical)</span>}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={DOC_BADGE[d.state].variant}>{DOC_BADGE[d.state].text}</Badge>
                    {d.provenance && <ProvenanceChip p={d.provenance} label={d.label} />}
                  </span>
                </li>
              ))}
            </ul>
            {data.documents.exceptionNote && <p className="mt-3 text-sm"><span className="text-muted-foreground">Recorded exception:</span> {data.documents.exceptionNote}</p>}
          </Card>
        </div>
      </div>

      <Card className="p-5" data-testid="note-record-collateral">
        <h2 className="mb-3 text-sm font-semibold">Collateral</h2>
        {c.status === "not_searched" && (
          <EmptyState
            icon={MapPinOff}
            headline="No parcel to look up yet"
            subtitle="The tape gave no parcel id, state and county for this note's collateral, so AcreOS has not searched for it. Add the APN, state and county to the tape and import it again — the note's history is kept, and the collateral is matched on the new import."
            cta={{ label: "Import an updated tape", href: "/notes?action=new" }}
            testId="note-collateral-not-searched"
          />
        )}
        {c.status === "unmatched" && (
          <EmptyState
            icon={SearchX}
            headline="Searched — no matching parcel"
            subtitle={`AcreOS searched its public-record parcels for APN ${c.searchedFor?.apn ?? "?"} in ${c.searchedFor?.county ?? "?"} County, ${c.searchedFor?.state ?? "?"} and found none (${c.reason}). Check the APN against the county record; if the tape's APN was wrong, import the corrected tape.`}
            cta={{ label: "Import a corrected tape", href: "/notes?action=new" }}
            testId="note-collateral-unmatched"
          />
        )}
        {c.status === "matched" && c.parcel && (
          <div className="grid gap-x-8 sm:grid-cols-2">
            <dl className="divide-y">
              <div className="py-1.5">
                <dt className="text-sm text-muted-foreground">Parcel</dt>
                <dd className="text-sm">
                  APN {c.searchedFor?.apn}, {c.searchedFor?.county} County, {c.searchedFor?.state}
                  <span className="ml-2 text-xs text-muted-foreground">source: {c.parcel.source.name}{c.parcel.source.retrievedAt ? `, retrieved ${new Date(c.parcel.source.retrievedAt).toLocaleDateString()}` : ""}</span>
                </dd>
              </div>
              <div className="py-1.5">
                <dt className="text-sm text-muted-foreground">APID</dt>
                <dd className="text-sm">{c.parcel.apid ?? <span className="text-muted-foreground">{c.parcel.apidReason}</span>}</dd>
              </div>
              {"marketValueCents" in c.parcel.value ? (
                <div className="py-1.5" data-testid="note-collateral-value">
                  <dt className="text-sm text-muted-foreground">Value on record</dt>
                  <dd className="text-sm">
                    {c.parcel.value.marketValueCents !== null ? <span className="font-medium tabular-nums">{usd(c.parcel.value.marketValueCents)} market</span> : <span className="text-muted-foreground">no market value</span>}
                    {c.parcel.value.assessedValueCents !== null && <span className="ml-2 tabular-nums text-muted-foreground">{usd(c.parcel.value.assessedValueCents)} assessed</span>}
                  </dd>
                </div>
              ) : (
                <AbsenceLine label="Value on record" a={c.parcel.value} />
              )}
            </dl>
            <dl className="divide-y">
              <div className="py-1.5">
                <dt className="text-sm text-muted-foreground">Property tax</dt>
                <dd className="text-sm">{c.parcel.tax.taxAmountCents !== null ? `${usd(c.parcel.tax.taxAmountCents)}${c.parcel.tax.taxYear ? ` (${c.parcel.tax.taxYear})` : ""}` : <span className="text-muted-foreground">no tax amount on record</span>}</dd>
              </div>
              <AbsenceLine label="Tax status" a={c.parcel.tax.delinquency} />
              <AbsenceLine label="Senior liens" a={c.parcel.seniorLiens} />
              <AbsenceLine label="Hazard flags" a={c.parcel.hazards} />
            </dl>
          </div>
        )}
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          “Not searched” means nobody has looked yet — it is not a clean result.
        </p>
      </Card>
    </div>
  );
}
