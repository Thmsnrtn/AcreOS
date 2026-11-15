/**
 * Subdivision decision desk (Subdivision V1, Leg 4, package §6–§7), on the
 * parcel's Subdivision tab.
 *
 * The operator states a scenario, previews the engine's arithmetic over it
 * (nothing is recorded by a preview), and — only when they choose — records a
 * pursue / pass call with a review date. Every form field starts EMPTY: no
 * default, no prefill from the parcel or the yield range (§7.2). An entered
 * field is sent; an empty one is "not entered" and the engine refuses by name.
 * A comparison of the operator's stated scenarios — not advice, no score.
 *
 * Compact on purpose (bundle ceiling): one field list, one renderer.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { ReviewDateChoice, reviewDueAtFromDays } from "@/components/decisions/ReviewDateChoice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { HARD_LINES, SOFT_LINES } from "@shared/subdivision/feasibility";
import { metricById, type MetricUnit } from "@shared/economics/scenario";

// ── Wire shapes (GET /api/subdivision/parcels/:id/desk) ───────────────────
interface RangeEnd { value: number | null; refusedReason: string | null; basis: string | null }
interface Desk {
  latestScreenRun: null | {
    id: number; createdAt: string | null; triggeredCount: number; notDeterminableCount: number; headline: string | null;
    yieldEstimate: { refusedReason: string | null; yield: { low: RangeEnd; high: RangeEnd } };
  };
  decisions: Array<{ id: number; decidedAt: string; kind: string; choice: string; reviewDueAt: string | null; hasOutcome: boolean }>;
  pricingLocks: Array<{ id: number; lockedAt: string | null; lotCount: number; totalAskingCents: number }>;
  criticalPath:
    | { state: "withheld"; reason: string }
    | {
        state: "computed"; elapsedDays: number; p50EndDate: string; p90EndDate: string;
        position: "within_p50" | "between_p50_p90" | "past_p90";
        completedGateCount: number; openGateCount: number;
        slippedGates: Array<{ gateKey: string; label: string; expectedReturnAt: string; daysOverdue: number }>;
        projectedFinish: string | null; projectedFinishWithheldReason: string | null; overrunVsP90Days: number | null;
      };
}
interface Preview {
  metrics: Array<{ id: string; value: number | null; unit: MetricUnit }>;
  assumptions: Array<{ key: string; value: string | number | boolean; origin: string; basis?: string }>;
}

// ── Fields: [wire key, label, kind] — usd = dollars→cents, num = plain, text ──
type Kind = "usd" | "num" | "text";
const LINE_LABELS: Record<(typeof HARD_LINES | typeof SOFT_LINES)[number], string> = {
  gradingCents: "Grading & earthwork", roadsCents: "Roads & right-of-way construction", waterCents: "Water", sewerCents: "Sewer",
  septicCents: "Septic", stormwaterCents: "Stormwater", utilitiesCents: "Utilities extension", landscapingCents: "Landscaping & amenity",
  engineeringSurveyCents: "Engineering & survey", legalCents: "Legal", permittingFeesCents: "Permitting, impact fees & exactions",
  financingCents: "Financing costs", marketingCents: "Marketing & disposition", contingencyCents: "Contingency",
};
const CORE: Array<[string, string, Kind]> = [
  ["landCostCents", "Land cost ($)", "usd"],
  ["lotCount", "Lot count", "num"],
  ["grossProceedsCents", "Gross proceeds ($)", "usd"],
  ["absorptionLotsPerMonth", "Absorption (lots per month)", "num"],
  ["phaseLotCounts", "Phase lot counts, e.g. 4,4,4 (optional)", "text"],
];
const REST: Array<[string, string, Kind]> = [
  ...[...HARD_LINES, ...SOFT_LINES].map((k): [string, string, Kind] => [k, `${LINE_LABELS[k]} ($, optional)`, "usd"]),
  ["timelineP50Days", "Your p50 timeline (days)", "num"],
  ["timelineP90Days", "Your p90 timeline (days)", "num"],
  ["holdingCostMonthlyCents", "Holding cost per month ($)", "usd"],
  ["debtPrincipalCents", "Debt principal ($)", "usd"],
  ["debtRatePct", "Debt rate (%)", "num"],
  ["opportunityCostPct", "Opportunity cost (%)", "num"],
];
const FIELDS = [...CORE, ...REST];

const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (s: string | null) => formatDate(s);
// Date-only values parse as LOCAL midnight before formatting, so the house
// formatter never shifts them a day (a bare "YYYY-MM-DD" parses as UTC).
const dateOnly = (s: string) => formatDate(new Date(`${s}T00:00:00`));
const POSITION = { within_p50: "within the p50 window", between_p50_p90: "past p50, within p90", past_p90: "past the p90 date" } as const;
const NOOP = { label: "", _noOp: true } as const;

function fmt(value: number | null, unit: MetricUnit): string {
  if (value === null) return "not computed — an input it needs was not entered";
  if (unit === "cents") return usd(value);
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "percent") return `${value}%`;
  if (unit === "multiple") return `${value}×`;
  return `${value} ${unit}`;
}

/** The wire inputs from the form — ONE builder for preview and record, so they cannot differ. */
function buildInputs(form: Record<string, string>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, , kind] of FIELDS) {
    const t = (form[k] ?? "").trim();
    if (!t) continue;
    out[k] = kind === "text" || !Number.isFinite(Number(t)) ? t : kind === "usd" ? Math.round(Number(t) * 100) : Number(t);
  }
  if (form.wastewater) out.wastewater = form.wastewater;
  return out;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "x-csrf-token": csrf() }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message ?? `Failed (${res.status})`);
  return j as T;
}

