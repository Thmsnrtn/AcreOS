/**
 * Outcome — what actually happened, measured against what was decided.
 *
 * This closes the canonical loop (BI1):
 *
 *   REALITY → EVIDENCE → ECONOMICS → DECISION → PLAN → AUTHORIZED ACTION
 *           → WORKFLOW → OUTCOME → LEARNING
 *
 * `decision_snapshots` froze what was known and what was predicted. `scenarios`
 * froze the arithmetic. Neither records what the world then did. Without this,
 * an investor's own history is a pile of forecasts nobody ever graded — and
 * AA8 names the Decision→Outcome graph as one of the compounding moats, because
 * a competitor can copy a screen but not a customer's calibration.
 *
 * LAW 9 IS THE WHOLE DESIGN CONSTRAINT
 * ------------------------------------
 * "Outcomes append learning; they do not rewrite history." An Outcome
 * REFERENCES a DecisionSnapshot; it never edits one. That is why variance is
 * computed here as a PURE PROJECTION rather than stored: a stored variance
 * would be a third number that can drift from the two it derives from, and
 * "improving" it later would silently restate how good a past decision looked.
 *
 * BI178 adds the honesty requirement: an outcome is an OBSERVATION of what
 * happened, not retroactive validation of the decision. A good decision can
 * have a bad outcome. Nothing here scores a decision as right or wrong — it
 * reports the gap and leaves the interpretation to a human.
 *
 * PURE: no I/O, no clock, no database.
 */

import type { FrozenScenarioRef } from "../economics/scenario";
import { metricById, type MetricUnit } from "../economics/scenario";
import type { DecisionKind, DecisionSubjectType } from "../decisions/snapshot";

/** Bump when the frozen OUTCOME shape changes. */
export const OUTCOME_SHAPE_VERSION = 1 as const;

/**
 * What kind of real-world event this outcome records.
 *
 * A closed set, for the same reason DECISION_KINDS is closed: comparability
 * across time is the entire value of the record.
 */
export const OUTCOME_KINDS = [
  "acquired", // the purchase closed
  "sold", // the position was exited
  "offer_accepted",
  "offer_rejected",
  "abandoned", // pursued, then dropped without a transaction
  "still_open", // an interim observation; the position has not resolved
] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

/** One measured result. Same metric vocabulary as Scenario, deliberately. */
export interface ActualMetric {
  /** A registered metric id — the SAME registry a scenario predicts against. */
  id: string;
  /** null means NOT MEASURED. It never means zero. */
  value: number | null;
  unit: MetricUnit;
}

export interface OutcomeBody {
  shapeVersion: number;
  /** The decision this outcome is the result of. Never null. */
  decisionSnapshotId: number;
  subjectType: DecisionSubjectType;
  subjectId: number;
  kind: OutcomeKind;
  /** What happened, in the customer's words. */
  summary: string;
  actuals: ActualMetric[];
}

/** Raised when an outcome cites a metric the registry does not know. */
export class OutcomeMetricError extends Error {}

export function buildOutcome(input: {
  decisionSnapshotId: number;
  subjectType: DecisionSubjectType;
  subjectId: number;
  kind: OutcomeKind;
  summary: string;
  actuals: Array<{ id: string; value: number | null }>;
}): OutcomeBody {
  const actuals: ActualMetric[] = input.actuals.map((a) => {
    const spec = metricById(a.id);
    if (!spec) {
      // An unregistered metric is a bug, not a measurement. Refusing keeps the
      // predicted and actual sides speaking the same vocabulary, which is the
      // only thing that makes a variance meaningful.
      throw new OutcomeMetricError(
        `"${a.id}" is not a registered metric — an outcome must be measured in ` +
          `the same units a scenario predicts in.`,
      );
    }
    return { id: a.id, value: a.value, unit: spec.unit };
  });

  return {
    shapeVersion: OUTCOME_SHAPE_VERSION,
    decisionSnapshotId: input.decisionSnapshotId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    kind: input.kind,
    summary: input.summary,
    actuals,
  };
}

// ── Variance: a projection, never a stored number ─────────────────────────

/**
 * The comparison state for one metric.
 *
 * `unmeasured` and `unpredicted` are distinct on purpose. "We never measured
 * the IRR" and "we never predicted the IRR" are different facts about the
 * quality of a customer's own record-keeping, and collapsing them into one
 * "no data" state destroys exactly the signal that tells them which habit to
 * fix.
 */
export type VarianceState = "compared" | "unmeasured" | "unpredicted";

