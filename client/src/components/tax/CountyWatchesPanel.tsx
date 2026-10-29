/**
 * County watches + triage — V-Tax-1 T1. Behind the tax-delinquent door, on
 * the auction worksheet.
 *
 *   - A watch is one county. Its redemption period, sale type and auction
 *     cadence are DATA: each shows its value and where it came from, or says
 *     "not stated" — never a national default.
 *   - Triage lists each lot's unknowns in the order that changes the bid
 *     decision most for the least cost, with how to resolve each and what kind
 *     of cost that is. Unknown is never shown as clean; "searched, none found"
 *     reads differently from "never searched".
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Binoculars, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import { RESOLVE_COST_LABEL, type ResolveCost } from "@shared/tax/triage";
import { ProcedureCard } from "./ProcedureCard";

interface Stated<T> { value: T; source: string; asOf: string | null }
interface Watch {
  id: string;
  state: string;
  county: string;
  lotCount: number;
  terms: { redemptionPeriodMonths?: Stated<number>; saleType?: Stated<string>; auctionCadence?: Stated<string> };
}
type FactState = { status: "known"; value: string; source: string } | { status: "searched_none"; reason: string; source: string } | { status: "unknown"; reason: string };
interface Fact { key: string; label: string; state: FactState; resolve: null | { how: string; cost: ResolveCost }; weight: number }
interface Triage {
  basis: string;
  lots: Array<{ listingId: number; apn: string; address: string | null; saleDate: string | null; delinquentYears: string[]; facts: Fact[]; unknownsInOrder: string[] }>;
}

const TERM_LABEL = { redemptionPeriodMonths: "Redemption period", saleType: "Sale type", auctionCadence: "Auction cadence" } as const;

function TermLine({ label, term, unit }: { label: string; term: Stated<number | string> | undefined; unit?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-1" data-testid={`watch-term-${label}`}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">
        {term ? (
          <>
            <span className="font-medium">{term.value}{unit ? ` ${unit}` : ""}</span>
            <span className="ml-2 text-xs text-muted-foreground">source: {term.source}{term.asOf ? `, as of ${term.asOf}` : ""}</span>
          </>
        ) : (
          <span className="text-muted-foreground">not stated — unknown</span>
        )}
      </dd>
    </div>
  );
}

function TermsForm({ watch, onDone }: { watch: Watch; onDone: () => void }) {
  const { toast } = useToast();
  const [months, setMonths] = useState(watch.terms.redemptionPeriodMonths ? String(watch.terms.redemptionPeriodMonths.value) : "");
  const [source, setSource] = useState(watch.terms.redemptionPeriodMonths?.source ?? "");
  const [asOf, setAsOf] = useState(watch.terms.redemptionPeriodMonths?.asOf ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const terms: Record<string, unknown> = { ...watch.terms };
      if (months.trim() === "") delete terms.redemptionPeriodMonths;
      else terms.redemptionPeriodMonths = { value: Number(months), source: source.trim(), asOf: asOf || null };
      const res = await apiRequest("PUT", `/api/tax-watches/${watch.id}/terms`, terms);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-watches"] });
      queryClient.invalidateQueries({ queryKey: [`/api/tax-watches/${watch.id}/triage`] });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Not saved", description: err.message, variant: "destructive" }),
  });
  return (
    <form className="mt-2 grid gap-2 rounded-md border p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} data-testid={`watch-terms-form-${watch.id}`}>
      <div className="space-y-1">
        <Label htmlFor={`months-${watch.id}`} className="text-xs">Redemption period (months)</Label>
        <Input id={`months-${watch.id}`} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="leave blank if unknown" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`source-${watch.id}`} className="text-xs">Where it came from</Label>
        <Input id={`source-${watch.id}`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="the county's sale notice, statute section" />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`asof-${watch.id}`} className="text-xs">As of</Label>
        <Input id={`asof-${watch.id}`} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={save.isPending}>{Verbs.SAVE}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>{Verbs.CANCEL}</Button>
      </div>
    </form>
  );
}

function FactBadge({ s }: { s: FactState }) {
  if (s.status === "known") return <Badge variant="secondary">known</Badge>;
  if (s.status === "searched_none") return <Badge variant="outline">searched, none found</Badge>;
  return <Badge variant="outline">unknown</Badge>;
}

function TriageList({ watchId }: { watchId: string }) {
  const q = useQuery<Triage>({ queryKey: [`/api/tax-watches/${watchId}/triage`] });
  if (q.isLoading) return <Skeleton className="mt-2 h-24" aria-label="Loading triage" />;
  if (q.isError || !q.data) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="Triage could not be loaded" />;
  if (q.data.lots.length === 0) return <p className="mt-2 text-sm text-muted-foreground">No lots from this county have been imported yet.</p>;
  return (
    <div className="mt-2 space-y-3" data-testid={`watch-triage-${watchId}`}>
      <p className="text-xs text-muted-foreground">{q.data.basis}</p>
      {q.data.lots.map((lot) => {
        const byKey = new Map(lot.facts.map((f) => [f.key, f]));
        return (
          <div key={lot.listingId} className="rounded-md border p-3" data-testid={`triage-lot-${lot.apn}`}>
            <p className="text-sm font-medium">APN {lot.apn}{lot.address ? ` · ${lot.address}` : ""}</p>
            <p className="text-xs text-muted-foreground">Sale {lot.saleDate ?? "date not stated"} · delinquent {lot.delinquentYears.join(", ") || "years not stated"}</p>
            <ol className="mt-2 space-y-1" aria-label="Resolve these first">
              {lot.unknownsInOrder.map((k, i) => {
                const f = byKey.get(k)!;
                return (
                  <li key={k} className="text-sm" data-testid={`triage-unknown-${k}`}>
                    <span className="mr-1 tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="font-medium">{f.label}</span> <FactBadge s={f.state} />{" "}
                    <span className="text-muted-foreground">— {"reason" in f.state ? f.state.reason : ""}. Resolve: {f.resolve?.how} ({f.resolve ? RESOLVE_COST_LABEL[f.resolve.cost] : ""}; weight {f.weight}/5)</span>
                  </li>
                );
              })}
            </ol>
            <dl className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              {lot.facts.filter((f) => f.state.status === "known").map((f) => (
                <div key={f.key}><dt className="inline">{f.label}: </dt><dd className="inline text-foreground">{f.state.status === "known" ? f.state.value : ""}</dd> ({f.state.status === "known" ? f.state.source : ""})</div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

export function CountyWatchesPanel() {
  const q = useQuery<{ watches: Watch[] }>({ queryKey: ["/api/tax-watches"] });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (q.isLoading) return <Card className="mb-4 p-5"><Skeleton className="h-6 w-48" /><Skeleton className="mt-3 h-16" /></Card>;
  if (q.isError || !q.data) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="County watches could not be loaded" className="mb-4" />;
  if (q.data.watches.length === 0) {
    return (
      <div className="mb-4" data-testid="county-watches-empty">
        <EmptyState
          icon={Binoculars}
          headline="No county watches yet"
          subtitle="Importing a tax list creates a watch for each county on it. A watch holds that county's redemption period, sale type and auction cadence — stated by you with a source, never assumed."
          cta={{ label: "Import a tax list", onClick: () => document.querySelector<HTMLButtonElement>('[data-testid="button-toggle-import"]')?.click(), "data-testid": "county-watches-empty-import" }}
        />
      </div>
    );
  }
  return (
    <Card className="mb-4 p-5" data-testid="county-watches">
      <h2 className="mb-1 text-sm font-semibold">County watches</h2>
      <p className="mb-3 text-xs text-muted-foreground">Each county's terms are what you have stated, with the source. A term you have not stated is unknown.</p>
      <ul className="divide-y">
        {q.data.watches.map((w) => (
          <li key={w.id} className="py-3" data-testid={`county-watch-${w.state}-${w.county}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="flex items-center gap-1 rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={open === w.id}
                aria-label={`${open === w.id ? "Hide" : "Show"} triage for ${w.county} County, ${w.state}`}
                onClick={() => setOpen(open === w.id ? null : w.id)}
              >
                {open === w.id ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                {w.county} County, {w.state}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{w.lotCount} lot{w.lotCount === 1 ? "" : "s"}</span>
              </button>
              <Button size="sm" variant="outline" onClick={() => setEditing(editing === w.id ? null : w.id)}>State terms</Button>
            </div>
            <dl className="mt-1">
              <TermLine label={TERM_LABEL.redemptionPeriodMonths} term={w.terms.redemptionPeriodMonths} unit="months" />
              <TermLine label={TERM_LABEL.saleType} term={w.terms.saleType} />
              <TermLine label={TERM_LABEL.auctionCadence} term={w.terms.auctionCadence} />
            </dl>
            {editing === w.id && <TermsForm watch={w} onDone={() => setEditing(null)} />}
            {open === w.id && (
              <>
                <ProcedureCard state={w.state} county={w.county} />
                <TriageList watchId={w.id} />
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
