/**
 * Provenance and disagreement, rendered — shared by the note record
 * (V-Notes-1 N2/N4) and the tax lot record (V-Tax-1 T4). The rule they render
 * is shared/provenance/fieldRecord.ts.
 *
 *   - ObservationChip: where one value came from, through the canonical
 *     DataProvenanceChip, with the source, place in the file, as-of and basis
 *     in a popover. No source recorded is said, never dressed in one.
 *   - DisagreementPanel: every value each source stated for a field, side by
 *     side with its sources, the book value marked. Nothing is resolved.
 */
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { formatDateTime } from "@/lib/format";

export interface ObservationViewLike {
  value: unknown;
  kind: "value" | "searched_none";
  source: string;
  sourceRef: { fileName?: string; fileRow?: number; column?: string | null; raw?: string; reference?: string; sourceName?: string };
  asOf: string | null;
  basis: string;
  observedAt: string;
}

export interface RecordedValueLike<F extends string = string> {
  field: F;
  label: string;
  value: unknown;
  provenance: ObservationViewLike | null;
  observations: ObservationViewLike[];
  absence: null | { status: "blank_on_source"; column: string | null; fileName: string | null } | { status: "never_stated" };
  disagreement: null | { values: Array<{ value: unknown; observations: ObservationViewLike[] }>; bookValueIs: number | null };
}

export function ObservationChip({ p, label, sourceLabel, asOfMissing }: { p: ObservationViewLike | null; label: string; sourceLabel: Record<string, string>; asOfMissing: string }) {
  if (!p) {
    return <span className="text-xs text-muted-foreground" data-testid="provenance-none">no source recorded</span>;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center rounded-full border px-2 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Where ${label} came from`}
          data-testid="provenance-chip"
        >
          {/* The canonical chip, with no classification: a seller's tape or a
              county tax list is not one of the four truth-states
              (shared/dataClassification.ts), so none is claimed — the basis
              in the popover says what it is. */}
          <DataProvenanceChip source={sourceLabel[p.source] ?? p.source} sourceAsOf={p.asOf} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <dl className="space-y-1.5">
          <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{sourceLabel[p.source] ?? p.source}{p.sourceRef.fileName ? ` — ${p.sourceRef.fileName}` : ""}{p.sourceRef.reference ? ` — ${p.sourceRef.reference}` : ""}{p.sourceRef.sourceName ? ` — ${p.sourceRef.sourceName}` : ""}</dd></div>
          {p.sourceRef.fileRow !== undefined && (
            <div><dt className="text-xs text-muted-foreground">Where in the file</dt><dd>Row {p.sourceRef.fileRow}{p.sourceRef.column ? `, column “${p.sourceRef.column}”` : ""}{p.sourceRef.raw !== undefined ? `, cell “${p.sourceRef.raw}”` : ""}</dd></div>
          )}
          <div><dt className="text-xs text-muted-foreground">As of</dt><dd>{p.asOf ?? asOfMissing}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Basis</dt><dd>{p.basis}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Recorded</dt><dd>{formatDateTime(p.observedAt)}</dd></div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function DisagreementPanel<F extends string>({
  fields,
  noun,
  testIdPrefix,
  format,
  sourceLabel,
  asOfMissing,
}: {
  fields: RecordedValueLike<F>[];
  /** What a field is called here: "term" (notes), "fact" (tax). */
  noun: string;
  testIdPrefix: string;
  format: (field: F, v: unknown) => string;
  sourceLabel: Record<string, string>;
  asOfMissing: string;
}) {
  if (fields.length === 0) return null;
  return (
    <Card className="border-destructive/40 p-5" data-testid={`${testIdPrefix}-record-disagreements`}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
        Sources disagree on {fields.length === 1 ? `1 ${noun}` : `${fields.length} ${noun}s`}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">Every value is kept with where it came from. AcreOS has not picked one: the book keeps the value first recorded until you correct it.</p>
      <ul className="divide-y">
        {fields.map((r) => (
          <li key={r.field} className="py-2" data-testid={`${testIdPrefix}-disagreement-${r.field}`}>
            <p className="mb-1 text-sm font-medium">{r.label}</p>
            {r.disagreement!.bookValueIs === null && <p className="mb-1 text-xs text-muted-foreground">The book holds {r.value === null || r.value === undefined ? "no value" : format(r.field, r.value)} — no source on record states it.</p>}
            <ul className="space-y-1">
              {r.disagreement!.values.map((v, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tabular-nums">{format(r.field, v.value)}</span>
                  {v.observations.map((o, j) => <ObservationChip key={j} p={o} label={`${r.label} (${format(r.field, v.value)})`} sourceLabel={sourceLabel} asOfMissing={asOfMissing} />)}
                  {r.disagreement!.bookValueIs === i && <Badge variant="outline">on the book</Badge>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}
