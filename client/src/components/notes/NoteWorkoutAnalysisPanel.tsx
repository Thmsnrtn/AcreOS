/**
 * Workout comparison — V-Notes-2 Leg 2, on the acquired-note detail page.
 *
 * A COMPARISON OF THE OPERATOR'S STATED SCENARIOS. It renders what the server
 * stored (computed once, by shared/notes/workoutEngine.ts) and re-computes
 * nothing. Paths appear in the engine's fixed order with their numbers and
 * assumptions — no recommendation, no ranking, no highlight on the largest.
 * Running a comparison records it and changes nothing else: no case is opened
 * or closed, nothing is sent, filed or posted.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ObservationChip } from "@/components/provenance/FieldRecord";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { dollars, formatDate, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";
import type { CostLine, PathResult, WorkoutRunResult } from "@shared/notes/workoutEngine";
import { CONVENTIONS } from "@shared/notes/workoutEngine";
import type { InputProvenance, WorkoutRunRecord } from "@shared/notes/workoutRunRecord";

type RunWithReproduction = WorkoutRunRecord & { reproduction?: { status: string } };

const SOURCE_LABEL: Record<string, string> = { note_tape: "Seller's note tape", operator_correction: "Corrected during import", warehouse: "AcreOS parcel record", edit: "Edited on the note" };
const BASIS_LABEL: Record<string, string> = {
  recorded: "recorded on the note",
  operator_stated: "stated by you for this run",
  operator_set: "set by you for this run",
  operator_entered: "entered by you",
  warehouse: "AcreOS parcel record",
};
const INPUT_LABEL: Record<string, { label: string; kind: "cents" | "bps" | "months" }> = {
  upbCents: { label: "Unpaid principal balance", kind: "cents" },
  rateBps: { label: "Note rate", kind: "bps" },
  paymentCents: { label: "Payment (P&I)", kind: "cents" },
  remainingTermMonths: { label: "Remaining term", kind: "months" },
  arrearsCents: { label: "Arrears owed now", kind: "cents" },
  collateralValueCents: { label: "Collateral value basis", kind: "cents" },
  discountRateBps: { label: "Discount rate", kind: "bps" },
  servicingMonthlyCents: { label: "Servicing cost per month", kind: "cents" },
  deedInLieuTimelineMonths: { label: "Deed-in-lieu timeline", kind: "months" },
  foreclosureTimelineMonths: { label: "Foreclosure timeline", kind: "months" },
};

const MUTED = "text-xs text-muted-foreground";
const fmt = (v: number | null, kind: "cents" | "bps" | "months") =>
  v === null ? "—" : kind === "cents" ? dollars(v) : kind === "bps" ? `${(v / 100).toFixed(2)}%` : `${v} months`;

// ── form state ──────────────────────────────────────────────────────────────
const toCents = (s: string): number | null => (s.trim() === "" ? null : Math.round(Number(s.replace(/[$,]/g, "")) * 100));
const toBps = (s: string): number | null => (s.trim() === "" ? null : Math.round(Number(s.replace(/%/g, "")) * 100));
const toInt = (s: string): number | null => (s.trim() === "" ? null : Math.round(Number(s)));

type CostRow = { label: string; amount: string; timing: CostLine["timing"] };
const emptyCost = (): CostRow => ({ label: "", amount: "", timing: "upfront" });

function CostEditor({ id, rows, onChange }: { id: string; rows: CostRow[]; onChange: (r: CostRow[]) => void }) {
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_8rem_9rem_auto] items-end gap-2">
          <div>
            <Label htmlFor={`${id}-label-${i}`} className="text-xs">Cost</Label>
            <Input id={`${id}-label-${i}`} value={r.label} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="e.g. Attorney and filing" />
          </div>
          <div>
            <Label htmlFor={`${id}-amount-${i}`} className="text-xs">Amount ($)</Label>
            <Input id={`${id}-amount-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          </div>
          <div>
            <Label htmlFor={`${id}-timing-${i}`} className="text-xs">When</Label>
            <Select value={r.timing} onValueChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, timing: v as CostLine["timing"] } : x)))}>
              <SelectTrigger id={`${id}-timing-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="upfront">Up front (period 1)</SelectItem>
                <SelectItem value="monthly">Every month</SelectItem>
                <SelectItem value="at_resolution">At resolution</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove cost ${r.label || i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyCost()])}>
        <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> Add cost
      </Button>
    </div>
  );
}

type FieldDef = { k: string; label: string; hint?: string };
const TOP_FIELDS: FieldDef[] = [
  { k: "discount", label: "Discount rate (% a year) — required", hint: "Set by you for this run. There is no default." },
  { k: "arrears", label: "Arrears owed now ($)", hint: "AcreOS records no arrears amount; state it. 0 is a value." },
  { k: "servicing", label: "Servicing cost per month ($)", hint: "0 is a value; blank is not stated." },
  { k: "remaining", label: "Remaining term (months)", hint: "Used only if the note records none." },
  { k: "value", label: "Collateral value basis ($)", hint: "Blank uses the parcel record's market value, when there is one." },
];
type ScenarioKey = "mod" | "forb" | "dil" | "fc" | "co";
const SCENARIOS: Array<{ key: ScenarioKey; label: string; fields: FieldDef[]; costs?: boolean; note?: string }> = [
  { key: "mod", label: "Modification", fields: [{ k: "modRate", label: "Modified rate (%)" }, { k: "modTerm", label: "Modified term (months)" }, { k: "modForbear", label: "Principal forbearance ($, no interest)" }, { k: "modReduce", label: "Principal reduction ($)" }] },
  { key: "forb", label: "Forbearance / trial plan", fields: [{ k: "forbMonths", label: "Months" }, { k: "forbPayment", label: "Payment during window ($)" }] },
  { key: "dil", label: "Deed-in-lieu", fields: [{ k: "dilTimeline", label: "Timeline (months)" }], costs: true },
  {
    key: "fc",
    label: "Foreclosure",
    fields: [{ k: "fcTimeline", label: "Timeline (months)" }, { k: "fcCitation", label: "Where the timeline comes from (optional)" }],
    costs: true,
    note: "AcreOS holds no cited per-state foreclosure timeline or cost data. Enter your own; the run labels them as entered by you.",
  },
  { key: "co", label: "Charge-off / hold for exit", fields: [{ k: "coRecovery", label: "Recovery ($, 0 is a value)" }, { k: "coHorizon", label: "Horizon (months)" }] },
];

function RunForm({ noteId, supersedes, onDone }: { noteId: string; supersedes: string | null; onDone: () => void }) {
  const { toast } = useToast();
  const [v, setV] = useState<Record<string, string>>({ modForbear: "0", modReduce: "0" });
  const [on, setOn] = useState<Record<ScenarioKey, boolean>>({ mod: false, forb: false, dil: false, fc: false, co: false });
  const [treatment, setTreatment] = useState("capitalize");
  const [costRows, setCostRows] = useState<Record<"dil" | "fc", CostRow[]>>({ dil: [], fc: [] });
  const g = (k: string) => v[k] ?? "";
  const costs = (rows: CostRow[]) => rows.map((r) => ({ label: r.label, amountCents: toCents(r.amount) ?? -1, timing: r.timing }));

  const run = useMutation({
    mutationFn: async () => {
      const body = {
        discountRateBps: toBps(g("discount")),
        arrearsCents: toCents(g("arrears")),
        servicingMonthlyCents: toCents(g("servicing")),
        remainingTermMonths: toInt(g("remaining")),
        collateralValueCents: toCents(g("value")),
        modification: on.mod ? { rateBps: toBps(g("modRate")), termMonths: toInt(g("modTerm")), arrearsTreatment: treatment, principalForbearanceCents: toCents(g("modForbear")), principalReductionCents: toCents(g("modReduce")) } : null,
        forbearance: on.forb ? { months: toInt(g("forbMonths")), reducedPaymentCents: toCents(g("forbPayment")) } : null,
        deedInLieu: on.dil ? { timelineMonths: toInt(g("dilTimeline")), costs: costs(costRows.dil), citation: null } : null,
        foreclosure: on.fc ? { timelineMonths: toInt(g("fcTimeline")), costs: costs(costRows.fc), citation: g("fcCitation").trim() || null } : null,
        chargeOffHold: on.co ? { recoveryCents: toCents(g("coRecovery")), horizonMonths: toInt(g("coHorizon")), costs: [] } : null,
        supersedesRunId: supersedes,
      };
      return (await apiRequest("POST", `/api/notes/${noteId}/workout-analyses`, body)).json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/notes/${noteId}/workout-analyses`] });
      onDone();
    },
    onError: (e: unknown) => toast({ title: "The comparison was not recorded", description: e instanceof Error ? e.message : "Check each field and try again.", variant: "destructive" }),
  });

  const field = (f: FieldDef) => (
    <div key={f.k}>
      <Label htmlFor={`wk-${f.k}`} className="text-xs">{f.label}</Label>
      <Input id={`wk-${f.k}`} inputMode={f.k === "fcCitation" ? "text" : "decimal"} value={g(f.k)} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
      {f.hint && <p className="mt-1 text-micro text-muted-foreground">{f.hint}</p>}
    </div>
  );

  return (
    <form className="space-y-4 rounded-md border p-4" data-testid="workout-run-form" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
      {supersedes && <p className={MUTED}>This run supersedes an earlier one. The earlier run is kept.</p>}
      <div className="grid gap-3 sm:grid-cols-3">{TOP_FIELDS.map(field)}</div>
      <Separator />
      <p className={MUTED}>Hold / perform as-is is always compared. Add the scenarios you want beside it — each uses only what you state.</p>
      {SCENARIOS.map((sc) => (
        <div key={sc.key} className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox id={`wk-on-${sc.key}`} checked={on[sc.key]} onCheckedChange={(c) => setOn({ ...on, [sc.key]: c === true })} />
            <Label htmlFor={`wk-on-${sc.key}`} className="text-sm font-medium">{sc.label}</Label>
          </div>
          {on[sc.key] && (
            <div className="space-y-3 pl-6">
              {sc.note && <p className={MUTED}>{sc.note}</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                {sc.fields.map(field)}
                {sc.key === "mod" && (
                  <div>
                    <Label htmlFor="wk-mod-treatment" className="text-xs">Arrears</Label>
                    <Select value={treatment} onValueChange={setTreatment}>
                      <SelectTrigger id="wk-mod-treatment"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="capitalize">Capitalized</SelectItem>
                        <SelectItem value="defer_to_maturity">Deferred to maturity</SelectItem>
                        <SelectItem value="waive">Waived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {sc.costs && (sc.key === "dil" || sc.key === "fc") && (
                <CostEditor id={`wk-${sc.key}-cost`} rows={costRows[sc.key]} onChange={(c) => setCostRows({ ...costRows, [sc.key]: c })} />
              )}
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="submit" disabled={run.isPending || g("discount").trim() === ""}>{run.isPending ? "Computing…" : "Compare and record"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{Verbs.CANCEL}</Button>
      </div>
    </form>
  );
}

// ── results ─────────────────────────────────────────────────────────────────
function InputRow({ k, p }: { k: string; p: InputProvenance }) {
  const meta = INPUT_LABEL[k];
  if (!meta) return null;
  return (
    <tr className="border-b last:border-0">
      <td className="py-1 pr-3 text-sm">{meta.label}</td>
      <td className="py-1 pr-3 text-sm tabular-nums">{p.value === null ? <span className="text-muted-foreground">not stated</span> : fmt(p.value, meta.kind)}</td>
      <td className="py-1 text-xs text-muted-foreground">
        {p.basis === "recorded" ? (
          <ObservationChip p={p.recorded?.provenance ?? null} label={meta.label} sourceLabel={SOURCE_LABEL} asOfMissing="the source states no as-of date" />
        ) : p.basis ? (
          BASIS_LABEL[p.basis]
        ) : (
          "none available"
        )}
        {p.warehouse && (
          <span className="ml-2">
            Parcel record: {p.warehouse.marketValueCents === null ? `no value (${p.warehouse.reason})` : `${dollars(p.warehouse.marketValueCents)} · ${p.warehouse.source ?? "unknown source"}${p.warehouse.retrievedAt ? ` · as of ${formatDate(p.warehouse.retrievedAt)}` : ""}`}
          </span>
        )}
        {p.note && <span className="ml-2">{p.note}</span>}
      </td>
    </tr>
  );
}

function PathBlock({ p }: { p: PathResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{p.label}</span>
        {p.status === "computed" ? (
          <span className="tabular-nums">NPV {dollars(p.npvCents)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">{p.status === "not_stated" ? "Not stated" : "Not computed"}</span>
        )}
      </div>
      {p.status !== "computed" ? (
        <p className="mt-1 text-xs text-muted-foreground" role={p.status === "refused" ? "note" : undefined}>{p.reason}</p>
      ) : (
        <>
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
            {p.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          {p.facts.length > 0 && (
            <ul className="mt-2 text-xs">
              {p.facts.map((x) => <li key={x.label}>{x.label}: {dollars(x.cents)}</li>)}
            </ul>
          )}
          <Button type="button" variant="ghost" size="sm" className="px-0 underline-offset-4 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"} cash flows ({p.lines.length} periods)
          </Button>
          {open && (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">{p.label} cash flows by period</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="pr-2">Period</th><th scope="col" className="pr-2">In</th><th scope="col" className="pr-2">Out</th><th scope="col" className="pr-2">Net</th><th scope="col">Discounted</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((l) => (
                    <tr key={l.period} title={Object.entries(l.components).map(([k, v]) => `${k.replace(/_/g, " ")}: ${dollars(v)}`).join(" · ")}>
                      <td className="pr-2">{l.period}</td><td className="pr-2">{dollars(l.inflowCents)}</td><td className="pr-2">{dollars(l.outflowCents)}</td><td className="pr-2">{dollars(l.netCents)}</td><td>{dollars(l.discountedCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-medium">
                    <td className="pr-2" colSpan={4}>Sum of discounted</td><td>{dollars(p.npvCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Sensitivity({ result }: { result: WorkoutRunResult }) {
  const rows = result.sensitivity.filter((s) => s.sensitiveTo.length > 0 && s.cells.some((c) => c.npvCents !== null));
  if (rows.length === 0) return null;
  const label = (path: string) => result.paths.find((p) => p.path === path)?.label ?? path;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Sensitivity</p>
      <p className={MUTED}>{CONVENTIONS.sensitivity}.</p>
      {rows.map((s) => {
        const tfs = [...new Set(s.cells.map((c) => c.timelineFactor))];
        const vfs = [...new Set(s.cells.map((c) => c.valueFactor))];
        return (
          <table key={s.path} className="w-full text-xs tabular-nums">
            <caption className="text-left text-xs font-medium">{label(s.path)} — NPV by collateral value (columns) and timeline (rows)</caption>
            <thead>
              <tr className="text-muted-foreground"><th scope="col" className="text-left">Timeline ×</th>{vfs.map((v) => <th key={v} scope="col" className="text-right">Value ×{v}</th>)}</tr>
            </thead>
            <tbody>
              {tfs.map((t) => (
                <tr key={t}>
                  <th scope="row" className="text-left font-normal">×{t}</th>
                  {vfs.map((v) => {
                    const c = s.cells.find((x) => x.valueFactor === v && x.timelineFactor === t);
                    return <td key={v} className="text-right">{c?.npvCents == null ? "—" : dollars(c.npvCents)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

function RunView({ run }: { run: RunWithReproduction }) {
  const r = run.result;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>As of {formatDate(run.asOf)} · recorded {formatDateTime(run.recordedAt)}</span>
        <Badge variant="outline">{run.engineVersion}</Badge>
        <span>{run.lossMitCaseId ? "Made against the open loss-mit case" : "No loss-mit case was open"}</span>
        {run.supersedesRunId && <span>Supersedes an earlier run</span>}
        {run.reproduction && (
          <Badge variant="outline">
            {run.reproduction.status === "reproduces" ? "Reproduces from its record" : run.reproduction.status === "differs" ? "Does not reproduce" : "Stored by another engine version"}
          </Badge>
        )}
      </div>
      {run.context.daysDelinquent !== null && (
        <p className={MUTED}>
          Context at the time: {run.context.daysDelinquent} days past due on the note's aging record
          {run.context.paidThroughDate ? `, paid through ${formatDate(run.context.paidThroughDate)}` : ""}.
        </p>
      )}
      <table className="w-full">
        <caption className="mb-1 text-left text-sm font-medium">Inputs</caption>
        <tbody>{Object.entries(run.provenance).map(([k, p]) => <InputRow key={k} k={k} p={p} />)}</tbody>
      </table>
      {run.context.citations.foreclosure && <p className={MUTED}>Foreclosure timeline source, as you entered it: {run.context.citations.foreclosure}</p>}
      {r.status === "refused" ? (
        <p className="text-sm" role="alert">Not computed: {r.refusedFor.join(", ")} not available.</p>
      ) : (
        <>
          <p className={MUTED}>Paths are listed in a fixed order, not by value. {CONVENTIONS.discounting}; {CONVENTIONS.npv}.</p>
          <div className="space-y-2">{r.paths.map((p) => <PathBlock key={p.path} p={p} />)}</div>
          <Sensitivity result={r} />
        </>
      )}
    </div>
  );
}

export function NoteWorkoutAnalysisPanel({ noteId }: { noteId: string }) {
  const [composing, setComposing] = useState<false | { supersedes: string | null }>(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery<{ runs: WorkoutRunRecord[] }>({ queryKey: [`/api/notes/${noteId}/workout-analyses`] });
  const runs = list.data?.runs ?? [];
  const activeId = selected ?? runs.at(-1)?.runId ?? null;
  const detail = useQuery<{ run: RunWithReproduction }>({ queryKey: [`/api/notes/${noteId}/workout-analyses/${activeId}`], enabled: activeId !== null });

  return (
    <Card className="space-y-4 p-4" data-testid="note-workout-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><Calculator className="h-4 w-4" aria-hidden="true" /> Workout comparison</h2>
          <p className={MUTED}>
            Compares the scenarios you state, on this note's recorded terms. It is not advice, and running it changes nothing on the note or its loss-mit case.
          </p>
        </div>
        {!composing && (
          <Button size="sm" variant="outline" onClick={() => setComposing({ supersedes: null })}>New comparison</Button>
        )}
      </div>
      {composing && <RunForm noteId={noteId} supersedes={composing.supersedes} onDone={() => { setComposing(false); setSelected(null); }} />}
      {list.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : list.isError ? (
        <QueryErrorState error={list.error as Error} title="Workout comparisons" onRetry={() => void list.refetch()} />
      ) : runs.length === 0 ? (
        !composing && (
          <EmptyState
            icon={Calculator}
            headline="No comparison recorded"
            subtitle="State a discount rate and the scenarios to weigh — modification, forbearance, deed-in-lieu, foreclosure or charge-off — and AcreOS lays out each one's cash flows beside holding the note as it is."
            cta={{ label: "New comparison", onClick: () => setComposing({ supersedes: null }) }}
          />
        )
      ) : (
        <>
          {runs.length > 1 && (
            <div className="flex flex-wrap gap-1" role="list" aria-label="Recorded comparisons">
              {runs.map((r) => (
                <Button key={r.runId} role="listitem" size="sm" variant={r.runId === activeId ? "secondary" : "ghost"} aria-pressed={r.runId === activeId} onClick={() => setSelected(r.runId)}>
                  {formatDateTime(r.recordedAt)}
                </Button>
              ))}
            </div>
          )}
          {detail.isLoading || !detail.data ? (
            detail.isError ? <QueryErrorState error={detail.error as Error} title="This comparison" onRetry={() => void detail.refetch()} /> : <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <RunView run={detail.data.run} />
              <Button size="sm" variant="ghost" onClick={() => setComposing({ supersedes: detail.data!.run.runId })}>Correct with a new run</Button>
            </>
          )}
        </>
      )}
    </Card>
  );
}
