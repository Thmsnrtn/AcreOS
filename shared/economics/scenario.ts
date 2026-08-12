/**
 * Scenario — a versioned, deterministic economic hypothesis (BI12, BK24, AY3).
 *
 * WHAT IT IS FOR
 * --------------
 * `decision_snapshots` freezes what was KNOWN (evidence) and what was ASSUMED
 * (assumptions) when a decision was made. It had nowhere to point for the
 * ECONOMICS that justified the choice. A snapshot could record "offer $42,000"
 * while the arithmetic behind the number lived nowhere at all — so a year later
 * you can reconstruct what the investor believed about the parcel, and not what
 * they believed about the deal.
 *
 * A Scenario closes that: one row per computed economic hypothesis, carrying
 * the engine that produced it, that engine's VERSION, the verbatim inputs, and
 * the outputs. A DecisionSnapshot then freezes a reference to it.
 *
 * THE PATTERN THIS COPIES RATHER THAN REINVENTS
 * ---------------------------------------------
 * `server/services/notePaymentMath.ts` already does this properly for payoff
 * quotes: `PAYOFF_ENGINE_VERSION` and `PAYOFF_DAY_COUNT_CONVENTION` are
 * persisted to NOT NULL columns on `note_payoff_quotes` alongside
 * `engine_input_json` — "the verbatim input snapshot so the number can be
 * recomputed and defended years later". That is exactly BK23's deterministic
 * economics contract, already exemplary in one vertical. This generalises it;
 * it does not invent a second mechanism.
 *
 * CANONICAL LAW 4 — deterministic, tested, VERSIONED
 * --------------------------------------------------
 * All three parts are load-bearing and the version is the one usually
 * forgotten. Without it, improving a formula silently rewrites the meaning of
 * every historical number computed by the old one — the economics equivalent of
 * the mutable-decision failure law 6 forbids.
 *
 * WHAT A SCENARIO IS NOT
 * ----------------------
 * It is not an LLM output. `ENGINES` is a closed registry of deterministic
 * functions, and `computeScenario` will not run anything outside it. AI may
 * propose assumptions — that is what `origin: "derived"` is for — but the
 * arithmetic is code, always. `tests/unit/scenarioDeterminism.test.ts` pins it.
 *
 * PURE: no I/O, no clock, no database. `computedAt` is injected by the store.
 */

import {
  LAND_DEAL_ENGINE_ID,
  LAND_DEAL_ENGINE_VERSION,
  computeLandDeal,
  type CalculatorInputs,
  type CalculatorOutputs,
} from "../calculators/landDeal";

/** Bump when the SCENARIO envelope shape changes, not the engine arithmetic. */
export const SCENARIO_SHAPE_VERSION = 1 as const;

// ── Subjects ──────────────────────────────────────────────────────────────

export const SCENARIO_SUBJECT_TYPES = ["property", "opportunity", "deal"] as const;
export type ScenarioSubjectType = (typeof SCENARIO_SUBJECT_TYPES)[number];

// ── Assumptions ───────────────────────────────────────────────────────────

/**
 * An input that is a JUDGEMENT rather than an observation.
 *
 * Deliberately the same shape as `FrozenAssumption` in
 * shared/decisions/snapshot.ts, including `origin`. A resale price the investor
 * typed is a different kind of thing from one a Strategy Pack defaulted, and
 * the distinction has to survive from the scenario into the decision — losing
 * it at the boundary is how a platform default silently becomes "what the
 * customer believed".
 */
export interface ScenarioAssumption {
  key: string;
  value: string | number | boolean;
  unit?: string;
  origin: "user" | "strategy-pack-default" | "derived" | "platform-default";
  basis?: string;
}

// ── Metric registry ───────────────────────────────────────────────────────

/**
 * The controlled vocabulary of economic outputs (AY11).
 *
 * A closed registry rather than free-form keys, for the same reason the
 * evidence predicate registry is closed: comparability across time and across
 * strategies is the entire value, and it dies the moment two engines name the
 * same quantity differently.
 *
 * `unit` is mandatory. BI182 requires explicit units on every dimensional
 * value, and the failure it prevents is real — comparing a figure in cents with
 * one in dollars produces a number that looks plausible and is wrong by 100x.
 */
export type MetricUnit = "cents" | "ratio" | "months" | "percent";

