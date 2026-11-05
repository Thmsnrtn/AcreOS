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

interface Evidence {
  fact: string;
  value: string;
  source: string;
  asOf: string | null;
}
interface TriggerVerdict {
  id: string;
  label: string;
  verdict: "triggered" | "clear_on_evidence" | "not_determinable";
  reason: string;
  evidence: Evidence[];
  resolution: { action: string; cost: string; owner: string } | null;
}
interface RangeEnd {
  value: number | null;
  refusedReason: string | null;
  basis: string | null;
}
interface YieldEstimate {
  version: string;
  refusedReason: string | null;
  grossAcres: { value: number; source: string; asOf: string | null } | null;
  deductions: Array<{ key: string; label: string; status: "stated" | "not_determinable"; acres: number | null; source: string | null; asOf: string | null; resolution: string | null }>;
  yield: { low: RangeEnd; high: RangeEnd };
}
interface ScreenRun {
  id: number;
  ruleVersion: string;
  createdAt: string;
  triggeredCount: number;
  notDeterminableCount: number;
  yieldEstimate: YieldEstimate;
  result: { headline: string; verdicts: TriggerVerdict[] };
  reconciliationAtRun: Array<{ planId: string; statement: string }>;
}
interface RunsResponse {
  runs: ScreenRun[];
  latestReconciliation: Array<{ planId: string; statement: string }>;
  truncated: boolean;
}

// ── Form drafts ──────────────────────────────────────────────────────────

type Draft = { value: string; source: string; asOf: string };
const empty: Draft = { value: "", source: "", asOf: "" };

const NUMERIC_FACTS = [
  { key: "grossAcres", label: "Gross acres (blank uses the parcel record's acreage)", group: "facts" },
  { key: "floodwayAcres", label: "Floodway acres", group: "facts" },
  { key: "floodplainAcres", label: "Floodplain acres (outside the floodway)", group: "facts" },
  { key: "unresolvedEasementAcres", label: "Buildable acres crossed by an unresolved easement", group: "facts" },
  { key: "maxSlopePct", label: "Steepest buildable slope (%)", group: "facts" },
  { key: "easementAcres", label: "Easement-encumbered acres (yield deduction)", group: "yield" },
  { key: "unbuildableSlopeAcres", label: "Unbuildable-slope acres (yield deduction)", group: "yield" },
] as const;

const CHOICE_FACTS = [
  {
    key: "legalAccess",
    label: "Legal access",
    options: [
      ["recorded_access", "Recorded legal access"],
      ["no_legal_access", "No legal access"],
      ["unrecorded_easement_only", "Only an unrecorded / unresolved easement"],
    ],
  },
  { key: "percResult", label: "Perc test result (your own test)", options: [["pass", "Passed"], ["fail", "Failed"]] },
  { key: "sewerAvailable", label: "Public sewer available", options: [["true", "Yes"], ["false", "No"]] },
  { key: "waterAvailable", label: "Water available", options: [["true", "Yes"], ["false", "No"]] },
] as const;

const csrf = () => decodeURIComponent(document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "");
const num = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** A fact is recorded only with both a value and its source (the form refuses either alone first). */
function recordedFact(d: Draft, parse: (v: string) => unknown) {
  const v = d.value.trim() === "" ? null : parse(d.value);
  if (v === null || v === undefined || !d.source.trim()) return null;
  return { value: v, source: d.source.trim(), asOf: d.asOf.trim() || null };
}

/**
 * Row-level refusals, named by field: a value with no source, a source with no
 * value, or a number that does not parse is NEVER silently dropped — the run
 * waits until the operator fixes or clears it.
 */
