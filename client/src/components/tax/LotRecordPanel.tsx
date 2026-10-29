/**
 * A lot's tax record — V-Tax-1 T4. On the auction worksheet, in the expanded
 * lot, above the max bid.
 *
 *   - Disagreements first: when the tax list, another sale's list of the same
 *     parcel, the county's own record (as the operator read it) and AcreOS's
 *     public-record parcel state different values, every value is shown with
 *     its source and the book value is marked. AcreOS picks none.
 *   - Each fact with where it came from (the shared provenance chip), or why
 *     it is missing: blank on the list (asked, nothing stated) is not the same
 *     as never stated.
 *   - What is known, searched and found absent, or never searched. A lien
 *     search never run reads unknown — never clean, and never zero in the max
 *     bid (the rights stack refuses it).
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SearchCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { DisagreementPanel, ObservationChip, type RecordedValueLike } from "@/components/provenance/FieldRecord";
import { RESOLVE_COST_LABEL, type TriageFact } from "@shared/tax/triage";

type Field = "totalTaxOwed" | "delinquentYears" | "saleDate" | "marketValue" | "assessedValue" | "minimumBid";
interface LotRecord {
  listingId: number;
  apn: string;
  fields: RecordedValueLike<Field>[];
  facts: TriageFact[];
  otherListings: Array<{ listingId: number; saleDate: string | null; status: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  tax_list: "County tax list",
  auction: "The sale's date",
  operator_correction: "County record (entered by you)",
  warehouse: "AcreOS parcel record",
};
const AS_OF_MISSING = "the source states no as-of date";
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function format(field: Field, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (field === "delinquentYears") return Array.isArray(v) ? v.join(", ") : String(v);
  if (field === "saleDate") return formatDate(String(v));
  return usd(Number(v));
}

const FACT_BADGE: Record<TriageFact["state"]["status"], { text: string; variant: "secondary" | "outline" }> = {
  known: { text: "known", variant: "secondary" },
  searched_none: { text: "searched, none found", variant: "outline" },
  unknown: { text: "never searched", variant: "outline" },
};

export function LotRecordPanel({ listingId }: { listingId: number }) {
  const key = `/api/tax-researcher/listings/${listingId}/record`;
  const q = useQuery<{ record: LotRecord }>({ queryKey: [key] });
  if (q.isLoading) return <Skeleton className="h-32" aria-label="Loading the lot's tax record" />;
  if (q.isError || !q.data?.record) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The lot's tax record could not be loaded" />;
  const r = q.data.record;
  const disagreeing = r.fields.filter((f) => f.disagreement);
  return (
    <div className="space-y-3" data-testid={`lot-record-${listingId}`}>
      <DisagreementPanel fields={disagreeing} noun="fact" testIdPrefix="lot" format={format} sourceLabel={SOURCE_LABEL} asOfMissing={AS_OF_MISSING} />

      <dl className="divide-y text-sm" aria-label="Tax facts">
        {r.fields.map((f) => {
          const shown = f.value === null || f.value === undefined ? null : format(f.field, f.value);
          return (
            <div key={f.field} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5" data-testid={`lot-record-${f.field}`}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {shown === null ? (
                  <span className="text-muted-foreground">
                    {f.absence?.status === "blank_on_source" ? `blank on the list${f.absence.column ? ` (column “${f.absence.column}”)` : ""} — asked, nothing stated` : "never stated by any source"}
                  </span>
                ) : (
                  <>
                    <span className="font-medium tabular-nums">{shown}</span>
                    <ObservationChip p={f.provenance} label={f.label} sourceLabel={SOURCE_LABEL} asOfMissing={AS_OF_MISSING} />
                  </>
                )}
                {f.disagreement && <Badge variant="destructive">sources disagree</Badge>}
              </dd>
            </div>
          );
        })}
      </dl>

      <section aria-label="What is known and what is not" data-testid={`lot-knowledge-${listingId}`}>
        <p className="flex items-center gap-2 text-sm font-medium"><SearchCheck className="h-4 w-4" aria-hidden="true" />Searched, not searched</p>
        <ul className="mt-1 space-y-1 text-sm">
          {r.facts.map((f) => (
            <li key={f.key} data-testid={`lot-fact-${f.key}`}>
              <span className="font-medium">{f.label}</span> <Badge variant={FACT_BADGE[f.state.status].variant}>{FACT_BADGE[f.state.status].text}</Badge>{" "}
              <span className="text-xs text-muted-foreground">
                — {f.state.status === "known" ? `${f.state.value} (${f.state.source})` : f.state.status === "searched_none" ? `${f.state.reason} (${f.state.source})` : f.state.reason}
                {f.resolve ? `. Resolve: ${f.resolve.how} (${RESOLVE_COST_LABEL[f.resolve.cost]})` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {r.otherListings.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid={`lot-other-listings-${listingId}`}>
          This parcel is also on {r.otherListings.length} other sale list{r.otherListings.length === 1 ? "" : "s"} you imported ({r.otherListings.map((o) => (o.saleDate ? formatDate(o.saleDate) : "no sale date")).join(", ")}); their values are included above.
        </p>
      )}

      <CountyValueForm listingId={listingId} queryKey={key} />
    </div>
  );
}

function CountyValueForm({ listingId, queryKey }: { listingId: number; queryKey: string }) {
  const { toast } = useToast();
  const [field, setField] = useState<Field>("totalTaxOwed");
  const [kind, setKind] = useState<"value" | "searched_none">("value");
  const [value, setValue] = useState("");
  const [reference, setReference] = useState("");
  const [asOf, setAsOf] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const typed =
        kind === "searched_none"
          ? null
          : field === "saleDate"
            ? value
            : field === "delinquentYears"
              ? value.split(/[,\s]+/).filter(Boolean).map(Number)
              : Math.round(Number(value.replace(/[$,]/g, "")) * 100);
      return apiRequest("POST", `/api/tax-researcher/listings/${listingId}/county-values`, { field, kind, value: typed, reference: reference.trim(), asOf });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: "County value recorded beside the list's — nothing was overwritten" });
      setValue("");
      setReference("");
    },
    onError: (err) => toast({ title: "Not recorded", description: err instanceof ApiError ? (err.body?.message ?? err.message) : String(err), variant: "destructive" }),
  });

  const id = `county-value-${listingId}`;
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs" data-testid="county-value-form">
      <p className="font-medium">Record what the county's own record says</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-field`} className="text-xs">Fact</Label>
          <select id={`${id}-field`} className="h-8 w-full rounded-md border bg-background px-2" value={field} onChange={(e) => setField(e.target.value as Field)}>
            <option value="totalTaxOwed">Amount owed</option>
            <option value="delinquentYears">Delinquent years</option>
            <option value="saleDate">Sale date</option>
            <option value="marketValue">Market value</option>
            <option value="assessedValue">Assessed value</option>
            <option value="minimumBid">Minimum bid</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-kind`} className="text-xs">The county record</Label>
          <select id={`${id}-kind`} className="h-8 w-full rounded-md border bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="value">states a value</option>
            <option value="searched_none">states none</option>
          </select>
        </div>
        {kind === "value" && (
          <div className="space-y-1">
            <Label htmlFor={`${id}-value`} className="text-xs">{field === "saleDate" ? "Date" : field === "delinquentYears" ? "Years (comma-separated)" : "Amount $"}</Label>
            <Input id={`${id}-value`} type={field === "saleDate" ? "date" : "text"} value={value} onChange={(e) => setValue(e.target.value)} className="h-8" />
          </div>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`${id}-ref`} className="text-xs">Which record (statement, page, receipt)</Label><Input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} className="h-8" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-asof`} className="text-xs">As of</Label><Input id={`${id}-asof`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8" /></div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !reference.trim() || !asOf || (kind === "value" && !value.trim())} data-testid="button-record-county-value">
          {save.isPending ? "Recording…" : "Record"}
        </Button>
      </div>
    </div>
  );
}