export interface MetricSpec {
  id: string;
  label: string;
  unit: MetricUnit;
  /** True when a HIGHER value is better — drives comparison arrows in views. */
  higherIsBetter: boolean;
}

export const METRICS: readonly MetricSpec[] = [
  { id: "total_cost", label: "Total cost", unit: "cents", higherIsBetter: false },
  { id: "net_proceeds", label: "Net proceeds", unit: "cents", higherIsBetter: true },
  { id: "profit", label: "Profit", unit: "cents", higherIsBetter: true },
  { id: "roi", label: "Return on investment", unit: "ratio", higherIsBetter: true },
  {
    id: "annualized_return",
    label: "Annualised return (simple)",
    unit: "ratio",
    higherIsBetter: true,
  },
  { id: "irr", label: "IRR (annual)", unit: "ratio", higherIsBetter: true },
  {
    id: "breakeven_sale",
    label: "Break-even sale price",
    unit: "cents",
    higherIsBetter: false,
  },
  { id: "hold_months", label: "Hold period", unit: "months", higherIsBetter: false },
] as const;

const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

export function metricById(id: string): MetricSpec | undefined {
  return METRIC_BY_ID.get(id);
}

/**
 * One computed number.
 *
 * `value` is `null` when the engine could not compute it — an IRR is genuinely
 * undefined for some cash-flow shapes, and a break-even is undefined when the
 * total cost is zero. Null means UNDEFINED, and it must never be rendered as
 * zero: canonical law 3's rule about unknowns applies to arithmetic as much as
 * to evidence.
 */
export interface ScenarioMetric {
  id: string;
  value: number | null;
  unit: MetricUnit;
}

// ── Engine registry ───────────────────────────────────────────────────────

/**
 * The closed set of deterministic engines a Scenario may come from.
 *
 * Adding an entry means adding a pure, tested function. There is deliberately
 * no escape hatch for "call a model and store the answer": that would make a
 * language model authoritative for financial truth, which canonical law 4
 * forbids outright.
 */
export interface EngineSpec {
  id: string;
  version: string;
  label: string;
  /** Metric ids this engine produces. Every one must be in METRICS. */
  produces: string[];
}

export const ENGINES: readonly EngineSpec[] = [
  {
    id: LAND_DEAL_ENGINE_ID,
    version: LAND_DEAL_ENGINE_VERSION,
    label: "Land deal (buy, hold, resell)",
    produces: [
      "total_cost",
      "net_proceeds",
      "profit",
      "roi",
      "annualized_return",
      "irr",
      "breakeven_sale",
      "hold_months",
    ],
  },
] as const;

export function engineById(id: string): EngineSpec | undefined {
  return ENGINES.find((e) => e.id === id);
}

// ── The scenario ──────────────────────────────────────────────────────────

export interface ScenarioBody {
  shapeVersion: number;
  subjectType: ScenarioSubjectType;
  subjectId: number;
  /** Human name — "Base case", "Slow sale", "Cash offer". */
  label: string;
  engineId: string;
  /** The engine version AT COMPUTATION TIME. Never back-filled. */
  engineVersion: string;
  strategyPackId: string | null;
  strategyPackVersion: string | null;
  /** The verbatim inputs, so the number can be recomputed and defended later. */
  inputs: Record<string, number>;
  assumptions: ScenarioAssumption[];
  metrics: ScenarioMetric[];
}

export interface ComputeScenarioRequest {
  subjectType: ScenarioSubjectType;
  subjectId: number;
  label: string;
  engineId: string;
  inputs: Record<string, number>;
  assumptions?: ScenarioAssumption[];
  strategyPackId?: string | null;
  strategyPackVersion?: string | null;
}

/** Raised when a request names an engine or inputs the registry cannot honour. */
export class ScenarioEngineError extends Error {}

function requireCents(
  inputs: Record<string, number>,
  key: string,
): number {
  const v = inputs[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ScenarioEngineError(
      `Scenario input "${key}" is required and must be a finite number`,
    );
  }
  if (!Number.isInteger(v)) {
    // Money is integer cents throughout this codebase (shared/finance/cents.ts).
    // Accepting a float here is how 1/3 of a cent becomes a rounding difference
    // that nobody can explain two years later.
    throw new ScenarioEngineError(
      `Scenario input "${key}" must be an integer (money is cents, not dollars)`,
    );
  }
  return v;
}

