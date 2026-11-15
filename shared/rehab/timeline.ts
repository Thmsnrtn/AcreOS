/**
 * Rehab timeline truth — what was planned at kickoff, what actually happened,
 * and the holding cost each implies (fix-and-flip package, Leg 3, §9.3).
 *
 * Pure arithmetic on the operator's own rows. Three separate things, with
 * distinct names everywhere they render:
 *   - PLANNED  — the kickoff baseline: the dates the operator planned to enter
 *                each status phase, the planned listing date, the planned hold
 *                length and monthly holding cost. A revision is a NEW baseline
 *                that supersedes the previous one; the ORIGINAL is never
 *                updated, so variance is always measured against what was
 *                planned first, not against a plan quietly improved later.
 *   - ACTUAL   — the status-transition log and the recorded holding-cost
 *                entries. Both are facts: a move that happened, a cost that was
 *                paid. Nothing here recomputes them from another field.
 *   - COMPARISON — actual − planned, in whole days and in cents.
 *
 * NEVER INVENT A DATE. A phase that was never entered has `actualDate: null`
 * and `varianceDays: null` — it renders as "not recorded", not as zero
 * variance and not as today. The same holds for a plan that was never
 * recorded: a missing denominator yields null, never 0.
 *
 * DISAGREEMENT IS A FACT, NOT A VERDICT. `spendPastScenario` and
 * `timePastScenario` say only that recorded holding entries exceed the
 * scenario's assumed total, or that elapsed days exceed the scenario's hold
 * length at 30 days a month. No threshold, no recommendation, no "at risk"
 * label is invented here: a platform threshold presented as judgment would be
 * a platform figure dressed as the operator's own (§7.2).
 *
 * No server imports — these functions take plain rows and return plain values,
 * so the same arithmetic can be tested without a database.
 */

import { REHAB_STATUSES } from "../schema/fix-and-flip";

const MS_PER_DAY = 86_400_000;

/** A baseline row, narrowed to the fields the arithmetic reads. */
export interface BaselineLike {
  id: string;
  /** The baseline this revision replaces; null on the original. */
  supersedesId: string | null;
  plannedStartDate: string | null;
  plannedListingDate: string | null;
  plannedHoldMonths: number | null;
  plannedHoldingMonthlyCents: number | null;
  /** Each entry is the planned date of ENTERING that status phase. */
  phasePlans: { phase: string; plannedDate: string }[];
  recordedBy: string;
  createdAt: string;
}

/** A status-transition row. `fromStatus` is null on the creation record. */
export interface TransitionLike {
  fromStatus: string | null;
  toStatus: string;
  transitionedAt: string;
}

/** A recorded holding-cost entry. Negative amounts are corrections. */
export interface HoldingEntryLike {
  entryDate: string;
  category: string;
  amountCents: number;
}

export interface PhaseVariance {
  phase: string;
  plannedDate: string | null;
  actualDate: string | null;
  /** Whole days actual − planned; null when either side was never recorded. */
  varianceDays: number | null;
}

/** YYYY-MM-DD on UTC date parts; null when the value is not a date at all. */
function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  const head = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

/** Whole days since the epoch for a YYYY-MM-DD day, so differences are exact. */
function dayIndex(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / MS_PER_DAY) : null;
}

/** Whole days actual − planned; null unless both days are known. */
function daysBetween(planned: string | null, actual: string | null): number | null {
  if (!planned || !actual) return null;
  const a = dayIndex(planned);
  const b = dayIndex(actual);
  if (a === null || b === null) return null;
  return b - a;
}

