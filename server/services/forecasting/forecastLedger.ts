/**
 * The scored registry, live.
 *
 *   issue  — read the recorded vintages AS KNOWN today, run the registered
 *            engines, freeze each forecast (engine id + version, the series
 *            and vintage date read, the engine's parameters as assumptions)
 *            and append it as an `issued` ledger entry;
 *   score  — when a forecast's target period has been published, read the
 *            outcome from the latest recorded vintage and append a `scored`
 *            entry against it. The issued entry is never touched.
 *   record — summarise the live scores (Brier and skill, calibration, range
 *            coverage) for the Letter and for the customer gate.
 *
 * Nothing here runs on data that was not recorded by the vintage recorder: a
 * model with no recorded inputs issues nothing and says why.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { forecastLedger, publicSeriesVintages } from "@shared/schema";
import { asKnownOn, type Point, type VintageRow } from "@shared/forecasting/vintage";
import { stateOfSeriesId, type SeriesFamilyId } from "@shared/forecasting/publicSeries";
import { CYCLE_PHASE_ENGINE_ID, forecastCyclePhases, realisedAt } from "@shared/forecasting/cyclePhase";
import { LAND_VALUE_ENGINE_ID, LAND_VALUE_ENGINE_VERSION, forecastLandValues, realisedLandGrowth, type AnnualPoint } from "@shared/forecasting/landValue";
import {
  FORECAST_ENGINES,
  freezeForecast,
  forecastKey,
  type CyclePhasePrediction,
  type FrozenForecast,
  type ForecastScore,
  type LandValuePrediction,
} from "@shared/forecasting/frozenForecast";
import { brierMulti, logScore, summariseIntervals, summarisePhaseScores, type LiveTrackRecord, type PhaseScoreRecord } from "@shared/forecasting/scoring";
import { FORECAST_MODELS } from "@shared/forecasting/models";
import { checkModels } from "@shared/forecasting/fairHousing";
import { clock } from "../../utils/clock";

async function vintagesOf(family: SeriesFamilyId): Promise<VintageRow[]> {
  const rows = await db
    .select({
      seriesId: publicSeriesVintages.seriesId,
      observationDate: publicSeriesVintages.observationDate,
      vintageDate: publicSeriesVintages.vintageDate,
      value: publicSeriesVintages.value,
    })
    .from(publicSeriesVintages)
    .where(eq(publicSeriesVintages.family, family));
  return rows as VintageRow[];
}

function byState(known: Map<string, Point[]>): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  for (const [seriesId, pts] of known) {
    const st = stateOfSeriesId(seriesId);
    if (st) out.set(st, pts);
  }
  return out;
}

function annual(pts: readonly Point[]): AnnualPoint[] {
  return pts.map((p) => ({ year: Number(p.date.slice(0, 4)), value: p.value }));
}

export interface IssueReport {
  asOf: string;
  engines: Array<{ engineId: string; issued: number; refused: string | null; stateRefusals: number }>;
}

async function insertIssued(f: FrozenForecast): Promise<number> {
  const res = await db
    .insert(forecastLedger)
    .values({
      entryKind: "issued",
      forecastKey: forecastKey(f),
      engineId: f.engineId,
      engineVersion: f.engineVersion,
      subject: f.subject,
      targetDate: f.targetDate,
      issuedAsOf: f.issuedAsOf,
      body: f,
    })
    .onConflictDoNothing()
    .returning({ id: forecastLedger.id });
  return res.length;
}

/** Issue this month's forecasts from what has been recorded. */
export async function issueForecasts(): Promise<IssueReport> {
  const asOf = clock.now().toISOString().slice(0, 10);
  const report: IssueReport = { asOf, engines: [] };
  // Fail closed: no forecast is issued while any registered model reads a
  // protected characteristic or a proxy (shared/forecasting/fairHousing.ts).
  const violations = checkModels(FORECAST_MODELS);
  if (violations.length > 0) {
    const reason = `fair-housing guard: ${violations.map((v) => `${v.where} uses "${v.term}"`).join("; ")}`;
    for (const e of FORECAST_ENGINES) report.engines.push({ engineId: e.id, issued: 0, refused: reason, stateRefusals: 0 });
    return report;
  }

  // Cycle phase — one forecast per state per issue date.
  const payrolls = byState(asKnownOn(await vintagesOf("state_payrolls"), asOf));
  if (payrolls.size === 0) {
    report.engines.push({ engineId: CYCLE_PHASE_ENGINE_ID, issued: 0, refused: "no payroll vintages recorded yet (FRED_API_KEY unset, or the recorder has not run)", stateRefusals: 0 });
  } else {
    const { forecasts, refusals, pooled } = forecastCyclePhases(payrolls);
    let issued = 0;
    for (const fc of forecasts) {
      const prediction: CyclePhasePrediction = {
        kind: "cycle_phase",
        nowProbs: fc.nowProbs,
        horizonProbs: fc.horizonProbs,
        mostLikelyAtHorizon: fc.mostLikelyAtHorizon,
        growthRange: fc.growthRange,
        climatology: pooled.climatology,
      };
      issued += await insertIssued(
        freezeForecast({
          engineId: CYCLE_PHASE_ENGINE_ID,
          subject: fc.state,
          targetDate: fc.targetDate,
          issuedAsOf: asOf,
          inputs: { asOf, series: [{ seriesId: `${fc.state}NA`, lastObservation: fc.lastObservation, observations: fc.historyMonths }] },
          prediction,
        }),
      );
    }
    report.engines.push({ engineId: CYCLE_PHASE_ENGINE_ID, issued, refused: null, stateRefusals: refusals.length });
  }

  // Land value — one forecast per state per target year (the survey is annual).
  const land = byState(asKnownOn(await vintagesOf("state_ag_land_value"), asOf));
  if (land.size === 0) {
    report.engines.push({ engineId: LAND_VALUE_ENGINE_ID, issued: 0, refused: "no land-value vintages recorded yet (NASS_API_KEY unset, or the recorder has not run)", stateRefusals: 0 });
  } else {
    const annualByState = new Map([...land].map(([st, pts]) => [st, annual(pts)]));
    const latestYear = Math.max(...[...annualByState.values()].flatMap((a) => a.map((p) => p.year)));
    const { forecasts, refusals } = forecastLandValues(annualByState, latestYear);
    const already = await db
      .select({ subject: forecastLedger.subject, targetDate: forecastLedger.targetDate })
      .from(forecastLedger)
      .where(and(eq(forecastLedger.engineId, LAND_VALUE_ENGINE_ID), eq(forecastLedger.engineVersion, LAND_VALUE_ENGINE_VERSION), eq(forecastLedger.entryKind, "issued")));
    const have = new Set(already.map((r) => `${r.subject}|${r.targetDate}`));
    let issued = 0;
    for (const fc of forecasts) {
      const targetDate = `${fc.targetYear}-01-01`;
      if (have.has(`${fc.state}|${targetDate}`)) continue;
      const prediction: LandValuePrediction = { kind: "land_value_growth", growth: fc.growth, valueRange: fc.valueRange, baseValuePerAcre: fc.baseValuePerAcre };
      issued += await insertIssued(
        freezeForecast({
          engineId: LAND_VALUE_ENGINE_ID,
          subject: fc.state,
          targetDate,
          issuedAsOf: asOf,
          inputs: { asOf, series: [{ seriesId: `NASS:${fc.state}:AG_LAND_VALUE`, lastObservation: `${fc.baseYear}-01-01`, observations: fc.yearsOfHistory + 1 }] },
          prediction,
        }),
      );
    }
    report.engines.push({ engineId: LAND_VALUE_ENGINE_ID, issued, refused: null, stateRefusals: refusals.length });
  }
  return report;
}

