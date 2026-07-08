/**
 * planner — multi-step plan over the causal model + plan-repair commitment
 * ledger (Frontier #7). KERNEL.
 *
 * The brain picks ONE move per tick today (rankMovesByCausalEv is single-step).
 * The planner adds bounded LOOKAHEAD: a short, ordered sequence of distinct
 * high-EV moves the brain INTENDS over the next K ticks — its plan. It then
 * keeps a commitment ledger (what it predicted vs what actually happened) and
 * REPAIRS the plan when reality diverges: a step that under-delivers is dropped
 * and the remainder re-sequenced from the observed state.
 *
 * SAFETY: a plan is INTENT, never a bypass. Each step, when it executes, still
 * runs through the entire gate stack (compliance → eval → budget → autonomy →
 * risk → witnessed-send) one move at a time — exactly as a single-step decision
 * does. The planner never lets the brain "commit ahead" past a gate; it only
 * orders what the brain would consider anyway, and makes its multi-step thinking
 * legible (glass-box) + measurable (the ledger). The safety ladder still
 * dominates: planning happens WITHIN a tier, never across one.
 *
 * Distinct-move + diminishing-returns model: a plan never repeats a move (you
 * don't stack the same lever K times); each later step's contribution is
 * discounted, reflecting that the first pull of a lever is worth the most. Pure
 * + total — no DB, no clock. Persisting the ledger across ticks + executing
 * step-by-step in the live loop is the documented integration follow-up.
 */

export interface PlanStep {
  moveKind: string;
  /** Predicted causal-EV of this move (outcome deltaPct × confidence) at plan time. */
  predictedEv: number;
  /** Discounted contribution to the plan's total (predictedEv × decay^index). */
  weightedEv: number;
}

export interface Plan {
  steps: PlanStep[];
  /** Sum of weightedEv across steps — the plan's total predicted value. */
  totalEv: number;
  /** The per-step diminishing factor used (0..1]. */
  decay: number;
}

/** A move + its predicted EV, the planner's raw input (from worldModel.moveEvMap). */
export interface MoveEv {
  moveKind: string;
  ev: number;
}

/**
 * Build a bounded plan: the top `horizon` DISTINCT moves by predicted EV, each
 * later step discounted by `decay^index`. Only positive-EV moves are planned
 * (a non-positive move earns no place — honest null-action default). Pure +
 * deterministic (ties broken by incoming order). horizon/decay are clamped sane.
 */
export function buildPlan(moves: MoveEv[], horizon = 3, decay = 0.6): Plan {
  const h = Math.max(1, Math.floor(horizon));
  const d = decay > 0 && decay <= 1 ? decay : 0.6;
  const seen = new Set<string>();
  const ranked = moves
    .filter((m) => Number.isFinite(m.ev) && m.ev > 0)
    .map((m, i) => ({ ...m, i }))
    .sort((a, b) => (b.ev !== a.ev ? b.ev - a.ev : a.i - b.i));
  const steps: PlanStep[] = [];
  for (const m of ranked) {
    if (steps.length >= h) break;
    if (seen.has(m.moveKind)) continue;
    seen.add(m.moveKind);
    const weightedEv = m.ev * Math.pow(d, steps.length);
    steps.push({ moveKind: m.moveKind, predictedEv: m.ev, weightedEv });
  }
  return { steps, totalEv: steps.reduce((s, x) => s + x.weightedEv, 0), decay: d };
}

export interface StepOutcome {
  moveKind: string;
  /** The REALIZED EV/value of the step (observed, not predicted). */
  actualEv: number;
}

export interface PlanProgress {
  executed: number;
  /** Cumulative predicted EV over the executed steps. */
  predicted: number;
  /** Cumulative actual EV over the executed steps. */
  actual: number;
  /** actual / predicted (1 = on track; <1 = under-delivering). 1 when nothing predicted. */
  attainment: number;
  /** True once attainment falls below the divergence threshold over ≥1 step. */
  diverged: boolean;
}

/**
 * Compare a plan's predictions to what actually happened over the executed
 * steps. `diverged` fires when cumulative attainment drops below `threshold`
 * (default 0.5 — reality delivered less than half the plan predicted). Pure.
 * Outcomes are matched to steps by moveKind; unexecuted steps don't count.
 */
export function assessPlanProgress(plan: Plan, outcomes: StepOutcome[], threshold = 0.5): PlanProgress {
  const byKind = new Map(outcomes.map((o) => [o.moveKind, o.actualEv]));
  let predicted = 0;
  let actual = 0;
  let executed = 0;
  for (const step of plan.steps) {
    if (!byKind.has(step.moveKind)) continue;
    executed++;
    predicted += step.predictedEv;
    actual += byKind.get(step.moveKind)!;
  }
  const attainment = predicted > 0 ? actual / predicted : 1;
  return { executed, predicted, actual, attainment, diverged: executed > 0 && attainment < threshold };
}

/**
 * Repair a plan after divergence: drop the moves that already executed (their
 * shot is spent) and re-plan the remaining HORIZON from the still-available
 * candidates' CURRENT EVs (the caller supplies fresh EVs from the observed
 * state). This is the commitment ledger closing the loop — a plan is a
 * hypothesis, and a falsified one is re-formed, not blindly pursued. Pure.
 */
export function repairPlan(executedKinds: string[], freshMoves: MoveEv[], horizon = 3, decay = 0.6): Plan {
  const spent = new Set(executedKinds);
  return buildPlan(freshMoves.filter((m) => !spent.has(m.moveKind)), horizon, decay);
}

/** The next move a plan recommends (its first step), or null for an empty plan. */
export function nextStep(plan: Plan): string | null {
  return plan.steps[0]?.moveKind ?? null;
}