export function SubdivisionDecisionDeskSection({ parentParcelId }: { parentParcelId: number }) {
  const key = ["/api/subdivision/parcels", parentParcelId, "desk"];
  const desk = useQuery<Desk>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/subdivision/parcels/${parentParcelId}/desk`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"pursue" | "pass" | "">("");
  const [choice, setChoice] = useState("");
  const [rationale, setRationale] = useState("");
  const [reviewDays, setReviewDays] = useState<number | null | undefined>(undefined);
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  // allow-no-invalidation: preview computes only and records nothing — result is read from mutation state, no cached reads change
  const preview = useMutation({ mutationFn: () => post<Preview>("/api/scenarios/preview", { engineId: "subdivision_feasibility", inputs: buildInputs(form) }) });
  const record = useMutation({
    mutationFn: () =>
      post<{ decision?: { id: number }; scenario?: { id: number }; decisionId?: number; scenarioId?: number }>("/api/subdivision/decide", {
        propertyId: parentParcelId, inputs: buildInputs(form), kind, choice: choice.trim(), rationale: rationale.trim(),
        reviewDueAt: reviewDays === undefined ? null : reviewDueAtFromDays(reviewDays),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const canRecord = kind !== "" && choice.trim() !== "" && rationale.trim().length >= 10 && reviewDays !== undefined && !record.isPending;
  const d = desk.data;
  const run = d?.latestScreenRun;
  const cp = d?.criticalPath;
  const rec = record.data;
  const field = ([k, label, kd]: [string, string, Kind]) => (
    <div key={k} className="space-y-1">
      <Label htmlFor={`sd-${k}`}>{label}</Label>
      <Input id={`sd-${k}`} inputMode={kd === "text" ? undefined : "decimal"} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  return (
    <Card data-testid="subdiv-desk">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Gavel className="w-4 h-4" aria-hidden="true" /> Decision desk</CardTitle>
        <CardDescription>
          A comparison of the scenarios you state — not advice, not a recommendation, no score. A preview records nothing;
          only "Record the decision" writes anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {desk.isLoading ? <Skeleton className="h-24" /> : desk.isError ? (
          <QueryErrorState error={desk.error as Error} onRetry={() => desk.refetch()} isRetrying={desk.isFetching} compact testId="subdiv-desk-error" />
        ) : d && (
          <>
            <section className="space-y-1 text-sm" data-testid="subdiv-desk-review" aria-label="Review: the screen and the yield">
              <h3 className="font-medium">Review — the screen and the yield</h3>
              {run ? (
                <>
                  <p role="status">{run.headline ?? "Screen run on record."}</p>
                  <p className="text-xs text-muted-foreground">From the screen record of {day(run.createdAt)}: {run.triggeredCount} triggered, {run.notDeterminableCount} not determinable.</p>
                  {run.yieldEstimate.refusedReason ? <p>Yield not estimated — {run.yieldEstimate.refusedReason}.</p> : (["low", "high"] as const).map((e) => {
                    const r = run.yieldEstimate.yield[e];
                    return (
                      <p key={e}>Yield, {e}: {r.value === null ? `not computed — ${r.refusedReason}` : `${r.value} lots`}
                        {r.basis && <span className="block text-xs text-muted-foreground">{r.basis}</span>}</p>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">Shown as a fact from the screen record. It is not copied into the form below.</p>
                </>
              ) : (
                // TODO(cta): the screen lives in the section above this desk — no action of the desk's own to offer here.
                <EmptyState icon={Gavel} headline="No screen has been run on this parcel yet"
                  subtitle="You can still record a decision; the record will say it was made unscreened." cta={NOOP} testId="subdiv-desk-unscreened" />
              )}
            </section>

            <section className="space-y-2" data-testid="subdiv-desk-scenario" aria-label="Feasibility: your stated scenario">
              <h3 className="text-sm font-medium">Feasibility — your stated scenario</h3>
              <p className="text-xs text-muted-foreground">Every field starts empty. A field you leave empty is "not entered" and the engine will say so by name.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CORE.map(field)}
                <div className="space-y-1">
                  <Label htmlFor="sd-wastewater">Wastewater</Label>
                  <select id="sd-wastewater" className={`h-9 w-full rounded-md border border-input bg-background px-2 text-sm ${FOCUS}`} value={form.wastewater ?? ""} onChange={(e) => set("wastewater", e.target.value)}>
                    <option value="">Not stated</option><option value="sewer">Sewer</option><option value="septic">Septic</option>
                  </select>
                </div>
                {REST.map(field)}
              </div>
              <Button size="sm" variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending} data-testid="subdiv-desk-preview-button">Preview (records nothing)</Button>
              {preview.isError && <p role="alert" className="text-sm text-destructive" data-testid="subdiv-desk-refusal">{(preview.error as Error).message}</p>}
              {preview.data && (
                <div className="border rounded-md p-2 text-sm space-y-1" data-testid="subdiv-desk-preview">
                  <p className="text-xs text-muted-foreground">Engine output of the inputs you stated — not a recommendation.</p>
                  {preview.data.metrics.map((m) => <p key={m.id}>{metricById(m.id)?.label ?? m.id}: {fmt(m.value, m.unit)}</p>)}
                  <ul className="text-xs space-y-0.5">
                    {preview.data.assumptions.map((a) => (
                      <li key={a.key}>{a.key.replace(/_/g, " ")}: {String(a.value)} <Badge variant="outline">{a.origin}</Badge>{a.basis && ` — ${a.basis}`}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="space-y-2" data-testid="subdiv-desk-record" aria-label="Record the decision">
              <h3 className="text-sm font-medium">Record the decision</h3>
              <fieldset className="flex gap-4 text-sm">
                <legend className="sr-only">Decision kind</legend>
                {([["pursue", "Proceed"], ["pass", "Pass"]] as const).map(([v, t]) => (
                  <label key={v} className="flex items-center gap-1">
                    <input type="radio" name="subdiv-desk-kind" value={v} checked={kind === v} onChange={() => setKind(v)} className={FOCUS} data-testid={`subdiv-desk-kind-${v}`} />{t}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1">
                <Label htmlFor="sd-choice">Your call, in your words</Label>
                <Input id="sd-choice" value={choice} onChange={(e) => setChoice(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sd-rationale">Rationale (at least 10 characters)</Label>
                <textarea id="sd-rationale" rows={3} className={`w-full rounded-md border border-input bg-background px-2 py-1 text-sm ${FOCUS}`} value={rationale} onChange={(e) => setRationale(e.target.value)} />
              </div>
              <ReviewDateChoice value={reviewDays} onChange={setReviewDays} testIdPrefix="subdiv-desk-review-in" />
              <p className="text-xs text-muted-foreground">Records exactly the inputs you stated above, plus the screen record{run ? ` (run ${run.id})` : " — or that none was run"}.</p>
              <Button size="sm" onClick={() => record.mutate()} disabled={!canRecord} data-testid="subdiv-desk-record-button">Record the decision</Button>
              {record.isError && <p role="alert" className="text-sm text-destructive">{(record.error as Error).message}</p>}
              {record.isSuccess && (
                <p role="status" className="text-sm" data-testid="subdiv-desk-recorded">
                  Recorded — decision {rec?.decision?.id ?? rec?.decisionId ?? "saved"}, scenario {rec?.scenario?.id ?? rec?.scenarioId ?? "saved"}.
                </p>
              )}
            </section>

            <section className="space-y-2 text-sm" data-testid="subdiv-desk-history" aria-label="Decisions and pricing locks on this parcel">
              <h3 className="font-medium">Decisions and pricing locks on this parcel</h3>
              {d.decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="subdiv-desk-decisions-empty">No subdivision decision recorded on this parcel yet. Recording nothing is how you defer.</p>
              ) : (
                <ul className="space-y-1" data-testid="subdiv-desk-decisions">
                  {d.decisions.map((x) => (
                    <li key={x.id} className="border rounded-md p-2 text-xs">
                      <span className="font-medium">{x.kind === "pursue" ? "Proceed" : "Pass"}</span> — {x.choice} · decided {day(x.decidedAt)} · review {x.reviewDueAt ? day(x.reviewDueAt) : "no set date"}
                      {x.reviewDueAt && ` · ${x.hasOutcome ? "outcome recorded" : "outcome not yet recorded"}`}
                    </li>
                  ))}
                </ul>
              )}
              {d.pricingLocks.length === 0 ? (
                <p className="text-xs text-muted-foreground" data-testid="subdiv-desk-locks-empty">No pricing grid has been locked on this parcel.</p>
              ) : (
                <ul className="space-y-1" data-testid="subdiv-desk-locks">
                  {d.pricingLocks.map((l) => <li key={l.id} className="border rounded-md p-2 text-xs">Locked {day(l.lockedAt)} · {l.lotCount} lots · {usd(l.totalAskingCents)} total asking</li>)}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">A pricing lock is a pricing act — its record cites no scenario and carries no review date, so it is not outcome-graded; go-decisions recorded at this desk are.</p>
            </section>

            <section className="space-y-1 text-sm" data-testid="subdiv-desk-path" aria-label="Entitlement path">
              <h3 className="font-medium">Entitlement path</h3>
              {cp?.state === "computed" ? (
                <>
                  <p role="status">Day {cp.elapsedDays} — {POSITION[cp.position]} (p50 ends {dateOnly(cp.p50EndDate)}, p90 ends {dateOnly(cp.p90EndDate)}). {cp.completedGateCount} gates complete, {cp.openGateCount} open.</p>
                  {cp.slippedGates.map((g) => <p key={g.gateKey} className="text-xs">Slipped: {g.label} — expected {dateOnly(g.expectedReturnAt)}, {g.daysOverdue} days overdue</p>)}
                  {cp.projectedFinish ? (
                    <p className="text-xs">Projected finish {dateOnly(cp.projectedFinish)} (latest return date you recorded on an open gate)
                      {cp.overrunVsP90Days !== null && `, ${cp.overrunVsP90Days > 0 ? `${cp.overrunVsP90Days} days past` : `${-cp.overrunVsP90Days} days within`} the p90 date`}.</p>
                  ) : cp.projectedFinishWithheldReason && <p className="text-xs">No projected finish — {cp.projectedFinishWithheldReason}</p>}
                  <p className="text-xs text-muted-foreground">Measured against the timeline you stated on your latest decision of {day(d.decisions[0]?.decidedAt ?? null)} — your figures, frozen on that record. No county timeline is used.</p>
                </>
              ) : cp && (
                // TODO(cta): the fix is recording a decision with a stated timeline (the form above) — no separate action to offer.
                <EmptyState icon={Gavel} headline="Entitlement path withheld" subtitle={cp.reason} cta={NOOP} testId="subdiv-desk-path-withheld" />
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
