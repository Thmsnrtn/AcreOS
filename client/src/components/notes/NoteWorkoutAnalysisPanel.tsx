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

function Field({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="mt-1 text-micro text-muted-foreground">{hint}</p>}
    </div>
  );
}

function RunForm({ noteId, supersedes, onDone }: { noteId: string; supersedes: string | null; onDone: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ discount: "", arrears: "", servicing: "", remaining: "", value: "" });
  const [on, setOn] = useState({ mod: false, forb: false, dil: false, fc: false, co: false });
  const [mod, setMod] = useState({ rate: "", term: "", treatment: "capitalize", forbear: "0", reduce: "0" });
  const [forb, setForb] = useState({ months: "", payment: "" });
  const [dil, setDil] = useState<{ timeline: string; costs: CostRow[] }>({ timeline: "", costs: [] });
  const [fc, setFc] = useState<{ timeline: string; costs: CostRow[]; citation: string }>({ timeline: "", costs: [], citation: "" });
  const [co, setCo] = useState({ recovery: "", horizon: "" });
  const costs = (rows: CostRow[]) => rows.map((r) => ({ label: r.label, amountCents: toCents(r.amount) ?? -1, timing: r.timing }));

  const run = useMutation({
    mutationFn: async () => {
      const body = {
        discountRateBps: toBps(f.discount),
        arrearsCents: toCents(f.arrears),
        servicingMonthlyCents: toCents(f.servicing),
        remainingTermMonths: toInt(f.remaining),
        collateralValueCents: toCents(f.value),
        modification: on.mod ? { rateBps: toBps(mod.rate), termMonths: toInt(mod.term), arrearsTreatment: mod.treatment, principalForbearanceCents: toCents(mod.forbear), principalReductionCents: toCents(mod.reduce) } : null,
        forbearance: on.forb ? { months: toInt(forb.months), reducedPaymentCents: toCents(forb.payment) } : null,
        deedInLieu: on.dil ? { timelineMonths: toInt(dil.timeline), costs: costs(dil.costs), citation: null } : null,
        foreclosure: on.fc ? { timelineMonths: toInt(fc.timeline), costs: costs(fc.costs), citation: fc.citation.trim() || null } : null,
        chargeOffHold: on.co ? { recoveryCents: toCents(co.recovery), horizonMonths: toInt(co.horizon), costs: [] } : null,
        supersedesRunId: supersedes,
      };
      const res = await apiRequest("POST", `/api/notes/${noteId}/workout-analyses`, body);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/notes/${noteId}/workout-analyses`] });
      onDone();
    },
    onError: (e: unknown) => toast({ title: "The comparison was not recorded", description: e instanceof Error ? e.message : "Check each field and try again.", variant: "destructive" }),
  });

  const toggle = (k: keyof typeof on, label: string) => (
    <div className="flex items-center gap-2">
      <Checkbox id={`wk-on-${k}`} checked={on[k]} onCheckedChange={(v) => setOn({ ...on, [k]: v === true })} />
      <Label htmlFor={`wk-on-${k}`} className="text-sm font-medium">{label}</Label>
    </div>
  );

  return (
    <form
      className="space-y-4 rounded-md border p-4"
      data-testid="workout-run-form"
      onSubmit={(e) => {
        e.preventDefault();
        run.mutate();
      }}
    >
      {supersedes && <p className="text-xs text-muted-foreground">This run supersedes an earlier one. The earlier run is kept.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="wk-discount" label="Discount rate (% a year) — required" value={f.discount} onChange={(v) => setF({ ...f, discount: v })} hint="Set by you for this run. There is no default." />
        <Field id="wk-arrears" label="Arrears owed now ($)" value={f.arrears} onChange={(v) => setF({ ...f, arrears: v })} hint="AcreOS records no arrears amount; state it. 0 is a value." />
        <Field id="wk-servicing" label="Servicing cost per month ($)" value={f.servicing} onChange={(v) => setF({ ...f, servicing: v })} hint="0 is a value; blank is not stated." />
        <Field id="wk-remaining" label="Remaining term (months)" value={f.remaining} onChange={(v) => setF({ ...f, remaining: v })} hint="Used only if the note records none." />
        <Field id="wk-value" label="Collateral value basis ($)" value={f.value} onChange={(v) => setF({ ...f, value: v })} hint="Blank uses the parcel record's market value, when there is one." />
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">Hold / perform as-is is always compared. Add the scenarios you want beside it — each uses only what you state.</p>
      <div className="space-y-3">
        {toggle("mod", "Modification")}
        {on.mod && (
          <div className="grid gap-3 pl-6 sm:grid-cols-3">
            <Field id="wk-mod-rate" label="Modified rate (%)" value={mod.rate} onChange={(v) => setMod({ ...mod, rate: v })} />
            <Field id="wk-mod-term" label="Modified term (months)" value={mod.term} onChange={(v) => setMod({ ...mod, term: v })} />
            <div>
              <Label htmlFor="wk-mod-treatment" className="text-xs">Arrears</Label>
              <Select value={mod.treatment} onValueChange={(v) => setMod({ ...mod, treatment: v })}>
                <SelectTrigger id="wk-mod-treatment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="capitalize">Capitalized</SelectItem>
                  <SelectItem value="defer_to_maturity">Deferred to maturity</SelectItem>
                  <SelectItem value="waive">Waived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Field id="wk-mod-forbear" label="Principal forbearance ($, no interest)" value={mod.forbear} onChange={(v) => setMod({ ...mod, forbear: v })} />
            <Field id="wk-mod-reduce" label="Principal reduction ($)" value={mod.reduce} onChange={(v) => setMod({ ...mod, reduce: v })} />
          </div>
        )}
        {toggle("forb", "Forbearance / trial plan")}
        {on.forb && (
          <div className="grid gap-3 pl-6 sm:grid-cols-3">
            <Field id="wk-forb-months" label="Months" value={forb.months} onChange={(v) => setForb({ ...forb, months: v })} />
            <Field id="wk-forb-payment" label="Payment during window ($)" value={forb.payment} onChange={(v) => setForb({ ...forb, payment: v })} />
          </div>
        )}
        {toggle("dil", "Deed-in-lieu")}
        {on.dil && (
          <div className="space-y-3 pl-6">
            <Field id="wk-dil-timeline" label="Timeline (months)" value={dil.timeline} onChange={(v) => setDil({ ...dil, timeline: v })} />
            <CostEditor id="wk-dil-cost" rows={dil.costs} onChange={(c) => setDil({ ...dil, costs: c })} />
          </div>
        )}
        {toggle("fc", "Foreclosure")}
        {on.fc && (
          <div className="space-y-3 pl-6">
            <p className="text-xs text-muted-foreground">AcreOS holds no cited per-state foreclosure timeline or cost data. Enter your own; the run labels them as entered by you.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="wk-fc-timeline" label="Timeline (months)" value={fc.timeline} onChange={(v) => setFc({ ...fc, timeline: v })} />
              <div>
                <Label htmlFor="wk-fc-citation" className="text-xs">Where the timeline comes from (optional)</Label>
                <Input id="wk-fc-citation" value={fc.citation} onChange={(e) => setFc({ ...fc, citation: e.target.value })} placeholder="e.g. local counsel estimate, statute section" />
              </div>
            </div>
            <CostEditor id="wk-fc-cost" rows={fc.costs} onChange={(c) => setFc({ ...fc, costs: c })} />
          </div>
        )}
        {toggle("co", "Charge-off / hold for exit")}
        {on.co && (
          <div className="grid gap-3 pl-6 sm:grid-cols-3">
            <Field id="wk-co-recovery" label="Recovery ($, 0 is a value)" value={co.recovery} onChange={(v) => setCo({ ...co, recovery: v })} />
            <Field id="wk-co-horizon" label="Horizon (months)" value={co.horizon} onChange={(v) => setCo({ ...co, horizon: v })} />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={run.isPending || f.discount.trim() === ""}>{run.isPending ? "Computing…" : "Compare and record"}</Button>
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
    <tr className="border-b last:border-0" data-testid={`workout-input-${k}`}>
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
    <div className="rounded-md border p-3" data-testid={`workout-path-${p.path}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{p.label}</span>
        {p.status === "computed" ? (
          <span className="tabular-nums" data-testid={`workout-npv-${p.path}`}>NPV {dollars(p.npvCents)}</span>
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
    <div className="space-y-3" data-testid="workout-sensitivity">
      <p className="text-sm font-medium">Sensitivity</p>
      <p className="text-xs text-muted-foreground">{CONVENTIONS.sensitivity}.</p>
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
    <div className="space-y-4" data-testid="workout-run">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>As of {formatDate(run.asOf)} · recorded {formatDateTime(run.recordedAt)}</span>
        <Badge variant="outline">{run.engineVersion}</Badge>
        <span>{run.lossMitCaseId ? "Made against the open loss-mit case" : "No loss-mit case was open"}</span>
        {run.supersedesRunId && <span>Supersedes an earlier run</span>}
        {run.reproduction && (
          <Badge variant="outline" data-testid="workout-reproduction">
            {run.reproduction.status === "reproduces" ? "Reproduces from its record" : run.reproduction.status === "differs" ? "Does not reproduce" : "Stored by another engine version"}
          </Badge>
        )}
      </div>
      {run.context.daysDelinquent !== null && (
        <p className="text-xs text-muted-foreground">
          Context at the time: {run.context.daysDelinquent} days past due on the note's aging record
          {run.context.paidThroughDate ? `, paid through ${formatDate(run.context.paidThroughDate)}` : ""}.
        </p>
      )}
      <table className="w-full">
        <caption className="mb-1 text-left text-sm font-medium">Inputs</caption>
        <tbody>{Object.entries(run.provenance).map(([k, p]) => <InputRow key={k} k={k} p={p} />)}</tbody>
      </table>
      {run.context.citations.foreclosure && <p className="text-xs text-muted-foreground">Foreclosure timeline source, as you entered it: {run.context.citations.foreclosure}</p>}
      {r.status === "refused" ? (
        <p className="text-sm" role="alert">Not computed: {r.refusedFor.join(", ")} not available.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Paths are listed in a fixed order, not by value. {CONVENTIONS.discounting}; {CONVENTIONS.npv}.</p>
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
          <p className="text-xs text-muted-foreground">
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
