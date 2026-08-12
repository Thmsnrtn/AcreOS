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
export type MetricUnit = "cents" | "ratio" | "months" | "days" | "percent";

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

  // ── Note / lending metrics (the second engine's vocabulary) ──
  // A LOWER payoff is better for the BORROWER and worse for the note HOLDER.
  // `higherIsBetter` is written from the perspective of the AcreOS customer,
  // who is the note holder — the investor whose scenario this is.
  {
    id: "payoff_total",
    label: "Total payoff",
    unit: "cents",
    higherIsBetter: true,
  },
  {
    id: "accrued_interest",
    label: "Accrued interest",
    unit: "cents",
    higherIsBetter: true,
  },
  {
    id: "principal_balance",
    label: "Principal balance",
    unit: "cents",
    higherIsBetter: true,
  },
  {
    id: "days_accrued",
    label: "Days accrued",
    unit: "days",
    higherIsBetter: true,
  },
] as const;

// `days` was added to MetricUnit the moment it was needed rather than deferred.
// It shipped briefly mislabelled as `months` with an apology in a comment; that
// is a dimensional lie of the exact kind BI182 exists to prevent (BI182: store
// explicit units — comparing a figure in one unit with one in another produces
// a number that looks plausible and is wrong). Correcting it was free HERE and
// only here: `scenarios` and `outcomes` are new tables that have never been
// deployed, so no persisted row carries the wrong label. That window is the
// pre-customer advantage BI104 describes, and it closes on first deploy.

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
  /**
   * The arithmetic. PURE — no I/O, no clock, no randomness. It also normalises
   * its own inputs and returns the exact set it consumed, so the persisted
   * `inputs` are what the engine actually used rather than whatever the caller
   * happened to send.
   */
  compute(inputs: Record<string, number | string>): {
    metrics: ScenarioMetric[];
    normalisedInputs: Record<string, number | string>;
  };
}

/**
 * The engines that live in `shared/` and can therefore run on either side.
 *
 * NOT the whole registry, and that is deliberate. Some engines are legitimately
 * server-side — the note payoff engine implements statute-adjacent arithmetic
 * and lives under `server/services/`, while `scripts/check-boundaries.mjs` rule
 * S1 forbids shared/ importing server/. Rather than move regulated code to
 * satisfy a module boundary, the registry is passed IN: a caller composes the
 * set it can legally see, and `computeScenario` refuses anything outside the
 * set it was handed. The closure guarantee survives — it becomes per-call
 * rather than global — and there is still no path from computeScenario to a
 * model.
 *
 * This mirrors the kernel/pack seam `server/services/autopilot/domainPack.ts`
 * already uses on the founder plane rather than inventing a second shape.
 */
export const CORE_ENGINES: readonly EngineSpec[] = [
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
    compute(inputs) {
      const calcInputs: CalculatorInputs = {
        purchaseCents: requireCents(inputs, "purchaseCents"),
        closingAtBuyCents: requireCents(inputs, "closingAtBuyCents"),
        holdingPerMonthCents: requireCents(inputs, "holdingPerMonthCents"),
        holdMonths: requireCents(inputs, "holdMonths"),
        marketingCents: requireCents(inputs, "marketingCents"),
        salePriceCents: requireCents(inputs, "salePriceCents"),
        closingAtSaleCents: requireCents(inputs, "closingAtSaleCents"),
      };
      if (calcInputs.holdMonths < 1) {
        throw new ScenarioEngineError("holdMonths must be at least 1");
      }
      const out: CalculatorOutputs = computeLandDeal(calcInputs);
      return {
        normalisedInputs: { ...calcInputs },
        metrics: [
          metric("total_cost", out.totalCostInCents),
          metric("net_proceeds", out.netProceedsCents),
          metric("profit", out.profitCents),
          metric("roi", out.roi),
          metric("annualized_return", out.annualizedReturn),
          metric("irr", out.irr),
          metric("breakeven_sale", out.breakevenSaleCents),
          metric("hold_months", calcInputs.holdMonths),
        ],
      };
    },
  },
];

export function engineById(
  id: string,
  engines: readonly EngineSpec[] = CORE_ENGINES,
): EngineSpec | undefined {
  return engines.find((e) => e.id === id);
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
  /**
   * The verbatim inputs, so the number can be recomputed and defended later.
   *
   * `string` is admitted for DATES (ISO-8601) and enum-like discriminators. It
   * is NOT a loophole for money: `requireCents` refuses anything that is not an
   * integer, so a dollar amount cannot arrive as "42000.50" and be accepted.
   */
  inputs: Record<string, number | string>;
  assumptions: ScenarioAssumption[];
  metrics: ScenarioMetric[];
}

export interface ComputeScenarioRequest {
  subjectType: ScenarioSubjectType;
  subjectId: number;
  label: string;
  engineId: string;
  inputs: Record<string, number | string>;
  assumptions?: ScenarioAssumption[];
  strategyPackId?: string | null;
  strategyPackVersion?: string | null;
}

/** Raised when a request names an engine or inputs the registry cannot honour. */
export class ScenarioEngineError extends Error {}

export function requireCents(
  inputs: Record<string, number | string>,
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
export function computeScenario(
  req: ComputeScenarioRequest,
  engines: readonly EngineSpec[] = CORE_ENGINES,
): ScenarioBody {
  const engine = engineById(req.engineId, engines);
  if (!engine) {
    throw new ScenarioEngineError(
      `Unknown scenario engine "${req.engineId}". Financial numbers come from ` +
        `the registered deterministic engines only — never from a model response.`,
    );
  }

  const { metrics, normalisedInputs } = engine.compute(req.inputs);

  // An engine that silently omits a metric it declared would produce a scenario
  // that looks complete and is not. Catch it at write time, not read time.
  const produced = new Set(metrics.map((m) => m.id));
  const missing = engine.produces.filter((id) => !produced.has(id));
  if (missing.length > 0) {
    throw new ScenarioEngineError(
      `Engine "${engine.id}" declares ${missing.join(", ")} but did not emit them.`,
    );
  }

  return {
    shapeVersion: SCENARIO_SHAPE_VERSION,
    subjectType: req.subjectType,
    subjectId: req.subjectId,
    label: req.label,
    engineId: engine.id,
    engineVersion: engine.version,
    strategyPackId: req.strategyPackId ?? null,
    strategyPackVersion: req.strategyPackVersion ?? null,
    // What the engine actually consumed, not what the caller sent — an extra
    // field in the request must not read later as an input to the maths.
    inputs: normalisedInputs,
    assumptions: req.assumptions ?? [],
    metrics,
  };
}

/** Build one metric, validated against the shared registry. */
export function metric(id: string, value: number | null): ScenarioMetric {
  const spec = metricById(id);
  if (!spec) {
    throw new ScenarioEngineError(`Unregistered metric "${id}"`);
  }
  return { id, value, unit: spec.unit };
}

/** An ISO-8601 date input. Refused rather than defaulted when malformed. */
export function requireIsoDate(
  inputs: Record<string, number | string>,
  key: string,
): Date {
  const v = inputs[key];
  if (typeof v !== "string") {
    throw new ScenarioEngineError(
      `Scenario input "${key}" is required and must be an ISO-8601 date string`,
    );
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new ScenarioEngineError(`Scenario input "${key}" is not a valid date: ${v}`);
  }
  return d;
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
