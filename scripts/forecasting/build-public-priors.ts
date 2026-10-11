/**
 * Builds the committed public priors and the walk-forward backtest record
 * from raw public downloads (W4 forecasting).
 *
 *   npx tsx scripts/forecasting/build-public-priors.ts \
 *     --payroll <dir of ALFRED vintage CSVs> --bps <dir of Census BPS stYYMMc.txt> \
 *     [--out shared/forecasting/data] [--downloaded 2026-10-11]
 *
 * INPUTS (not committed — they are re-downloadable public files):
 *   payroll/  <ST>NA.v<k>.csv   ALFRED real-time vintages of state total
 *                               nonfarm payrolls (BLS CES, public domain), as
 *                               downloaded with FRED's CSV download for the
 *                               one-time research backtest, 12 vintages per
 *                               file, rate-limited. The production recorder
 *                               never does this: it uses the FRED API with a
 *                               key (FRED's terms forbid scraping the site).
 *             <ST>NA.latest.csv the current vintage (the truth the backtest
 *                               scores against)
 *   bps/      stYYMMc.txt       Census Building Permits Survey monthly state
 *                               files (public domain, official directory)
 *   shared/forecasting/data/usdaAgLandValues.json  (committed; NASS bulk file)
 *
 * OUTPUTS:
 *   publicPriors.json        seasonal factors, phase transition pattern,
 *                            contraction lengths, land-value growth spread,
 *                            and the latest research nowcast
 *   backtest-2026-10.json    walk-forward scores: every forecast made only
 *                            from data as known at its origin, scored against
 *                            today's numbers
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATES } from "../../shared/forecasting/publicSeries";
import { asKnownOn, type Point, type VintageRow } from "../../shared/forecasting/vintage";
import {
  CYCLE_PARAMS,
  CYCLE_PHASE_ENGINE_ID,
  CYCLE_PHASE_ENGINE_VERSION,
  PHASES,
  emptyCounts,
  addCounts,
  forecastCyclePhases,
  growthPath,
  pooledMatrix,
  realisedAt,
  transitionCounts,
  phaseFrequencies,
  type StateCycleForecast,
} from "../../shared/forecasting/cyclePhase";
import { LAND_VALUE_ENGINE_ID, LAND_VALUE_ENGINE_VERSION, forecastLandValues, landBacktest, realisedLandGrowth, type AnnualPoint } from "../../shared/forecasting/landValue";
import { seasonalPriors, SEASONALITY_ENGINE_ID, SEASONALITY_ENGINE_VERSION, SEASONALITY_BASIS } from "../../shared/forecasting/seasonality";
import { summariseIntervals, summarisePhaseScores, type PhaseScoreRecord } from "../../shared/forecasting/scoring";
import { median, round } from "../../shared/forecasting/stats";
import { parseBpsStateFile } from "../../server/services/forecasting/publicSeriesProvider";

function arg(name: string, dflt?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (dflt !== undefined) return dflt;
  throw new Error(`--${name} is required`);
}

const PAYROLL = arg("payroll");
const BPS = arg("bps");
const OUT = arg("out", "shared/forecasting/data");
const DOWNLOADED = arg("downloaded", "2026-10-11");

// ── Load payroll vintages ─────────────────────────────────────────────────

function parseAlfredCsv(text: string, seriesId: string): VintageRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",");
  const cols = head.slice(1).map((h) => {
    const m = /_(\d{4})(\d{2})(\d{2})$/.exec(h.trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  });
  const out: VintageRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const obs = c[0];
    for (let i = 0; i < cols.length; i++) {
      const v = cols[i];
      const x = c[i + 1];
      if (!v || x == null || x === "" || x === ".") continue;
      const n = Number(x);
      if (Number.isFinite(n)) out.push({ seriesId, observationDate: obs, vintageDate: v, value: n });
    }
  }
  return out;
}

function parseLatest(text: string): Point[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .filter((c) => c[1] && c[1] !== "." && Number.isFinite(Number(c[1])))
    .map((c) => ({ date: c[0], value: Number(c[1]) }));
}

const vintageRows: VintageRow[] = [];
const latest = new Map<string, Point[]>();
const files = readdirSync(PAYROLL);
for (const st of STATES.map((s) => s.code)) {
  const sid = `${st}NA`;
  for (const f of files.filter((f) => f.startsWith(`${sid}.v`) && f.endsWith(".csv"))) {
    vintageRows.push(...parseAlfredCsv(readFileSync(join(PAYROLL, f), "utf8"), sid));
  }
  const lf = join(PAYROLL, `${sid}.latest.csv`);
  if (existsSync(lf)) latest.set(st, parseLatest(readFileSync(lf, "utf8")));
}
const vintageDates = [...new Set(vintageRows.map((r) => r.vintageDate))].sort();
console.log(`payroll: ${vintageRows.length} vintage rows, ${vintageDates.length} vintage dates, ${latest.size} latest series`);

function byState(known: Map<string, Point[]>): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const [sid, pts] of known) out.set(sid.replace(/NA$/, ""), pts);
  return out;
}

// ── Cycle phase walk-forward ──────────────────────────────────────────────

interface OriginResult {
  origin: string;
  states: number;
  scored: number;
  brier: number | null;
  skillVsClimatology: number | null;
  coverage: number | null;
}

const rtPhase: PhaseScoreRecord[] = [];
const rtRanges: Array<{ lo: number; hi: number; point: number; actual: number }> = [];
const revPhase: PhaseScoreRecord[] = [];
const revRanges: Array<{ lo: number; hi: number; point: number; actual: number }> = [];
const tnPhase: PhaseScoreRecord[] = [];
const tnRanges: Array<{ lo: number; hi: number; point: number; actual: number }> = [];
const perOrigin: OriginResult[] = [];
const tnTrail: Array<{ origin: string; lastObservation: string; target: string; mostLikely: string; p: number; realised: string | null }> = [];

function scoreAgainstLatest(fc: StateCycleForecast, climatology: PhaseScoreRecord["climatology"], intoPhase: PhaseScoreRecord[], intoRanges: typeof rtRanges): boolean {
  const truth = realisedAt(latest.get(fc.state) ?? [], fc.targetDate);
  if (!truth) return false;
  intoPhase.push({ probs: fc.horizonProbs, outcome: truth.phase, climatology, persistence: fc.nowProbs });
  intoRanges.push({ lo: fc.growthRange.lo, hi: fc.growthRange.hi, point: fc.growthRange.point, actual: truth.g });
  return true;
}

for (const origin of vintageDates) {
  const known = byState(asKnownOn(vintageRows, origin));
  if (known.size < 45) continue; // pooling needs most states present
  const { forecasts, pooled } = forecastCyclePhases(known);
  const before = rtPhase.length;
  const beforeR = rtRanges.length;
  for (const fc of forecasts) {
    if (!scoreAgainstLatest(fc, pooled.climatology, rtPhase, rtRanges)) continue;
    if (fc.state === "TN") {
      scoreAgainstLatest(fc, pooled.climatology, tnPhase, tnRanges);
      const truth = realisedAt(latest.get("TN") ?? [], fc.targetDate);
      tnTrail.push({ origin, lastObservation: fc.lastObservation, target: fc.targetDate, mostLikely: fc.mostLikelyAtHorizon, p: round(fc.horizonProbs[fc.mostLikelyAtHorizon], 3), realised: truth?.phase ?? null });
    }
  }
  // The same forecasts from TODAY'S revised numbers cut at the same months —
  // what a backtest that ignores vintages would have claimed.
  const revised = new Map<string, Point[]>();
  for (const fc of forecasts) {
    const cut = (latest.get(fc.state) ?? []).filter((p) => p.date <= fc.lastObservation);
    revised.set(fc.state, cut);
  }
  const rv = forecastCyclePhases(revised);
  for (const fc of rv.forecasts) scoreAgainstLatest(fc, rv.pooled.climatology, revPhase, revRanges);
  const s = summarisePhaseScores(rtPhase.slice(before));
  const r = summariseIntervals(rtRanges.slice(beforeR), CYCLE_PARAMS.intervalLevel);
  perOrigin.push({ origin, states: forecasts.length, scored: s.n, brier: s.brier, skillVsClimatology: s.skillVsClimatology, coverage: r.coverage });
}

const cycleRealtime = summarisePhaseScores(rtPhase);
const cycleRealtimeRanges = summariseIntervals(rtRanges, CYCLE_PARAMS.intervalLevel);
const cycleRevised = summarisePhaseScores(revPhase);
const cycleRevisedRanges = summariseIntervals(revRanges, CYCLE_PARAMS.intervalLevel);
console.log("cycle real-time", cycleRealtime.n, cycleRealtime.brier, cycleRealtime.skillVsClimatology, cycleRealtime.skillVsPersistence, cycleRealtime.calibration.ece, cycleRealtimeRanges.coverage);
console.log("cycle revised  ", cycleRevised.n, cycleRevised.brier, cycleRevised.skillVsClimatology, cycleRevisedRanges.coverage);

// ── Land value walk-forward ───────────────────────────────────────────────

const usda = JSON.parse(readFileSync("shared/forecasting/data/usdaAgLandValues.json", "utf8")) as { values: Record<string, Array<[number, number]>> };
const land = new Map<string, AnnualPoint[]>(Object.entries(usda.values).map(([st, a]) => [st, a.map(([year, value]) => ({ year, value }))]));
const landBt = landBacktest(land, 2005, 2025);
console.log("land", landBt.scored, landBt.baselines);

// ── Priors from the latest vintage ────────────────────────────────────────

let total = emptyCounts();
const contractionRuns: number[] = [];
const gfcRuns: number[] = [];
for (const [, pts] of latest) {
  const path = growthPath(pts.filter((p) => p.date >= "1990-01-01"));
  total = addCounts(total, transitionCounts(path));
  let run = 0, runStart = "";
  for (const p of path) {
    if (p.g <= 0) { if (run === 0) runStart = p.date; run++; }
    else if (run > 0) {
      if (p.date >= "1991-01-01") contractionRuns.push(run);
      if (runStart >= "2007-06-01" && runStart <= "2009-12-01" && run >= 3) gfcRuns.push(run);
      run = 0;
    }
  }
}
const matrix = pooledMatrix(total);
const realContractions = contractionRuns.filter((n) => n >= 3); // a 1–2 month dip is noise, not a contraction
const nowcast = forecastCyclePhases(new Map([...latest].map(([st, pts]) => [st, pts])));

const permits = new Map<string, Point[]>();
for (const f of readdirSync(BPS).filter((f) => /^st\d{4}c\.txt$/.test(f)).sort()) {
  const parsed = parseBpsStateFile(readFileSync(join(BPS, f), "utf8"));
  if (!parsed) continue;
  for (const s of STATES) {
    const v = parsed.byFips.get(s.fips);
    if (v == null) continue;
    let arr = permits.get(s.code);
    if (!arr) permits.set(s.code, (arr = []));
    arr.push({ date: parsed.month, value: v });
  }
}
for (const arr of permits.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
const seasonal = seasonalPriors(permits);
const months = [...new Set([...permits.values()].flatMap((a) => a.map((p) => p.date)))].sort();

const allLandGrowth: number[] = [];
for (const pts of land.values()) for (let y = 1998; y <= 2026; y++) { const g = realisedLandGrowth(pts, y); if (g != null) allLandGrowth.push(g); }
allLandGrowth.sort((a, b) => a - b);
const q = (p: number) => allLandGrowth[Math.min(allLandGrowth.length - 1, Math.floor(p * allLandGrowth.length))];
const landNow = forecastLandValues(land, 2026);

const priors = {
  builtOn: DOWNLOADED,
  sources: {
    payrolls: `ALFRED/FRED state total nonfarm payrolls (BLS CES, public domain), ${latest.size} states + DC, latest vintage downloaded ${DOWNLOADED}`,
    permits: `Census Building Permits Survey monthly state files ${months[0]} to ${months[months.length - 1]} (public domain)`,
    landValues: "USDA NASS Land Values survey via the Quick Stats bulk file (public domain), see usdaAgLandValues.json",
  },
  cycle: {
    engineId: CYCLE_PHASE_ENGINE_ID,
    engineVersion: CYCLE_PHASE_ENGINE_VERSION,
    monthlyTransitions: matrix,
    climatology: phaseFrequencies([...latest.values()].map((pts) => growthPath(pts.filter((p) => p.date >= "1990-01-01")))),
    contraction: {
      basis: "runs of three or more consecutive months in which a state's six-month payroll growth was at or below zero, 1991 to the latest month, all states + DC",
      count: realContractions.length,
      medianMonths: median(realContractions),
      gfcMedianMonths: median(gfcRuns),
      gfcBasis: "the same runs that began between 2007-06 and 2009-12 (the 2008 recession)",
    },
    nowcast: {
      asOf: DOWNLOADED,
      label: "research nowcast from the downloaded latest vintage — not a live ledger forecast",
      forecasts: nowcast.forecasts,
    },
  },
  seasonality: {
    engineId: SEASONALITY_ENGINE_ID,
    engineVersion: SEASONALITY_ENGINE_VERSION,
    basis: SEASONALITY_BASIS,
    national: seasonal.national,
    states: seasonal.states.map((s) => ({ state: s.state, factors: s.factors, yearsOfHistory: s.yearsOfHistory, ownWeight: s.ownWeight })),
  },
  landValue: {
    engineId: LAND_VALUE_ENGINE_ID,
    engineVersion: LAND_VALUE_ENGINE_VERSION,
    annualGrowthAllStates: { basis: "one-year log-percent change, every state, 1998–2026", n: allLandGrowth.length, p10: round(q(0.1), 3), p50: round(q(0.5), 3), p90: round(q(0.9), 3) },
    nextYear: { knownThrough: 2026, label: "research forecast for 2027 — not a live ledger forecast", forecasts: landNow.forecasts, fit: landNow.fit },
  },
};

const backtest = {
  id: "forecast-backtest-2026-10",
  builtOn: DOWNLOADED,
  method:
    "Walk-forward. At each origin (an ALFRED vintage date), every state's forecast is computed from payrolls exactly as published on that date, then scored against the latest published numbers. The land model uses only survey years up to the origin year (NASS keeps no vintages, so later revisions to old years are in the data — the land backtest is NOT fully real-time).",
  cycle: {
    engineId: CYCLE_PHASE_ENGINE_ID,
    engineVersion: CYCLE_PHASE_ENGINE_VERSION,
    horizonMonths: CYCLE_PARAMS.horizon,
    origins: perOrigin.length,
    firstOrigin: perOrigin[0]?.origin ?? null,
    lastOrigin: perOrigin[perOrigin.length - 1]?.origin ?? null,
    realtime: { phase: cycleRealtime, ranges: cycleRealtimeRanges },
    revisedDataForComparison: { phase: cycleRevised, ranges: cycleRevisedRanges, note: "the same forecasts from today's revised numbers — what ignoring vintages would have claimed" },
    tennessee: { phase: summarisePhaseScores(tnPhase), ranges: summariseIntervals(tnRanges, CYCLE_PARAMS.intervalLevel), trail: tnTrail },
    perOrigin,
  },
  landValue: {
    engineId: LAND_VALUE_ENGINE_ID,
    engineVersion: LAND_VALUE_ENGINE_VERSION,
    knownThrough: { first: 2005, last: 2025 },
    ...landBt,
  },
  phases: PHASES,
};

writeFileSync(join(OUT, "publicPriors.json"), JSON.stringify(priors) + "\n");
writeFileSync(join(OUT, "backtest-2026-10.json"), JSON.stringify(backtest) + "\n");
console.log("wrote", join(OUT, "publicPriors.json"), join(OUT, "backtest-2026-10.json"));
