/**
 * What each outcome answer measures — the one definition Today's prompt asks
 * from and the evidence gate grades against.
 *
 * DEFECT-0287 (2026-10-04): "Acquired" asked "What did it actually cost to
 * acquire?" (price and closing) and filed the answer as `total_cost`, which
 * every engine computes all-in, rehab and holding included. An operator
 * answering at closing reported a figure without the rehab, so every
 * acquisition read as under budget by roughly the rehab, and calibration
 * learned the operator overestimates cost. The question was right; the metric
 * was wrong. It now measures `acquisition_cost`, which the engines predict as
 * exactly what the question asks for.
 *
 * A decision whose scenario predicted no `acquisition_cost` (one recorded
 * before this change) is simply not asked for a number at "Acquired" —
 * `measurableFor` offers only predicted metrics — rather than being compared
 * with a forecast of something else.
 */

export interface OutcomeMeasureSpec {
  metricId: string;
  question: string;
  hint: string;
}

export const OUTCOME_MEASURES = {
  acquired: {
    metricId: "acquisition_cost",
    question: "What did it actually cost to acquire?",
    hint: "Price plus closing — what you paid to take it down. Not rehab or holding costs; those come later.",
  },
  sold: {
    metricId: "profit",
    question: "What did you actually make?",
    hint: "Net of everything. A loss is fine — enter it with a minus sign.",
  },
} as const satisfies Record<string, OutcomeMeasureSpec>;

// Every metric an outcome answer can measure is `Object.values(OUTCOME_MEASURES)
// .map((m) => m.metricId)`; the evidence gate derives it from this object, so
// a decision is gradeable only if its engine predicts what Today really asks.
