/**
 * A forecast, frozen when it is issued — the scored registry's unit.
 *
 * Same contract as a Scenario (shared/economics/scenario.ts): a closed
 * registry of deterministic engines, each with a VERSION persisted beside its
 * output, the verbatim inputs (here: which series, as known on which date),
 * and the assumptions with their origin. It reuses `ScenarioAssumption`
 * rather than minting a twin.
 *
 * WHY NOT A ROW IN decision_snapshots: that table is a CUSTOMER's investment
 * decision, organisation-scoped with a NOT NULL tenant key. A platform macro
 * forecast belongs to no customer, and filing it under a made-up organisation
 * is the platform-org pattern this repo forbids. So forecasts live in their
 * own append-only ledger with the same immutability: an `issued` entry is
 * never edited; a later `scored` entry references it (law 9 — outcomes append,
 * they do not rewrite).
 *
 * Pure; browser-safe.
 */
import type { ScenarioAssumption } from "../economics/scenario";
import { CYCLE_PHASE_ENGINE_ID, CYCLE_PHASE_ENGINE_VERSION, CYCLE_PARAMS, type PhaseProbs, type Phase } from "./cyclePhase";
import { LAND_VALUE_ENGINE_ID, LAND_VALUE_ENGINE_VERSION, LAND_VALUE_PARAMS } from "./landValue";

const FROZEN_FORECAST_SHAPE_VERSION = 1 as const;

export interface ForecastEngineSpec {
  id: string;
  version: string;
  label: string;
  /** The Evidence Ladder capability that states how proven this engine is. */
  capability: string;
  target: "phase_and_growth_6m" | "growth_next_year";
}

export const FORECAST_ENGINES: readonly ForecastEngineSpec[] = [
  { id: CYCLE_PHASE_ENGINE_ID, version: CYCLE_PHASE_ENGINE_VERSION, label: "State job-market cycle phase, 6 months ahead", capability: "forecast.cycle-phase", target: "phase_and_growth_6m" },
  { id: LAND_VALUE_ENGINE_ID, version: LAND_VALUE_ENGINE_VERSION, label: "State farm real estate value growth, next year", capability: "forecast.land-value", target: "growth_next_year" },
];

function forecastEngine(id: string): ForecastEngineSpec {
  const e = FORECAST_ENGINES.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown forecast engine "${id}" — forecasts come from the registered engines only`);
  return e;
}

export interface FrozenForecastInputs {
  /** The series read, each as known on `asOf`. */
  series: Array<{ seriesId: string; lastObservation: string; observations: number }>;
  /** "What did we know on this date" — the vintage the inputs were read at. */
  asOf: string;
}

export interface CyclePhasePrediction {
  kind: "cycle_phase";
  nowProbs: PhaseProbs;
  horizonProbs: PhaseProbs;
  mostLikelyAtHorizon: Phase;
  growthRange: { point: number; lo: number; hi: number; level: number };
  climatology: PhaseProbs;
}

export interface LandValuePrediction {
  kind: "land_value_growth";
  growth: { point: number; lo: number; hi: number; level: number };
  valueRange: { lo: number; hi: number };
  baseValuePerAcre: number;
}

export interface FrozenForecast {
  shapeVersion: number;
  engineId: string;
  /** The engine version AT ISSUE. Never back-filled. */
  engineVersion: string;
  /** Region code — a state ("TN") today. */
  subject: string;
  /** The period the prediction describes (YYYY-MM-DD; a year is YYYY-01-01). */
  targetDate: string;
  issuedAsOf: string;
  inputs: FrozenForecastInputs;
  assumptions: ScenarioAssumption[];
  prediction: CyclePhasePrediction | LandValuePrediction;
}

/** The engine's own parameters, frozen as assumptions with their origin. */
export function engineAssumptions(engineId: string): ScenarioAssumption[] {
  if (engineId === CYCLE_PHASE_ENGINE_ID) {
    return Object.entries(CYCLE_PARAMS).map(([key, value]) => ({ key, value, origin: "platform-default" as const, basis: "cycle phase engine parameter (shared/forecasting/cyclePhase.ts)" }));
  }
  if (engineId === LAND_VALUE_ENGINE_ID) {
    return Object.entries(LAND_VALUE_PARAMS).map(([key, value]) => ({ key, value, origin: "platform-default" as const, basis: "land value engine parameter (shared/forecasting/landValue.ts)" }));
  }
  return [];
}

export function freezeForecast(args: {
  engineId: string;
  subject: string;
  targetDate: string;
  issuedAsOf: string;
  inputs: FrozenForecastInputs;
  prediction: CyclePhasePrediction | LandValuePrediction;
}): FrozenForecast {
  const e = forecastEngine(args.engineId);
  return {
    shapeVersion: FROZEN_FORECAST_SHAPE_VERSION,
    engineId: e.id,
    engineVersion: e.version,
    subject: args.subject,
    targetDate: args.targetDate,
    issuedAsOf: args.issuedAsOf,
    inputs: args.inputs,
    assumptions: engineAssumptions(e.id),
    prediction: args.prediction,
  };
}

/** The natural key of an issued forecast: one per engine version, subject, target and issue date. */
export function forecastKey(f: Pick<FrozenForecast, "engineId" | "engineVersion" | "subject" | "targetDate" | "issuedAsOf">): string {
  return `${f.engineId}@${f.engineVersion}|${f.subject}|${f.targetDate}|${f.issuedAsOf}`;
}

export interface ForecastScore {
  forecastKey: string;
  /** The vintage the outcome was read from. */
  truthAsOf: string;
  outcome: { phase?: Phase; value: number };
  brier: number | null;
  logScore: number | null;
  rangeHit: boolean;
}
