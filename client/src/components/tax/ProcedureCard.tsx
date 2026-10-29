/**
 * County procedure card — V-Tax-1 T2a. On each county watch.
 *
 *   - Standing first: "Biddable" or "Bidding locked", with every reason.
 *   - A stale-law banner when any source is more than 12 months old.
 *   - Every field shows its value, source, as-of, verification, and — for
 *     county practice — "county practice, not state permission". Nothing is
 *     presented as law without its provenance; AcreOS authors no field.
 *   - Recording a procedure creates a new version (unverified); completing
 *     the county-verification task is its own step.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import {
  PROCEDURE_FIELD_KEYS,
  PROCEDURE_FIELD_LABEL,
  describeReturn,
  type ProcedureFieldKey,
  type ProcedureFields,
  type ProcedureStanding,
  type ReturnModel,
} from "@shared/tax/procedure";

interface ProcedureResponse {
  current: null | { version: number; fields: ProcedureFields; countyVerification: null | { completedOn: string; completedBy: string; method: string } };
  history: Array<{ id: string; version: number; verified: boolean }>;
  standing: ProcedureStanding;
}

const VERIFICATION_LABEL = { unverified: "unverified", checked_against_statute: "checked against statute", confirmed_with_county: "confirmed with the county" } as const;

function valueText(k: ProcedureFieldKey, v: unknown): string {
  if (k === "returnModel") return describeReturn(v as ReturnModel);
  if (k === "redemptionPeriodMonths") return `${v} months`;
  return String(v).replace(/_/g, " ");
}

type Draft = Record<ProcedureFieldKey, { value: string; source: string; asOf: string; basis: "state_law" | "county_practice"; verification: "unverified" | "checked_against_statute" | "confirmed_with_county"; returnKind?: ReturnModel["kind"] }>;

function emptyDraft(current: ProcedureFields | undefined): Draft {
  const d = {} as Draft;
  for (const k of PROCEDURE_FIELD_KEYS) {
    const f = current?.[k] as { value: unknown; source: string; asOf: string; basis: "state_law" | "county_practice"; verification: Draft[ProcedureFieldKey]["verification"] } | undefined;
    let value = "";
    let returnKind: ReturnModel["kind"] | undefined;
    if (f && k === "returnModel") {
      const m = f.value as ReturnModel;
      returnKind = m.kind;
      value = m.kind === "annual_rate" ? String(m.rateBps / 100) : m.kind === "flat_penalty" ? String(m.penaltyBps / 100) : m.kind === "tiered_penalty" ? m.schedule : "";
    } else if (f) value = String(f.value);
    d[k] = { value, source: f?.source ?? "", asOf: f?.asOf ?? "", basis: f?.basis ?? "state_law", verification: f?.verification ?? "unverified", returnKind: k === "returnModel" ? (returnKind ?? "annual_rate") : undefined };
  }
  return d;
}

function toFields(d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PROCEDURE_FIELD_KEYS) {
    const r = d[k];
    if (r.value.trim() === "" && !(k === "returnModel" && r.returnKind === "none")) continue;
    let value: unknown = r.value.trim();
    if (k === "redemptionPeriodMonths") value = Number(r.value);
    if (k === "returnModel") {
      const pct = Math.round(Number(r.value) * 100);
      value = r.returnKind === "annual_rate" ? { kind: "annual_rate", rateBps: pct } : r.returnKind === "flat_penalty" ? { kind: "flat_penalty", penaltyBps: pct } : r.returnKind === "tiered_penalty" ? { kind: "tiered_penalty", schedule: r.value.trim() } : { kind: "none" };
    }
    out[k] = { value, source: r.source.trim(), asOf: r.asOf, basis: r.basis, verification: r.verification };
  }
  return out;
}

function RecordForm({ state, county, current, onDone }: { state: string; county: string; current: ProcedureFields | undefined; onDone: () => void }) {
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(() => emptyDraft(current));
  const set = (k: ProcedureFieldKey, patch: Partial<Draft[ProcedureFieldKey]>) => setD((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/tax-procedures/${state}/${encodeURIComponent(county)}`, { fields: toFields(d) })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tax-procedures/${state}/${encodeURIComponent(county)}`] });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Not recorded", description: err.message, variant: "destructive" }),
  });
  return (
    <form className="mt-2 space-y-3 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} data-testid={`procedure-form-${state}-${county}`}>
      <p className="text-xs text-muted-foreground">Record each field from the statute or the county's own procedure, with its citation and date. A new version needs the county-verification task again.</p>
      {PROCEDURE_FIELD_KEYS.map((k) => {
        const id = `${state}-${county}-${k}`.replace(/\s+/g, "-");
        return (
          <fieldset key={k} className="grid gap-2 sm:grid-cols-5">
            <legend className="sr-only">{PROCEDURE_FIELD_LABEL[k]}</legend>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${id}-v`} className="text-xs">{PROCEDURE_FIELD_LABEL[k]}{k === "returnModel" ? " (% for rates and flat penalties)" : ""}</Label>
              <div className="flex gap-1">
                {k === "returnModel" && (
                  <select aria-label="Kind of return" className="rounded-md border bg-background px-1 text-xs" value={d[k].returnKind} onChange={(e) => set(k, { returnKind: e.target.value as ReturnModel["kind"] })}>
                    <option value="annual_rate">per year</option>
                    <option value="flat_penalty">flat penalty</option>
                    <option value="tiered_penalty">tiered</option>
                    <option value="none">none</option>
                  </select>
                )}
                <Input id={`${id}-v`} value={d[k].value} onChange={(e) => set(k, { value: e.target.value })} placeholder={k === "instrument" ? "lien, deed, hybrid, redeemable_deed" : ""} />
              </div>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`${id}-s`} className="text-xs">Source</Label>
              <Input id={`${id}-s`} value={d[k].source} onChange={(e) => set(k, { source: e.target.value })} placeholder="statute section, county document" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-a`} className="text-xs">As of</Label>
              <Input id={`${id}-a`} type="date" value={d[k].asOf} onChange={(e) => set(k, { asOf: e.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-5">
              <select aria-label={`${PROCEDURE_FIELD_LABEL[k]}: basis`} className="rounded-md border bg-background px-1 text-xs" value={d[k].basis} onChange={(e) => set(k, { basis: e.target.value as "state_law" | "county_practice" })}>
                <option value="state_law">state law</option>
                <option value="county_practice">county practice</option>
              </select>
              <select aria-label={`${PROCEDURE_FIELD_LABEL[k]}: verification`} className="rounded-md border bg-background px-1 text-xs" value={d[k].verification} onChange={(e) => set(k, { verification: e.target.value as Draft[ProcedureFieldKey]["verification"] })}>
                <option value="unverified">unverified</option>
                <option value="checked_against_statute">checked against statute</option>
                <option value="confirmed_with_county">confirmed with the county</option>
              </select>
            </div>
          </fieldset>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>{Verbs.SAVE}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>{Verbs.CANCEL}</Button>
      </div>
    </form>
  );
}

function VerifyForm({ state, county, onDone }: { state: string; county: string; onDone: () => void }) {
  const { toast } = useToast();
  const [completedOn, setCompletedOn] = useState("");
  const [method, setMethod] = useState("");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/tax-procedures/${state}/${encodeURIComponent(county)}/verification`, { completedOn, method })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tax-procedures/${state}/${encodeURIComponent(county)}`] });
      onDone();
    },
    onError: (err: Error) => toast({ title: "Not recorded", description: err.message, variant: "destructive" }),
  });
  const id = `${state}-${county}`.replace(/\s+/g, "-");
  return (
    <form className="mt-2 grid gap-2 rounded-md border p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="space-y-1">
        <Label htmlFor={`${id}-vd`} className="text-xs">Verified on</Label>
        <Input id={`${id}-vd`} type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-vm`} className="text-xs">How</Label>
        <Input id={`${id}-vm`} value={method} onChange={(e) => setMethod(e.target.value)} placeholder="called the county tax office; checked the published sale rules" />
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" size="sm" disabled={save.isPending}>{Verbs.SAVE}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>{Verbs.CANCEL}</Button>
      </div>
    </form>
  );
}

export function ProcedureCard({ state, county }: { state: string; county: string }) {
  const key = `/api/tax-procedures/${state}/${encodeURIComponent(county)}`;
  const q = useQuery<ProcedureResponse>({ queryKey: [key] });
  const [mode, setMode] = useState<"none" | "record" | "verify">("none");
  if (q.isLoading) return <Skeleton className="mt-2 h-20" aria-label="Loading the county procedure" />;
  if (q.isError || !q.data) return <QueryErrorState error={q.error} onRetry={() => void q.refetch()} isRetrying={q.isFetching} title="The county procedure could not be loaded" />;
  const { current, standing } = q.data;
  return (
    <div className="mt-2 rounded-md border p-3" data-testid={`procedure-card-${state}-${county}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          Procedure{current ? ` (version ${current.version})` : ""}
          {standing.biddable ? (
            <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" />biddable</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1" data-testid="procedure-bidding-locked"><Lock className="h-3 w-3" aria-hidden="true" />bidding locked</Badge>
          )}
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMode(mode === "record" ? "none" : "record")}>Record procedure</Button>
          {current && <Button size="sm" variant="outline" onClick={() => setMode(mode === "verify" ? "none" : "verify")}>Complete county verification</Button>}
        </div>
      </div>
      {standing.staleLawBanner && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 p-2 text-sm" role="alert" data-testid="procedure-stale-law">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          Stale law: {standing.staleFields.map((k) => PROCEDURE_FIELD_LABEL[k]).join(", ")} rest on sources more than 12 months old. Re-verify them before relying on them.
        </p>
      )}
      {!standing.biddable && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground" data-testid="procedure-lock-reasons">
          {standing.lockReasons.map((r, i) => <li key={i}>{r.message}</li>)}
        </ul>
      )}
      {current && (
        <dl className="mt-2 divide-y">
          {PROCEDURE_FIELD_KEYS.map((k) => {
            const f = current.fields[k] as { value: unknown; source: string; asOf: string; basis: string; verification: keyof typeof VERIFICATION_LABEL } | undefined;
            return (
              <div key={k} className="py-1.5" data-testid={`procedure-field-${k}`}>
                <dt className="text-xs text-muted-foreground">{PROCEDURE_FIELD_LABEL[k]}</dt>
                <dd className="text-sm">
                  {f ? (
                    <>
                      <span className="font-medium">{valueText(k, f.value)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">source: {f.source}, as of {f.asOf} · {VERIFICATION_LABEL[f.verification]}</span>
                      {f.basis === "county_practice" && <Badge variant="outline" className="ml-2">county practice, not state permission</Badge>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">not recorded</span>
                  )}
                </dd>
              </div>
            );
          })}
          <div className="py-1.5 text-xs text-muted-foreground">
            {current.countyVerification ? `County verified ${current.countyVerification.completedOn} — ${current.countyVerification.method}` : "County verification not completed for this version."}
          </div>
        </dl>
      )}
      {mode === "record" && <RecordForm state={state} county={county} current={current?.fields} onDone={() => setMode("none")} />}
      {mode === "verify" && <VerifyForm state={state} county={county} onDone={() => setMode("none")} />}
    </div>
  );
}