function createdMs(b: BaselineLike): number {
  const ms = Date.parse(b.createdAt);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/**
 * The variance denominator: the baseline the planned figures are measured
 * against — the earliest-created baseline with no supersedes pointer, walked to
 * the root of the chain. Null for an empty list; a plan that does not exist is
 * not a plan of zero.
 */
export function originalBaseline(baselines: readonly BaselineLike[]): BaselineLike | null {
  if (!baselines || baselines.length === 0) return null;
  const byId = new Map(baselines.map((b) => [b.id, b] as const));
  const roots = baselines.filter((b) => b.supersedesId === null);
  // Several originals "should not happen"; if it does, the earliest wins.
  const pool = roots.length > 0 ? roots : baselines;
  let current = pool.reduce((earliest, b) => (createdMs(b) < createdMs(earliest) ? b : earliest));

  // Only reachable when no root exists (a broken chain): walk to the earliest
  // ancestor instead of stopping at whatever row happened to be earliest.
  const seen = new Set<string>();
  while (current.supersedesId !== null && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.supersedesId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function phaseRank(phase: string): number {
  const i = (REHAB_STATUSES as readonly string[]).indexOf(phase);
  return i === -1 ? REHAB_STATUSES.length : i;
}

/**
 * Planned vs actual per status phase, in rehab status order, over the union of
 * the phases the baseline planned and the phases the log actually entered.
 *
 * `actualDate` is the date part of the EARLIEST transition into that phase;
 * a phase that was never entered stays null with a null variance.
 */
export function phaseVariances(
  original: BaselineLike | null,
  transitions: readonly TransitionLike[],
): PhaseVariance[] {
  const planned = new Map<string, string | null>();
  for (const plan of original?.phasePlans ?? []) {
    if (!plan || typeof plan.phase !== "string") continue;
    // One planned date per phase; the first entry is the plan of record.
    if (!planned.has(plan.phase)) planned.set(plan.phase, isoDay(plan.plannedDate));
  }

  // Earliest entry into each phase — the first time the rehab was there.
  const actual = new Map<string, string>();
  for (const t of transitions ?? []) {
    if (!t || typeof t.toStatus !== "string") continue;
    const day = isoDay(t.transitionedAt);
    if (day === null) continue;
    const previous = actual.get(t.toStatus);
    if (previous === undefined) {
      actual.set(t.toStatus, day);
      continue;
    }
    const previousIdx = dayIndex(previous);
    const dayIdx = dayIndex(day);
    if (previousIdx !== null && dayIdx !== null && dayIdx < previousIdx) {
      actual.set(t.toStatus, day);
    }
  }

  const phases = [...new Set([...planned.keys(), ...actual.keys()])];
  // Known statuses in REHAB order; anything unrecognised sorts after them.
  phases.sort((a, b) => phaseRank(a) - phaseRank(b) || a.localeCompare(b));

  return phases.map((phase) => {
    const plannedDate = planned.get(phase) ?? null;
    const actualDate = actual.get(phase) ?? null;
    return { phase, plannedDate, actualDate, varianceDays: daysBetween(plannedDate, actualDate) };
  });
}

/**
 * Days listing ran late (positive) or early (negative): actual listing −
 * planned listing. Actual is the rehab's recorded listing date, else the date
 * of the earliest 'listed' transition, else null — never invented.
 */
export function listingVarianceDays(
  original: BaselineLike | null,
  actualListingDate: string | null,
  transitions: readonly TransitionLike[],
): number | null {
  const plannedDate = isoDay(original?.plannedListingDate ?? null);
  let actualDate = isoDay(actualListingDate ?? null);

  if (actualDate === null) {
    const listedDays = (transitions ?? [])
      .filter((t) => t && t.toStatus === "listed")
      .map((t) => isoDay(t.transitionedAt))
      .filter((d): d is string => d !== null)
      .sort();
    actualDate = listedDays[0] ?? null;
  }

  return daysBetween(plannedDate, actualDate);
}

/** The scenario's hold assumption, with where each figure came from. */
export interface ScenarioHoldLike {
  holdMonths: number | null;
  monthlyHoldingCostCents: number | null;
  holdMonthsOrigin: string | null;
  monthlyOrigin: string | null;
}

export interface HoldingComparisonInput {
  scenario: ScenarioHoldLike | null;
  baseline: BaselineLike | null;
  entriesTotalCents: number;
  elapsedDays: number | null;
  meterAccruedCents: number | null;
}

export interface HoldingComparison {
  scenario: null | {
    holdMonths: number | null;
    monthlyHoldingCostCents: number | null;
    assumedTotalCents: number | null;
    holdMonthsOrigin: string | null;
    monthlyOrigin: string | null;
  };
  baselinePlan: null | {
    plannedHoldMonths: number | null;
    plannedHoldingMonthlyCents: number | null;
    plannedTotalCents: number | null;
  };
  actuals: {
    entriesTotalCents: number;
    elapsedDays: number | null;
    meterAccruedCents: number | null;
  };
  disagreement: {
    /** Recorded entries exceed the scenario's assumed total. */
    spendPastScenario: boolean;
    /** Elapsed days exceed the scenario's hold length at 30 days a month. */
    timePastScenario: boolean;
  };
}

/** months × monthly; null unless both factors are known. */
function totalCents(months: number | null, monthlyCents: number | null): number | null {
  if (months === null || monthlyCents === null) return null;
  return months * monthlyCents;
}

/**
 * The scenario's assumed carry vs the baseline's planned carry vs what was
 * actually recorded — three figures side by side, each in its own bucket.
 * Nothing is summed across buckets: a plan is not spend, and a meter is not a
 * ledger.
 */
export function holdingComparison(input: HoldingComparisonInput): HoldingComparison {
  const scenario = input.scenario
    ? {
        holdMonths: input.scenario.holdMonths ?? null,
        monthlyHoldingCostCents: input.scenario.monthlyHoldingCostCents ?? null,
        assumedTotalCents: totalCents(
          input.scenario.holdMonths ?? null,
          input.scenario.monthlyHoldingCostCents ?? null,
        ),
        holdMonthsOrigin: input.scenario.holdMonthsOrigin ?? null,
        monthlyOrigin: input.scenario.monthlyOrigin ?? null,
      }
    : null;

  const baselinePlan = input.baseline
    ? {
        plannedHoldMonths: input.baseline.plannedHoldMonths ?? null,
        plannedHoldingMonthlyCents: input.baseline.plannedHoldingMonthlyCents ?? null,
        plannedTotalCents: totalCents(
          input.baseline.plannedHoldMonths ?? null,
          input.baseline.plannedHoldingMonthlyCents ?? null,
        ),
      }
    : null;

  const rawEntries = Number(input.entriesTotalCents);
  const entriesTotalCents = Number.isFinite(rawEntries) ? rawEntries : 0;
  const elapsedDays = input.elapsedDays ?? null;
  const meterAccruedCents = input.meterAccruedCents ?? null;

  return {
    scenario,
    baselinePlan,
    actuals: { entriesTotalCents, elapsedDays, meterAccruedCents },
    disagreement: {
      spendPastScenario: scenario !== null && scenario.assumedTotalCents !== null && entriesTotalCents > scenario.assumedTotalCents,
      timePastScenario: scenario !== null && scenario.holdMonths !== null && elapsedDays !== null && elapsedDays > scenario.holdMonths * 30,
    },
  };
}