/**
 * Compute a scenario deterministically.
 *
 * Same request in, same body out, forever — no clock, no I/O, no randomness.
 * That is what makes a stored scenario defensible: an auditor re-runs this with
 * the persisted `inputs` under the persisted `engineVersion` and must get the
 * persisted `metrics` back.
 */
export function computeScenario(req: ComputeScenarioRequest): ScenarioBody {
  const engine = engineById(req.engineId);
  if (!engine) {
    throw new ScenarioEngineError(
      `Unknown scenario engine "${req.engineId}". Financial numbers come from ` +
        `the registered deterministic engines only — never from a model response.`,
    );
  }

  if (engine.id !== LAND_DEAL_ENGINE_ID) {
    // Unreachable while ENGINES has one entry, but written as a hard failure
    // rather than a fallthrough so adding an engine to the registry without
    // wiring its computation fails loudly instead of silently returning zeros.
    throw new ScenarioEngineError(
      `Engine "${engine.id}" is registered but has no computation wired.`,
    );
  }

  const calcInputs: CalculatorInputs = {
    purchaseCents: requireCents(req.inputs, "purchaseCents"),
    closingAtBuyCents: requireCents(req.inputs, "closingAtBuyCents"),
    holdingPerMonthCents: requireCents(req.inputs, "holdingPerMonthCents"),
    holdMonths: requireCents(req.inputs, "holdMonths"),
    marketingCents: requireCents(req.inputs, "marketingCents"),
    salePriceCents: requireCents(req.inputs, "salePriceCents"),
    closingAtSaleCents: requireCents(req.inputs, "closingAtSaleCents"),
  };
  if (calcInputs.holdMonths < 1) {
    throw new ScenarioEngineError("holdMonths must be at least 1");
  }

  const out: CalculatorOutputs = computeLandDeal(calcInputs);

  const metrics: ScenarioMetric[] = [
    metric("total_cost", out.totalCostInCents),
    metric("net_proceeds", out.netProceedsCents),
    metric("profit", out.profitCents),
    metric("roi", out.roi),
    metric("annualized_return", out.annualizedReturn),
    metric("irr", out.irr),
    metric("breakeven_sale", out.breakevenSaleCents),
    metric("hold_months", calcInputs.holdMonths),
  ];

  return {
    shapeVersion: SCENARIO_SHAPE_VERSION,
    subjectType: req.subjectType,
    subjectId: req.subjectId,
    label: req.label,
    engineId: engine.id,
    engineVersion: engine.version,
    strategyPackId: req.strategyPackId ?? null,
    strategyPackVersion: req.strategyPackVersion ?? null,
    // Store what the engine actually consumed, not what the caller sent — an
    // extra field in the request must not read later as an input to the maths.
    inputs: { ...calcInputs },
    assumptions: req.assumptions ?? [],
    metrics,
  };
}

function metric(id: string, value: number | null): ScenarioMetric {
  const spec = metricById(id);
  if (!spec) {
    throw new ScenarioEngineError(`Unregistered metric "${id}"`);
  }
  return { id, value, unit: spec.unit };
}

// ── Reading a scenario ────────────────────────────────────────────────────

/** One metric's value, or null when the engine could not compute it. */
export function metricValue(body: ScenarioBody, id: string): number | null {
  return body.metrics.find((m) => m.id === id)?.value ?? null;
}

/**
 * The compact reference a DecisionSnapshot freezes.
 *
 * It carries the headline numbers as well as the id, so a decision stays
 * readable even if the scenario row is later unreachable — the same reasoning
 * that makes a frozen fact store its resolved value alongside its claim ids.
 */
export interface FrozenScenarioRef {
  scenarioId: number;
  label: string;
  engineId: string;
  engineVersion: string;
  /** A small, fixed set of headline metrics — not the whole output. */
  headline: ScenarioMetric[];
}

/** Metrics worth carrying into a decision record. */
const HEADLINE_METRIC_IDS = ["profit", "roi", "irr"] as const;

export function freezeScenarioRef(
  scenarioId: number,
  body: ScenarioBody,
): FrozenScenarioRef {
  return {
    scenarioId,
    label: body.label,
    engineId: body.engineId,
    engineVersion: body.engineVersion,
    headline: body.metrics.filter((m) =>
      (HEADLINE_METRIC_IDS as readonly string[]).includes(m.id),
    ),
  };
}
