/**
 * Which measurement an outcome answer may ask for, on a given decision.
 *
 * `OutcomePrompt`'s header has always stated the rule:
 *
 *   > only for a metric the deciding engine actually PREDICTED, so the variance
 *   > it produces is a genuine comparison rather than two unrelated numbers
 *
 * The code did not implement it. The amount offered was keyed to the ANSWER
 * KIND alone — `acquired` → `total_cost`, `sold` → `profit` — under a comment
 * justifying that with *"both ids below are produced by the flip engine that
 * records these decisions"*. That was true when the flip analyzer was the only
 * recorder of decisions and false from the moment a second surface started
 * recording them. Today five surfaces do.
 *
 * What the gap actually costs: a decision that never forecast `profit` — the
 * subdivision lot-pricing lock records no Scenario at all, deliberately — would
 * be asked "what did you actually make?", and the answer would be stored as a
 * real measurement whose variance comes back `unpredicted`. Not corrupt: the
 * variance layer keeps `unmeasured` and `unpredicted` distinct precisely so
 * this stays legible. But it asks a customer for a number nothing can be
 * compared against, and then files it as though it could.
 *
 * This lives in its own module so the rule can be tested by CALLING it rather
 * than by grepping the component for a shape.
 */

/** The metric an answer could measure, when the answer can measure one. */
export interface OutcomeMeasure {
  metricId: string;
  question: string;
  hint: string;
}

/** Just enough of a due decision to decide what it can be asked. */
export interface MeasurableDecision {
  /**
   * Metric ids the decision's FROZEN scenarios predicted. Empty is a real and
   * common answer: many decisions record no economics at all, and one that
   * predicted nothing has nothing to be asked about.
   */
  predictedMetricIds: readonly string[];
}

/**
 * The measure this answer may ask for on this decision, or `null`.
 *
 * Returns the candidate unchanged when it applies, so the copy stays attached
 * to the metric it asks about — a question and a metric id that can drift apart
 * are how "what did you actually make?" ends up filed as `total_cost`.
 */
export function measurableFor(
  candidate: OutcomeMeasure | undefined,
  decision: MeasurableDecision,
): OutcomeMeasure | null {
  if (!candidate) return null;
  return decision.predictedMetricIds.includes(candidate.metricId) ? candidate : null;
}
