/**
 * LetterOutlook — the Letter's forecasting section (W4). Collapsed by default;
 * the outlook is fetched only when opened.
 *
 * Every block says what KIND of number it is — research nowcast, walk-forward
 * backtest, live ledger, or AcreOS's own ledger plus labelled assumptions —
 * and the evidence level the ladder gives it. Nothing here is a customer
 * surface; customers see no forecast until a live scored record clears the
 * gate, and the gate's unmet bars are listed in words.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { usd } from "@/lib/format";

type Phase = "expansion" | "peak" | "contraction" | "trough";
type Probs = Record<Phase, number>;
type Readout<T> = { ok: true; value: T } | { ok: false; reason: string };
interface PhaseSummary { n: number; brier: number | null; brierClimatology: number | null; skillVsClimatology: number | null; skillVsPersistence: number | null; hitRate: number | null; calibration: { ece: number | null } }
interface RangeSummary { n: number; nominal: number; coverage: number | null; meanAbsError: number | null; meanWidth: number | null }
interface Assumption { key: string; value: string | number | boolean; unit?: string; basis?: string }
interface RunwayScenario { label: string; monthsToZero: number | null }

interface Outlook {
  showcaseState: string;
  recorder: Array<{ family: string; label: string; refused: string | null }>;
  engines: Array<{
    engineId: string;
    evidence: { id: string; level: string; caveat: string | null };
    live: Readout<{ record: { phase: PhaseSummary; ranges: RangeSummary; distinctIssueMonths: number; issued: number } }>;
    customerGate: { allowed: boolean; unmet: string[] } | null;
  }>;
  backtest: {
    builtOn: string;
    cycle: { origins: number; firstOrigin: string | null; lastOrigin: string | null; horizonMonths: number; realtime: { phase: PhaseSummary; ranges: RangeSummary }; revisedDataForComparison: { phase: PhaseSummary; ranges: RangeSummary }; tennessee: { phase: PhaseSummary } };
    landValue: { scored: RangeSummary; baselines: { sameAsLastYearMeanAbsError: number; nationalMeanMeanAbsError: number } };
  };
  research: {
    builtOn: string;
    cycle: { label: string; showcase: { lastObservation: string; targetDate: string; nowProbs: Probs; horizonProbs: Probs; mostLikelyNow: Phase; mostLikelyAtHorizon: Phase } | null; words: Record<Phase, string> };
    landValue: { label: string; showcase: { baseYear: number; targetYear: number; baseValuePerAcre: number; growth: { lo: number; hi: number; point: number }; valueRange: { lo: number; hi: number } } | null };
  };
  seasonality: { state: string; factors: number[] | null; basis: string; taxSale: { reason: string } };
  slots: Readout<{ warmingUp: number; ready: number; counties: number; saturatedCounties: number }>;
  downturnRunway: Readout<{ normal: RunwayScenario; stress: RunwayScenario; horizonMonths: number; measured: Array<{ key: string; value: number | string; source: string }>; assumptions: Assumption[] }>;
}

const pct = (x: number | null | undefined, dp = 0) => (x == null ? "—" : `${(x * 100).toFixed(dp)}%`);
const num = (x: number | null | undefined, dp = 3) => (x == null ? "—" : x.toFixed(dp));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Block({ title, kind, children, testId }: { title: string; kind: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant="outline" className="text-[11px] font-normal">{kind}</Badge>
      </div>
      <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function months(m: number | null, horizon: number): string {
  return m == null ? `cash lasts beyond ${horizon} months` : `cash runs out in month ${m}`;
}

function OutlookBody({ o }: { o: Outlook }) {
  const cyc = o.research.cycle.showcase;
  const land = o.research.landValue.showcase;
  const bt = o.backtest.cycle;
  const cycleEngine = o.engines[0];
  const f = o.seasonality.factors;
  const ranked = f ? f.map((v, i) => ({ v, m: MONTHS[i] })).sort((a, b) => b.v - a.v) : [];
  return (
    <div className="space-y-4 p-3 pt-0">
      {cyc && (
        <Block title={`${o.showcaseState} job market`} kind={`research nowcast · ${o.research.builtOn} · ${cycleEngine?.evidence.level ?? "E0"}`} testId="outlook-cycle">
          <p>Through {cyc.lastObservation.slice(0, 7)}: {o.research.cycle.words[cyc.mostLikelyNow]} ({pct(cyc.nowProbs[cyc.mostLikelyNow])}).</p>
          <p>By {cyc.targetDate.slice(0, 7)}: most likely {o.research.cycle.words[cyc.mostLikelyAtHorizon]} ({pct(cyc.horizonProbs[cyc.mostLikelyAtHorizon])}).</p>
          {cycleEngine?.evidence.caveat && <p className="text-xs">{cycleEngine.evidence.caveat}.</p>}
        </Block>
      )}

      <Block title="How the cycle model did on the past" kind="walk-forward backtest" testId="outlook-backtest">
        <p>
          {bt.origins} origins, {bt.firstOrigin?.slice(0, 7)} to {bt.lastOrigin?.slice(0, 7)}, each using only the payroll numbers published by then, {bt.horizonMonths} months ahead,
          {" "}{bt.realtime.phase.n} state forecasts scored.
        </p>
        <p>
          Brier {num(bt.realtime.phase.brier)} against {num(bt.realtime.phase.brierClimatology)} for the base rates (skill {num(bt.realtime.phase.skillVsClimatology, 2)}; against
          "no change" {num(bt.realtime.phase.skillVsPersistence, 2)}). Calibration error {num(bt.realtime.phase.calibration.ece, 3)}. Growth ranges held the outcome {pct(bt.realtime.ranges.coverage)} of the time (target {pct(bt.realtime.ranges.nominal)}).
        </p>
        <p>On today&apos;s revised numbers the same model would have scored Brier {num(bt.revisedDataForComparison.phase.brier)} — the gap is what ignoring vintages would have flattered.</p>
      </Block>

      {land && (
        <Block title={`${o.showcaseState} farm real estate, ${land.targetYear}`} kind={`research forecast · ${o.engines[1]?.evidence.level ?? "E0"}`} testId="outlook-land">
          <p>
            {usd(land.valueRange.lo)}–{usd(land.valueRange.hi)} an acre (growth {land.growth.lo.toFixed(1)}% to {land.growth.hi.toFixed(1)}%), from {usd(land.baseValuePerAcre)} in {land.baseYear}. Farmland, not the cheap rural lots most customers buy.
          </p>
          <p>
            Backtest: ranges held {pct(o.backtest.landValue.scored.coverage)} (target 80%); typical miss {num(o.backtest.landValue.scored.meanAbsError, 1)} points against {num(o.backtest.landValue.baselines.sameAsLastYearMeanAbsError, 1)} for "same as last year".
          </p>
        </Block>
      )}

      <Block title="Live record" kind="forecast ledger" testId="outlook-live">
        {o.engines.map((e) => (
          <p key={e.engineId}>
            {e.engineId}:{" "}
            {e.live.ok
              ? `${e.live.value.record.issued} issued, ${e.live.value.record.phase.n || e.live.value.record.ranges.n} scored.`
              : `unreadable (${e.live.reason}).`}
            {e.customerGate && !e.customerGate.allowed && ` Customers see nothing until: ${e.customerGate.unmet.join("; ")}.`}
          </p>
        ))}
        {o.recorder.filter((r) => r.refused).map((r) => (
          <p key={r.family} className="text-xs">Not recording {r.label.toLowerCase()}: {r.refused}.</p>
        ))}
      </Block>

      <Block title="Downturn runway" kind="AcreOS ledger + labelled assumptions" testId="outlook-runway">
        {o.downturnRunway.ok ? (
          <>
            <p>{o.downturnRunway.value.normal.label}: {months(o.downturnRunway.value.normal.monthsToZero, o.downturnRunway.value.horizonMonths)}.</p>
            <p>{o.downturnRunway.value.stress.label}: {months(o.downturnRunway.value.stress.monthsToZero, o.downturnRunway.value.horizonMonths)}.</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {o.downturnRunway.value.measured.map((m) => (
                <li key={m.key}>Measured — {m.key}: {typeof m.value === "number" ? m.value.toLocaleString() : m.value} ({m.source})</li>
              ))}
              {o.downturnRunway.value.assumptions.map((a) => (
                <li key={a.key}>Assumed — {a.key}: {String(a.value)}{a.unit ? ` ${a.unit}` : ""} ({a.basis})</li>
              ))}
            </ul>
          </>
        ) : (
          <p>Unavailable: {o.downturnRunway.reason}.</p>
        )}
      </Block>

      <Block title={`${o.seasonality.state} busy months`} kind="public prior" testId="outlook-seasonality">
        {ranked.length ? (
          <p>Busiest {ranked.slice(0, 3).map((r) => `${r.m} (${r.v.toFixed(2)})`).join(", ")}; slowest {ranked.slice(-2).map((r) => `${r.m} (${r.v.toFixed(2)})`).join(", ")}.</p>
        ) : (
          <p>No seasonal prior for this state.</p>
        )}
        <p className="text-xs">{o.seasonality.basis}</p>
        <p className="text-xs">Tax sales: {o.seasonality.taxSale.reason}</p>
      </Block>

      <Block title="County forecasts" kind="warming up" testId="outlook-slots">
        {o.slots.ok ? (
          <p>
            {o.slots.value.ready} of {o.slots.value.counties} {o.showcaseState} counties with recorded outcomes have enough to forecast; {o.slots.value.warmingUp} are warming up. {o.slots.value.saturatedCounties} counties
            have enough mail from enough customers to measure saturation.
          </p>
        ) : (
          <p>Unavailable: {o.slots.reason}.</p>
        )}
      </Block>
    </div>
  );
}

export function LetterOutlook() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch } = useQuery<Outlook>({
    queryKey: ["/api/founder/forecasting/outlook"],
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });
  return (
    <div className="rounded-lg border border-border bg-card" data-testid="letter-outlook">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg p-3 text-left text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="letter-outlook-toggle"
      >
        <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">{open ? "Outlook — tap to close" : "Outlook — tap to open"}</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </button>
      {open && isLoading && (
        <div className="space-y-2 p-3 pt-0" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      )}
      {open && error && (
        <div className="p-3 pt-0">
          <QueryErrorState error={error as Error} onRetry={() => refetch()} />
        </div>
      )}
      {open && data && <OutlookBody o={data} />}
    </div>
  );
}