/** Score every issued forecast whose outcome is now published. Returns how many were scored. */
export async function scoreDueForecasts(): Promise<number> {
  const asOf = clock.now().toISOString().slice(0, 10);
  const issued = await db.select().from(forecastLedger).where(eq(forecastLedger.entryKind, "issued"));
  if (issued.length === 0) return 0;
  const scored = await db
    .select({ forecastKey: forecastLedger.forecastKey })
    .from(forecastLedger)
    .where(and(eq(forecastLedger.entryKind, "scored"), inArray(forecastLedger.forecastKey, issued.map((r) => r.forecastKey))));
  const done = new Set(scored.map((r) => r.forecastKey));
  const due = issued.filter((r) => !done.has(r.forecastKey) && r.targetDate <= asOf);
  if (due.length === 0) return 0;

  const payrolls = byState(asKnownOn(await vintagesOf("state_payrolls"), asOf));
  const land = byState(asKnownOn(await vintagesOf("state_ag_land_value"), asOf));
  let n = 0;
  for (const row of due) {
    const f = row.body as FrozenForecast;
    let score: ForecastScore | null = null;
    if (f.prediction.kind === "cycle_phase") {
      const r = realisedAt(payrolls.get(f.subject) ?? [], f.targetDate);
      if (!r) continue;
      const p = f.prediction;
      score = {
        forecastKey: row.forecastKey,
        truthAsOf: asOf,
        outcome: { phase: r.phase, value: r.g },
        brier: brierMulti(p.horizonProbs, r.phase),
        logScore: logScore(p.horizonProbs, r.phase),
        rangeHit: r.g >= p.growthRange.lo && r.g <= p.growthRange.hi,
      };
    } else {
      const g = realisedLandGrowth(annual(land.get(f.subject) ?? []), Number(f.targetDate.slice(0, 4)));
      if (g == null) continue;
      score = { forecastKey: row.forecastKey, truthAsOf: asOf, outcome: { value: g }, brier: null, logScore: null, rangeHit: g >= f.prediction.growth.lo && g <= f.prediction.growth.hi };
    }
    const res = await db
      .insert(forecastLedger)
      .values({ entryKind: "scored", forecastKey: row.forecastKey, engineId: row.engineId, engineVersion: row.engineVersion, subject: row.subject, targetDate: row.targetDate, issuedAsOf: row.issuedAsOf, body: score })
      .onConflictDoNothing()
      .returning({ id: forecastLedger.id });
    n += res.length;
  }
  return n;
}