function draftProblems(label: string, d: Draft, numeric: boolean): string[] {
  const hasValue = d.value.trim() !== "";
  const hasSource = d.source.trim() !== "";
  const out: string[] = [];
  if (hasValue && numeric && !(Number.isFinite(Number(d.value)) && Number(d.value) >= 0)) out.push(`${label}: "${d.value}" is not a number of 0 or more — fix it or clear it.`);
  if (hasValue && !hasSource) out.push(`${label}: add where this value comes from (its source), or clear the value.`);
  if (!hasValue && (hasSource || d.asOf.trim() !== "")) out.push(`${label}: a source was entered with no value — enter the value or clear the source.`);
  return out;
}

const VERDICT_BADGE: Record<TriggerVerdict["verdict"], { text: string; variant: "destructive" | "secondary" | "outline" }> = {
  triggered: { text: "triggered", variant: "destructive" },
  clear_on_evidence: { text: "clear on evidence", variant: "secondary" },
  not_determinable: { text: "not determinable", variant: "outline" },
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function RunView({ run, today }: { run: ScreenRun; today: Array<{ planId: string; statement: string }> | null }) {
  const y = run.yieldEstimate;
  return (
    <div className="space-y-3" data-testid="screen-run">
      <p className="text-sm font-medium" role="status" data-testid="screen-headline">
        {run.result.headline}
      </p>
      <ul className="space-y-2">
        {run.result.verdicts.map((v) => (
          <li key={v.id} className="border rounded-md p-2 text-sm" data-testid={`screen-verdict-${v.id}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{v.label}</span>
              <Badge variant={VERDICT_BADGE[v.verdict].variant}>{VERDICT_BADGE[v.verdict].text}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{v.reason}</p>
            {v.evidence.length > 0 && (
              <ul className="text-xs mt-1 space-y-0.5">
                {v.evidence.map((e, i) => (
                  <li key={i}>
                    {e.fact}: {e.value} — {e.source}
                    {e.asOf ? ` (as of ${e.asOf})` : ""}
                  </li>
                ))}
              </ul>
            )}
            {v.resolution && (
              <p className="text-xs mt-1">
                To resolve: {v.resolution.action} · {v.resolution.cost} · {v.resolution.owner}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="border rounded-md p-2 text-sm space-y-1" data-testid="screen-yield">
        <p className="font-medium">Lot-yield estimate ({y.version})</p>
        {y.grossAcres && (
          <p className="text-xs">
            Gross {y.grossAcres.value} ac — {y.grossAcres.source}
            {y.grossAcres.asOf ? ` (as of ${y.grossAcres.asOf})` : ""}
          </p>
        )}
        {y.refusedReason ? (
          <p>Not estimated — {y.refusedReason}.</p>
        ) : (
          <>
            {y.deductions.map((d) => (
              <p key={d.key} className="text-xs">
                {d.status === "stated"
                  ? `− ${d.label}: ${d.acres} ac — ${d.source}${d.asOf ? ` (as of ${d.asOf})` : ""}`
                  : `${d.label}: not determinable — to resolve: ${d.resolution}`}
              </p>
            ))}
            {(["low", "high"] as const).map((end) => {
              const r = y.yield[end];
              return (
                <p key={end}>
                  Yield, {end}: {r.value === null ? `not computed — ${r.refusedReason}` : `${r.value} lots`}
                  {r.basis ? <span className="block text-xs text-muted-foreground">{r.basis}</span> : null}
                </p>
              );
            })}
          </>
        )}
        {run.reconciliationAtRun.length > 0 && (
          <ul className="text-xs space-y-0.5 pt-1" aria-label="Drawn plans beside the estimate, as they stood at this run">
            {run.reconciliationAtRun.map((p) => (
              <li key={p.planId}>At this run — {p.statement}</li>
            ))}
          </ul>
        )}
        {today && today.length > 0 && (
          <ul className="text-xs space-y-0.5" aria-label="Today's drawn plans beside this run's estimate">
            {today.map((p) => (
              <li key={p.planId}>Today — {p.statement}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">An estimate — not a survey, not an engineering yield, and not a county&apos;s determination.</p>
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
  const [nums, setNums] = useState<Record<string, Draft>>(Object.fromEntries(NUMERIC_FACTS.map((f) => [f.key, empty])));
  const [choices, setChoices] = useState<Record<string, Draft>>(Object.fromEntries(CHOICE_FACTS.map((f) => [f.key, empty])));
  const [floodplainPct, setFloodplainPct] = useState("");
  const [slopeMax, setSlopeMax] = useState("");
  const [roadsPct, setRoadsPct] = useState("");
  const [minLot, setMinLot] = useState("");
  const [minLotCite, setMinLotCite] = useState("");
  const [targetLot, setTargetLot] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const problems = [
    ...CHOICE_FACTS.flatMap((f) => draftProblems(f.label, choices[f.key], false)),
    ...NUMERIC_FACTS.flatMap((f) => draftProblems(f.label, nums[f.key], true)),
    ...(minLot.trim() !== "" && !minLotCite.trim() ? ["Minimum lot: add where you read it (its citation), or clear the value."] : []),
    ...(minLot.trim() === "" && minLotCite.trim() ? ["Minimum lot: a citation was entered with no acreage — enter it or clear the citation."] : []),
    ...[
      ["Floodplain-share threshold", floodplainPct, 100],
      ["Slope build threshold", slopeMax, null],
      ["Roads / right-of-way allowance", roadsPct, 99.99],
      ["Minimum lot", minLot, null],
      ["Target lot size", targetLot, null],
    ].flatMap(([label, v, max]) => {
      const t = String(v).trim();
      if (t === "") return [];
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 && (max === null || n <= (max as number)) ? [] : [`${label}: "${t}" is not a valid number — fix it or clear it.`];
    }),
  ];

  const run = useMutation({
    mutationFn: async () => {
      const n = (k: string) => recordedFact(nums[k], (v) => num(v));
      const bool = (v: string) => (v === "true" ? true : v === "false" ? false : null);
      const fp = num(floodplainPct);
      const roads = num(roadsPct);
      const min = num(minLot);
      const body = {
        facts: {
          legalAccess: recordedFact(choices.legalAccess, (v) => v),
          grossAcres: n("grossAcres"),
          floodwayAcres: n("floodwayAcres"),
          floodplainAcres: n("floodplainAcres"),
          percResult: recordedFact(choices.percResult, (v) => v),
          sewerAvailable: recordedFact(choices.sewerAvailable, bool),
          waterAvailable: recordedFact(choices.waterAvailable, bool),
          unresolvedEasementAcres: n("unresolvedEasementAcres"),
          maxSlopePct: n("maxSlopePct"),
        },
        thresholds: { floodplainShareMax: fp === null ? null : fp / 100, maxBuildableSlopePct: num(slopeMax) },
        yield: {
          easementAcres: n("easementAcres"),
          unbuildableSlopeAcres: n("unbuildableSlopeAcres"),
          roadsRowFraction: roads === null ? null : roads / 100,
          minimumLot: min !== null && minLotCite.trim() ? { acres: min, citation: minLotCite.trim() } : null,
          targetLotAcres: num(targetLot),
        },
      };
      const res = await fetch(`/api/parcels/${parentParcelId}/screen`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const list = runs.data?.runs ?? [];
  const shown = list.find((r) => r.id === selectedId) ?? list[0] ?? null;
  const isLatest = shown !== null && shown.id === list[0]?.id;

  const draftInputs = (state: Record<string, Draft>, set: (s: Record<string, Draft>) => void, k: string, label: string) => (
    <>
      <Label htmlFor={`bs-${k}-source`} className="text-xs">
        Source<span className="sr-only"> of {label}</span>
      </Label>
      <Input id={`bs-${k}-source`} value={state[k].source} onChange={(e) => set({ ...state, [k]: { ...state[k], source: e.target.value } })} />
      <Label htmlFor={`bs-${k}-asof`} className="text-xs">
        As of (optional)<span className="sr-only"> for {label}</span>
      </Label>
      <Input id={`bs-${k}-asof`} value={state[k].asOf} onChange={(e) => set({ ...state, [k]: { ...state[k], asOf: e.target.value } })} />
    </>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" aria-hidden="true" /> Buildability screen
        </CardTitle>
        <CardDescription>
          Seven kill triggers checked against the facts you record. Each verdict is triggered, clear on evidence, or
          not determinable — unknown is never shown as clear. Every run is kept; re-running after facts change adds a
          run beside the old one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {runs.isLoading ? (
          <Skeleton className="h-24" />
        ) : runs.isError ? (
          <QueryErrorState error={runs.error as Error} onRetry={() => runs.refetch()} isRetrying={runs.isFetching} compact testId="screen-error" />
        ) : shown ? (
          <>
            <RunView run={shown} today={isLatest ? runs.data?.latestReconciliation ?? null : null} />
            {list.length > 1 && (
              <div>
                <p className="text-xs font-medium mb-1">Run history</p>
                <ul className="space-y-1">
                  {list.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="text-left text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        aria-pressed={r.id === shown.id}
                        onClick={() => setSelectedId(r.id)}
                      >
                        {new Date(r.createdAt).toLocaleString()} — {r.triggeredCount} triggered, {r.notDeterminableCount} not determinable
                      </button>
                    </li>
                  ))}
                </ul>
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
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            Record facts and run the screen
          </summary>
          <div className="grid gap-3 sm:grid-cols-2 pt-3">
            {CHOICE_FACTS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`bs-${f.key}`}>{f.label}</Label>
                <select
                  id={`bs-${f.key}`}
                  className={selectClass}
                  value={choices[f.key].value}
                  onChange={(e) => setChoices({ ...choices, [f.key]: { ...choices[f.key], value: e.target.value } })}
                >
                  <option value="">Not recorded</option>
                  {f.options.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
                {draftInputs(choices, setChoices, f.key, f.label)}
              </div>
            ))}
            {NUMERIC_FACTS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`bs-${f.key}`}>{f.label}</Label>
                <Input
                  id={`bs-${f.key}`}
                  inputMode="decimal"
                  value={nums[f.key].value}
                  onChange={(e) => setNums({ ...nums, [f.key]: { ...nums[f.key], value: e.target.value } })}
                />
                {draftInputs(nums, setNums, f.key, f.label)}
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="bs-floodplain-pct">Your floodplain-share threshold for this run (%)</Label>
              <Input id="bs-floodplain-pct" inputMode="decimal" value={floodplainPct} onChange={(e) => setFloodplainPct(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bs-slope-max">Your slope build threshold for this run (%)</Label>
              <Input id="bs-slope-max" inputMode="decimal" value={slopeMax} onChange={(e) => setSlopeMax(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bs-roads">Roads / right-of-way allowance (% of the parcel)</Label>
              <Input id="bs-roads" inputMode="decimal" value={roadsPct} onChange={(e) => setRoadsPct(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bs-min-lot">Minimum lot (acres), as you read the county&apos;s rule</Label>
              <Input id="bs-min-lot" inputMode="decimal" value={minLot} onChange={(e) => setMinLot(e.target.value)} />
              <Label htmlFor="bs-min-lot-cite" className="text-xs">Citation (where you read it)</Label>
              <Input id="bs-min-lot-cite" value={minLotCite} onChange={(e) => setMinLotCite(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bs-target-lot">Your target lot size (acres)</Label>
              <Input id="bs-target-lot" inputMode="decimal" value={targetLot} onChange={(e) => setTargetLot(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground pt-2">A fact counts as recorded only with its source.</p>
          {problems.length > 0 && (
            <ul role="alert" className="text-sm text-destructive mt-2 space-y-0.5" data-testid="screen-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <Button size="sm" className="mt-2" onClick={() => run.mutate()} disabled={run.isPending || problems.length > 0} data-testid="screen-run-button">
            Run the screen
          </Button>
          {run.isError && (
            <p role="alert" className="text-sm text-destructive mt-2">
              {(run.error as Error).message}
            </p>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
