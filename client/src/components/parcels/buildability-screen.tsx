/**
 * Buildability screen + lot-yield estimate (Subdivision V1, Legs 1–2), on the
 * parcel's Subdivision tab.
 *
 * The operator records the facts they hold — each with its source and as-of —
 * and the thresholds for this run; the server computes the yield estimate and
 * the seven kill-trigger verdicts through the shared modules and APPENDS a run.
 * Nothing is computed here. Every field starts empty (no platform figure is
 * prefilled); a blank fact is recorded as unknown, and unknown is never shown
 * as clear. The headline never says "buildable".
 *
 * Written compactly on purpose: the total-JS ceiling in scripts/bundle-budget.json
 * only goes down, so the panel is data-driven (one field list, one renderer)
 * rather than one JSX block per input.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient } from "@/lib/queryClient";

// ── Wire shapes (the server's ScreenResult / LotYieldEstimate, as stored) ──
interface Evidence { fact: string; value: string; source: string; asOf: string | null }
interface TriggerVerdict {
  id: string;
  label: string;
  verdict: "triggered" | "clear_on_evidence" | "not_determinable";
  reason: string;
  evidence: Evidence[];
  resolution: { action: string; cost: string; owner: string } | null;
}
interface RangeEnd { value: number | null; refusedReason: string | null; basis: string | null }
interface YieldEstimate {
  version: string;
  refusedReason: string | null;
  grossAcres: { value: number; source: string; asOf: string | null } | null;
  deductions: Array<{ key: string; label: string; status: "stated" | "not_determinable"; acres: number | null; source: string | null; asOf: string | null; resolution: string | null }>;
  yield: { low: RangeEnd; high: RangeEnd };
}
type Recon = Array<{ planId: string; statement: string }>;
interface ScreenRun {
  id: number;
  createdAt: string;
  triggeredCount: number;
  notDeterminableCount: number;
  yieldEstimate: YieldEstimate;
  result: { headline: string; verdicts: TriggerVerdict[] };
  reconciliationAtRun: Recon;
}
interface RunsResponse { runs: ScreenRun[]; latestReconciliation: Recon; truncated: boolean }

// ── Fields ───────────────────────────────────────────────────────────────
type Draft = { value: string; source: string; asOf: string };
const YN: Opt[] = [["true", "Yes"], ["false", "No"]];
type Opt = [string, string];
/** Sourced facts: [key, label, options?]. No options = a number of 0 or more. */
const FACTS: Array<[string, string, Opt[]?]> = [
  ["legalAccess", "Legal access", [["recorded_access", "Recorded legal access"], ["no_legal_access", "No legal access"], ["unrecorded_easement_only", "Only an unrecorded / unresolved easement"]]],
  ["percResult", "Perc test result (your own test)", [["pass", "Passed"], ["fail", "Failed"]]],
  ["sewerAvailable", "Public sewer available", YN],
  ["waterAvailable", "Water available", YN],
  ["grossAcres", "Gross acres (blank uses the parcel record's acreage)"],
  ["floodwayAcres", "Floodway acres"],
  ["floodplainAcres", "Floodplain acres (outside the floodway)"],
  ["unresolvedEasementAcres", "Buildable acres crossed by an unresolved easement"],
  ["maxSlopePct", "Steepest buildable slope (%)"],
  ["easementAcres", "Easement-encumbered acres (yield deduction)"],
  ["unbuildableSlopeAcres", "Unbuildable-slope acres (yield deduction)"],
];
/** Facts that are yield deductions rather than screen facts (sent under `yield`). */
const YIELD_KEYS = ["easementAcres", "unbuildableSlopeAcres"];
/** Unsourced run settings: [id, label, problem label, max]. */
const SETTINGS: Array<[string, string, string, number | null]> = [
  ["floodplain-pct", "Your floodplain-share threshold for this run (%)", "Floodplain-share threshold", 100],
  ["slope-max", "Your slope build threshold for this run (%)", "Slope build threshold", null],
  ["roads", "Roads / right-of-way allowance (% of the parcel)", "Roads / right-of-way allowance", 99.99],
  ["min-lot", "Minimum lot (acres), as you read the county's rule", "Minimum lot", null],
  ["min-lot-cite", "Citation (where you read it)", "", null],
  ["target-lot", "Your target lot size (acres)", "Target lot size", null],
];

const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
const num = (s = ""): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
/** A finite number of 0 or more (and at most `max`); "Infinity" and "NaN" are refused, not passed through. */
const okNum = (t: string, max: number | null = null) => { const n = num(t); return n !== null && n >= 0 && (max === null || n <= max); };
const asOf = (a: string | null) => (a ? ` (as of ${a})` : "");
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BADGE = { triggered: ["triggered", "destructive"], clear_on_evidence: ["clear on evidence", "secondary"], not_determinable: ["not determinable", "outline"] } as const;

/**
 * Row-level refusals, named by field: a value with no source, a source with no
 * value, or a number that does not parse is NEVER silently dropped — the run
 * waits until the operator fixes or clears it.
 */