/** The live track record of one engine — what the customer gate reads. */
export async function liveTrackRecord(engineId: string): Promise<LiveTrackRecord & { issued: number }> {
  const rows = await db.select().from(forecastLedger).where(eq(forecastLedger.engineId, engineId));
  const issued = new Map(rows.filter((r) => r.entryKind === "issued").map((r) => [r.forecastKey, r]));
  const phase: PhaseScoreRecord[] = [];
  const ranges: Array<{ lo: number; hi: number; point: number; actual: number }> = [];
  const months = new Set<string>();
  let nominal = 0.8;
  for (const r of rows) {
    if (r.entryKind !== "scored") continue;
    const i = issued.get(r.forecastKey);
    if (!i) continue;
    const f = i.body as FrozenForecast;
    const s = r.body as ForecastScore;
    months.add(f.issuedAsOf.slice(0, 7));
    if (f.prediction.kind === "cycle_phase" && s.outcome.phase) {
      phase.push({ probs: f.prediction.horizonProbs, outcome: s.outcome.phase, climatology: f.prediction.climatology, persistence: f.prediction.nowProbs });
      ranges.push({ ...f.prediction.growthRange, actual: s.outcome.value });
      nominal = f.prediction.growthRange.level;
    } else if (f.prediction.kind === "land_value_growth") {
      ranges.push({ ...f.prediction.growth, actual: s.outcome.value });
      nominal = f.prediction.growth.level;
    }
  }
  return { phase: summarisePhaseScores(phase), ranges: summariseIntervals(ranges, nominal), distinctIssueMonths: months.size, issued: issued.size };
}

/** The latest issued forecasts of an engine (one issue date), for display. */
export async function latestIssued(engineId: string): Promise<FrozenForecast[]> {
  const rows = await db
    .select()
    .from(forecastLedger)
    .where(and(eq(forecastLedger.engineId, engineId), eq(forecastLedger.entryKind, "issued")));
  if (rows.length === 0) return [];
  const latest = rows.reduce((m, r) => (r.issuedAsOf > m ? r.issuedAsOf : m), rows[0].issuedAsOf);
  return rows.filter((r) => r.issuedAsOf === latest).map((r) => r.body as FrozenForecast);
}

