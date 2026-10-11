/**
 * The founder's forecasting outlook — a section of the Letter (/founder), not
 * a new door. Founder-only (GET /api/founder/forecasting/outlook).
 *
 * Everything shown carries its evidence level and its kind:
 *   - LIVE: forecasts the monthly job issued into the ledger, with their live
 *     scored record (none scored yet means "none scored yet", never a grade);
 *   - BACKTEST: the committed walk-forward record, labelled as a backtest;
 *   - RESEARCH: the nowcast computed from the public download the priors were
 *     built from, labelled with its date — not a ledger forecast;
 *   - the downturn runway: AcreOS's own ledger numbers plus labelled
 *     assumptions.
 * Any piece that cannot be read is null with the reason, never a default.
 */
import { desc } from "drizzle-orm";
import { db } from "../../db";
import { mrrSnapshots } from "@shared/schema";
import { CAPABILITIES, evidenceLevelOf } from "@shared/governance/evidenceLadder";
import { PHASE_WORDS } from "@shared/forecasting/cyclePhase";
import { CUSTOMER_GATE, customerForecastGate, type LiveTrackRecord } from "@shared/forecasting/scoring";
import { BACKTEST_RECORD, PUBLIC_PRIORS, publicStressLength, seasonalFactor } from "@shared/forecasting/publicPriors";
import { COUNTY_SLOT_THRESHOLD } from "@shared/forecasting/slots";
import { computeDownturnRunway, mrrMonthlyChangeFrom, type DownturnRunway } from "@shared/forecasting/downturnRunway";
import { taxSaleSeasonality } from "@shared/forecasting/seasonality";
import { PUBLIC_SERIES } from "@shared/forecasting/publicSeries";
import { FORECAST_ENGINES, type FrozenForecast } from "@shared/forecasting/frozenForecast";
import { publicSeriesReadiness } from "./publicSeriesProvider";
import { latestIssued, liveTrackRecord } from "./forecastLedger";
import { countySlots, mailSaturation } from "./saturation";
import { computeRunway } from "../finance/runwayModel";

/** The showcase state (founder decision 2026-10-09). */
const SHOWCASE_STATE = "TN";

const monthsOfYear = Array.from({ length: 12 }, (_, i) => i + 1);

type Readout<T> = { ok: true; value: T } | { ok: false; reason: string };

async function read<T>(f: () => Promise<T>): Promise<Readout<T>> {
  try {
    return { ok: true, value: await f() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function capability(id: string) {
  const c = CAPABILITIES.find((x) => x.id === id);
  return { id, level: evidenceLevelOf(id), caveat: c?.caveat ?? null };
}

export interface EngineOutlook {
  engineId: string;
  evidence: { id: string; level: string; caveat: string | null };
  live: Readout<{ record: LiveTrackRecord & { issued: number }; latest: FrozenForecast[] }>;
  customerGate: { allowed: boolean; unmet: string[] } | null;
}

export interface ForecastOutlook {
  showcaseState: string;
  recorder: Array<{ family: string; label: string; refused: string | null }>;
  engines: EngineOutlook[];
  /** The bars a live record must clear before customers see a forecast. */
  customerGateBars: typeof CUSTOMER_GATE;
  backtest: typeof BACKTEST_RECORD;
  research: {
    builtOn: string;
    cycle: { label: string; showcase: (typeof PUBLIC_PRIORS.cycle.nowcast.forecasts)[number] | null; phaseCounts: Record<string, number>; words: typeof PHASE_WORDS };
    landValue: { label: string; showcase: (typeof PUBLIC_PRIORS.landValue.nextYear.forecasts)[number] | null };
  };
  seasonality: { state: string; factors: number[] | null; basis: string; taxSale: ReturnType<typeof taxSaleSeasonality> };
  slots: Readout<{ warmingUp: number; ready: number; counties: number; saturatedCounties: number }>;
  countySlotThreshold: typeof COUNTY_SLOT_THRESHOLD;
  downturnRunway: Readout<DownturnRunway>;
}

async function engineOutlook(engineId: string, capabilityId: string): Promise<EngineOutlook> {
  const live = await read(async () => ({ record: await liveTrackRecord(engineId), latest: (await latestIssued(engineId)).filter((f) => f.subject === SHOWCASE_STATE) }));
  return { engineId, evidence: capability(capabilityId), live, customerGate: live.ok ? customerForecastGate(live.value.record) : null };
}

export async function composeForecastOutlook(): Promise<ForecastOutlook> {
  const engines = await Promise.all(FORECAST_ENGINES.map((e) => engineOutlook(e.id, e.capability)));
  const phaseCounts: Record<string, number> = {};
  for (const f of PUBLIC_PRIORS.cycle.nowcast.forecasts) phaseCounts[f.mostLikelyNow] = (phaseCounts[f.mostLikelyNow] ?? 0) + 1;

  const slots = await read(async () => {
    const [cs, sat] = await Promise.all([countySlots(SHOWCASE_STATE), mailSaturation()]);
    return { warmingUp: cs.filter((s) => s.status === "warming_up").length, ready: cs.filter((s) => s.status === "ready").length, counties: cs.length, saturatedCounties: sat.length };
  });

  const downturnRunway = await read(async () => {
    const runway = await computeRunway();
    const snaps = await db.select({ capturedAt: mrrSnapshots.capturedAt, mrrCents: mrrSnapshots.mrrCents }).from(mrrSnapshots).orderBy(desc(mrrSnapshots.capturedAt)).limit(26);
    const trend = mrrMonthlyChangeFrom(snaps.map((s) => ({ capturedAt: s.capturedAt.toISOString(), mrrCents: s.mrrCents })));
    const contraction = publicStressLength();
    return computeDownturnRunway({
      cashUsd: runway.cashOnHandUsd,
      cashLabel: runway.cashLabel,
      monthlyCostsUsd: runway.scenarios.base.monthlyCostsUsd,
      mrrUsd: runway.inputs.mrrUsd,
      observedMrrMonthlyChange: trend.change,
      mrrHistoryWeeks: trend.weeks,
      publicContractionMonths: contraction?.months ?? null,
      publicContractionBasis: contraction?.basis ?? null,
    });
  });

  return {
    showcaseState: SHOWCASE_STATE,
    recorder: PUBLIC_SERIES.map((f) => ({ family: f.id, label: f.label, refused: publicSeriesReadiness(f.id) })),
    engines,
    customerGateBars: CUSTOMER_GATE,
    backtest: BACKTEST_RECORD,
    research: {
      builtOn: PUBLIC_PRIORS.builtOn,
      cycle: { label: PUBLIC_PRIORS.cycle.nowcast.label, showcase: PUBLIC_PRIORS.cycle.nowcast.forecasts.find((f) => f.state === SHOWCASE_STATE) ?? null, phaseCounts, words: PHASE_WORDS },
      landValue: { label: PUBLIC_PRIORS.landValue.nextYear.label, showcase: PUBLIC_PRIORS.landValue.nextYear.forecasts.find((f) => f.state === SHOWCASE_STATE) ?? null },
    },
    seasonality: {
      state: SHOWCASE_STATE,
      factors: monthsOfYear.every((m) => seasonalFactor(SHOWCASE_STATE, m) != null) ? monthsOfYear.map((m) => seasonalFactor(SHOWCASE_STATE, m) as number) : null,
      basis: PUBLIC_PRIORS.seasonality.basis,
      taxSale: taxSaleSeasonality(SHOWCASE_STATE),
    },
    slots,
    countySlotThreshold: COUNTY_SLOT_THRESHOLD,
    downturnRunway,
  };
}