export interface MetricVariance {
  metricId: string;
  label: string;
  unit: MetricUnit;
  state: VarianceState;
  predicted: number | null;
  actual: number | null;
  /** actual − predicted. Present only when state === "compared". */
  delta?: number;
  /**
   * delta / |predicted|, as a decimal. Present only when both are present and
   * predicted is non-zero — dividing by zero produces Infinity, which renders
   * as a confident-looking number and means nothing.
   */
  relative?: number;
  /**
   * True when the actual moved in the direction the metric calls better.
   * Present only when compared. NOT a judgement on the decision (BI178) — a
   * good decision can have a bad outcome.
   */
  better?: boolean;
}

/**
 * Compare an outcome against the economics a decision froze.
 *
 * Deterministic and pure. Takes the decision's FROZEN scenario references
 * rather than live scenario rows: comparing against a re-read row would let a
 * later recomputation silently change how a past decision looks, which is the
 * failure law 6 forbids and law 9 repeats for outcomes.
 *
 * Every metric mentioned on EITHER side appears in the result. A predicted
 * metric that was never measured must stay visible — silently dropping it is
 * how a record of "we predicted five things and checked one" comes to read as
 * a clean scorecard.
 */
export function computeVariance(
  outcome: OutcomeBody,
  frozenScenarios: readonly FrozenScenarioRef[],
): MetricVariance[] {
  const predicted = new Map<string, number | null>();
  for (const s of frozenScenarios) {
    for (const m of s.predicted) {
      // When a decision cited several scenarios, the FIRST one that carries a
      // metric wins. Averaging rival hypotheses would invent a forecast nobody
      // actually made.
      if (!predicted.has(m.id)) predicted.set(m.id, m.value);
    }
  }

  const actual = new Map<string, number | null>();
  for (const a of outcome.actuals) actual.set(a.id, a.value);

  const ids = [...new Set([...predicted.keys(), ...actual.keys()])].sort();

  return ids.map((metricId) => {
    const spec = metricById(metricId);
    const label = spec?.label ?? metricId;
    const unit: MetricUnit = spec?.unit ?? "ratio";
    const p = predicted.has(metricId) ? (predicted.get(metricId) ?? null) : null;
    const a = actual.has(metricId) ? (actual.get(metricId) ?? null) : null;

    if (!predicted.has(metricId) || p === null) {
      return { metricId, label, unit, state: "unpredicted", predicted: p, actual: a };
    }
    if (!actual.has(metricId) || a === null) {
      return { metricId, label, unit, state: "unmeasured", predicted: p, actual: a };
    }

    const delta = a - p;
    const out: MetricVariance = {
      metricId,
      label,
      unit,
      state: "compared",
      predicted: p,
      actual: a,
      delta,
      better: spec ? (spec.higherIsBetter ? delta >= 0 : delta <= 0) : delta >= 0,
    };
    // Division by zero yields Infinity, which renders as a confident-looking
    // number and means nothing. Omit it instead.
    if (p !== 0) out.relative = delta / Math.abs(p);
    return out;
  });
}

/**
 * A one-line, honest summary of how a forecast held up.
 *
 * Deliberately does NOT say whether the decision was good. BI178: an outcome is
 * an observation of what happened, not retroactive validation of the choice.
 */
export function describeVariance(variances: readonly MetricVariance[]): string {
  const compared = variances.filter((v) => v.state === "compared");
  const unmeasured = variances.filter((v) => v.state === "unmeasured");
  const unpredicted = variances.filter((v) => v.state === "unpredicted");

  if (compared.length === 0) {
    return unpredicted.length > 0 && predictedNone(variances)
      ? "nothing was predicted, so nothing can be compared"
      : `${unmeasured.length} predicted metric(s) were never measured`;
  }

  const better = compared.filter((v) => v.better).length;
  const parts = [`${better}/${compared.length} metric(s) landed at or better than predicted`];
  if (unmeasured.length > 0) parts.push(`${unmeasured.length} never measured`);
  if (unpredicted.length > 0) parts.push(`${unpredicted.length} never predicted`);
  return parts.join("; ");
}

function predictedNone(variances: readonly MetricVariance[]): boolean {
  return variances.every((v) => v.state === "unpredicted");
}

/** Convenience: outcome kinds that mean the position has actually resolved. */
export function isTerminal(kind: OutcomeKind): boolean {
  return kind !== "still_open";
}

/** Decision kinds an outcome can meaningfully be recorded against. */
export function decisionAcceptsOutcome(kind: DecisionKind): boolean {
  // Every decision kind can have an outcome — including `pass`, whose outcome
  // ("the parcel sold for 3x nine months later") is the single most valuable
  // and least recorded fact in an investor's history.
  return typeof kind === "string";
}