function problemsOf(facts: Record<string, Draft>, s: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, label, opts] of FACTS) {
    const d = facts[k];
    const v = d.value.trim();
    if (v && !opts && !okNum(v)) out.push(`${label}: "${v}" is not a number of 0 or more — fix it or clear it.`);
    if (v && !d.source.trim()) out.push(`${label}: add where this value comes from (its source), or clear the value.`);
    if (!v && (d.source.trim() || d.asOf.trim())) out.push(`${label}: a source was entered with no value — enter the value or clear the source.`);
  }
  const min = s["min-lot"].trim();
  const cite = s["min-lot-cite"].trim();
  if (min && !cite) out.push("Minimum lot: add where you read it (its citation), or clear the value.");
  if (!min && cite) out.push("Minimum lot: a citation was entered with no acreage — enter it or clear the citation.");
  for (const [id, , label, max] of SETTINGS) {
    const t = s[id].trim();
    if (label && t && !okNum(t, max)) out.push(`${label}: "${t}" is not a valid number — fix it or clear it.`);
  }
  return out;
}

function RunView({ run, today }: { run: ScreenRun; today: Recon | null }) {
  const y = run.yieldEstimate;
  const recon = (rows: Recon, prefix: string, aria: string) =>
    rows.length > 0 && (
      <ul className="text-xs space-y-0.5" aria-label={aria}>
        {rows.map((p) => <li key={p.planId}>{prefix} — {p.statement}</li>)}
      </ul>
    );
  return (
    <div className="space-y-3" data-testid="screen-run">
      <p className="text-sm font-medium" role="status" data-testid="screen-headline">{run.result.headline}</p>
      <ul className="space-y-2">
        {run.result.verdicts.map((v) => (
          <li key={v.id} className="border rounded-md p-2 text-sm" data-testid={`screen-verdict-${v.id}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{v.label}</span>
              <Badge variant={BADGE[v.verdict][1]}>{BADGE[v.verdict][0]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{v.reason}</p>
            {v.evidence.map((e, i) => <p key={i} className="text-xs mt-1">{e.fact}: {e.value} — {e.source}{asOf(e.asOf)}</p>)}
            {v.resolution && <p className="text-xs mt-1">To resolve: {v.resolution.action} · {v.resolution.cost} · {v.resolution.owner}</p>}
          </li>
        ))}
      </ul>
      <div className="border rounded-md p-2 text-sm space-y-1" data-testid="screen-yield">
        <p className="font-medium">Lot-yield estimate ({y.version})</p>
        {y.grossAcres && <p className="text-xs">Gross {y.grossAcres.value} ac — {y.grossAcres.source}{asOf(y.grossAcres.asOf)}</p>}
        {y.refusedReason ? (
          <p>Not estimated — {y.refusedReason}.</p>
        ) : (
          <>
            {y.deductions.map((d) => (
              <p key={d.key} className="text-xs">
                {d.status === "stated" ? `− ${d.label}: ${d.acres} ac — ${d.source}${asOf(d.asOf)}` : `${d.label}: not determinable — to resolve: ${d.resolution}`}
              </p>
            ))}
            {(["low", "high"] as const).map((end) => {
              const r = y.yield[end];
              return (
                <p key={end}>
                  Yield, {end}: {r.value === null ? `not computed — ${r.refusedReason}` : `${r.value} lots`}
                  {r.basis && <span className="block text-xs text-muted-foreground">{r.basis}</span>}
                </p>
              );
            })}
          </>
        )}
        {recon(run.reconciliationAtRun, "At this run", "Drawn plans beside the estimate, as they stood at this run")}
        {today && recon(today, "Today", "Today's drawn plans beside this run's estimate")}
        <p className="text-xs text-muted-foreground">An estimate — not a survey, not an engineering yield, and not a county's determination.</p>
      </div>
    </div>
  );
}

export function BuildabilityScreenSection({ parentParcelId }: { parentParcelId: number }) {
  const key = ["/api/parcels", parentParcelId, "screen-runs"];
  const runs = useQuery<RunsResponse>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/parcels/${parentParcelId}/screen-runs`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [facts, setFacts] = useState<Record<string, Draft>>(() => Object.fromEntries(FACTS.map(([k]) => [k, { value: "", source: "", asOf: "" }])));
  const [s, setS] = useState<Record<string, string>>(() => Object.fromEntries(SETTINGS.map(([id]) => [id, ""])));
  const [formOpen, setFormOpen] = useState(false);
  const problems = problemsOf(facts, s);
  const edit = (k: string, field: keyof Draft, v: string) => setFacts({ ...facts, [k]: { ...facts[k], [field]: v } });

  const run = useMutation({
    mutationFn: async () => {
      /**
       * A fact is recorded only with both a value and its source (the form refuses either alone first).
       * Parse by kind: yes/no options → boolean, other options → their value, no options → number.
       */
      const out: Record<"facts" | "yield", Record<string, unknown>> = { facts: {}, yield: {} };
      for (const [k, , opts] of FACTS) {
        const d = facts[k];
        const raw = d.value.trim();
        const v = raw === "" ? null : opts === YN ? raw === "true" : opts ? raw : num(raw);
        out[YIELD_KEYS.includes(k) ? "yield" : "facts"][k] = v === null || !d.source.trim() ? null : { value: v, source: d.source.trim(), asOf: d.asOf.trim() || null };
      }
      const pct = (id: string) => { const n = num(s[id]); return n === null ? null : n / 100; };
      const min = num(s["min-lot"]);
      const cite = s["min-lot-cite"].trim();
      const body = {
        facts: out.facts,
        thresholds: { floodplainShareMax: pct("floodplain-pct"), maxBuildableSlopePct: num(s["slope-max"]) },
        yield: { ...out.yield, roadsRowFraction: pct("roads"), minimumLot: min !== null && cite ? { acres: min, citation: cite } : null, targetLotAcres: num(s["target-lot"]) },
      };
      const res = await fetch(`/api/parcels/${parentParcelId}/screen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const list = runs.data?.runs ?? [];
  const shown = list.find((r) => r.id === selectedId) ?? list[0] ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" aria-hidden="true" /> Buildability screen
        </CardTitle>
        <CardDescription>
          Seven kill triggers, checked against the facts you record. Unknown is never shown as clear. Every run is
          kept; re-running adds a run beside the old one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.isLoading ? (
          <Skeleton className="h-24" />
        ) : runs.isError ? (
          <QueryErrorState error={runs.error as Error} onRetry={() => runs.refetch()} isRetrying={runs.isFetching} compact testId="screen-error" />
        ) : shown ? (
          <>
            <RunView run={shown} today={shown.id === list[0].id ? runs.data?.latestReconciliation ?? null : null} />
            {list.length > 1 && (
              <div>
                <p className="text-xs font-medium mb-1">Run history</p>
                {list.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`block text-left text-xs underline-offset-2 hover:underline rounded ${FOCUS}`}
                    aria-pressed={r.id === shown.id}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {new Date(r.createdAt).toLocaleString()} — {r.triggeredCount} triggered, {r.notDeterminableCount} not determinable
                  </button>
                ))}
                {runs.data?.truncated && <p className="text-xs text-muted-foreground mt-1">Showing the newest 50 runs; older runs are kept.</p>}
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={ShieldAlert}
            headline="Not yet screened"
            subtitle="Record the facts you hold and run the screen. Anything you leave blank is listed as not determinable, with what would resolve it."
            cta={{ label: "Record facts", onClick: () => setFormOpen(true), "data-testid": "screen-empty-cta" }}
            testId="screen-empty"
          />
        )}

        <details className="border rounded-md p-3" open={formOpen} onToggle={(e) => setFormOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary className={`cursor-pointer text-sm font-medium rounded ${FOCUS}`}>Record facts and run the screen</summary>
          <div className="grid gap-3 sm:grid-cols-2 pt-3">
            {FACTS.map(([k, label, opts]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`bs-${k}`}>{label}</Label>
                {opts ? (
                  <select id={`bs-${k}`} className={`h-9 w-full rounded-md border border-input bg-background px-2 text-sm ${FOCUS}`} value={facts[k].value} onChange={(e) => edit(k, "value", e.target.value)}>
                    <option value="">Not recorded</option>
                    {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                ) : (
                  <Input id={`bs-${k}`} inputMode="decimal" value={facts[k].value} onChange={(e) => edit(k, "value", e.target.value)} />
                )}
                {(["source", "asOf"] as const).map((f) => (
                  <div key={f} className="space-y-1">
                    <Label htmlFor={`bs-${k}-${f.toLowerCase()}`} className="text-xs">
                      {f === "source" ? "Source" : "As of (optional)"}<span className="sr-only"> for {label}</span>
                    </Label>
                    <Input id={`bs-${k}-${f.toLowerCase()}`} value={facts[k][f]} onChange={(e) => edit(k, f, e.target.value)} />
                  </div>
                ))}
              </div>
            ))}
            {SETTINGS.map(([id, label]) => (
              <div key={id} className="space-y-1">
                <Label htmlFor={`bs-${id}`}>{label}</Label>
                <Input id={`bs-${id}`} inputMode={id === "min-lot-cite" ? undefined : "decimal"} value={s[id]} onChange={(e) => setS({ ...s, [id]: e.target.value })} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground pt-2">A fact counts as recorded only with its source.</p>
          {problems.length > 0 && (
            <ul role="alert" className="text-sm text-destructive mt-2 space-y-0.5" data-testid="screen-problems">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <Button size="sm" className="mt-2" onClick={() => run.mutate()} disabled={run.isPending || problems.length > 0} data-testid="screen-run-button">
            Run the screen
          </Button>
          {run.isError && <p role="alert" className="text-sm text-destructive mt-2">{(run.error as Error).message}</p>}
        </details>
      </CardContent>
    </Card>
  );
}
