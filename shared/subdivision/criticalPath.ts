// ============================================================================
// SHARED/SUBDIVISION/CRITICALPATH.TS — the entitlement critical path
// ("subdivision-critical-path v1"). Subdivision V1, Leg 4 (package 2026-11 §5.5).
// ----------------------------------------------------------------------------
// Pure and browser-safe. No server imports, no db, no clock: the as-of date is
// an INPUT, so the same inputs always render the same answer.
//
// WHAT THIS MEASURES: ELAPSED TIME AGAINST THE DECISION RUN'S OWN STATED
// TIMELINE. The yardstick is the p50 / p90 timeline the operator stated and
// that was frozen on the decision record (founder-decisions ruling 3,
// 2026-11-05). It is the operator's claim for this parcel, not a forecast and
// not a benchmark.
//
// NOTHING HERE READS A COUNTY FIGURE. The county timelines table is empty by
// design; no jurisdiction lead-time is consulted, defaulted or displayed, and
// no gate's expected return is ever filled in from one. A gate's expected
// return date is whatever the operator recorded on it, or absent.
//
// WITHHELD IS A STATED ANSWER, NEVER A DRESSED-UP ESTIMATE:
//   - NO DECISION → WITHHELD. With no subdivision decision on record there is
//     no stated timeline to measure against.
//   - NO STATED TIMELINE → WITHHELD. A decision that stated no p50 or p90 is
//     not measured against an assumed one (carry's discipline, inherited).
//   - NO EXPECTED RETURN DATES → NO PROJECTED FINISH, by name. A projection
//     needs an operator-recorded date on an open gate; it is not invented.
//   - NO OPEN GATES → NOTHING LEFT TO PROJECT. The projection is null with no
//     reason attached; the caller renders completion from the counts.
//
// CONVENTIONS: terminal gate statuses are exactly "approved" and "skipped"
// (how the permit tracker counts completion); every other status is open. All
// date arithmetic is whole UTC days on date-only values.
// ============================================================================

/** Statuses the permit tracker counts as complete. Everything else is open. */
const TERMINAL_GATE_STATUSES: readonly string[] = ["approved", "skipped"];

export interface CriticalPathGate {
  gateKey: string;
  label: string;
  sequence: number;
  /** PERMIT_GATE_STATUSES vocabulary. */
  status: string;
  /** Date-only "YYYY-MM-DD". */
  expectedReturnAt: string | null;
}

export interface CriticalPathDecision {
  /** ISO datetime of the decision. */
  recordedAt: string;
  /** pursue | pass */
  kind: string;
  timelineP50Days: number | null;
  timelineP90Days: number | null;
}

export interface CriticalPathInput {
  /** ISO datetime or date-only. */
  asOf: string;
  decision: CriticalPathDecision | null;
  gates: CriticalPathGate[];
}

export type CriticalPathResult =
  | { state: "withheld"; reason: string }
  | {
      state: "computed";
      elapsedDays: number;
      /** Date-only. */
      p50EndDate: string;
      /** Date-only. */
      p90EndDate: string;
      position: "within_p50" | "between_p50_p90" | "past_p90";
      completedGateCount: number;
      openGateCount: number;
      slippedGates: Array<{ gateKey: string; label: string; sequence: number; expectedReturnAt: string; daysOverdue: number }>;
      /** Date-only: the latest expected return among open gates. */
      projectedFinish: string | null;
      projectedFinishWithheldReason: string | null;
      /** projectedFinish − p90EndDate, signed whole days. */
      overrunVsP90Days: number | null;
    };

const MS_PER_DAY = 86_400_000;

/** UTC-midnight day number of a date-only or ISO datetime string; null if unparsable. */
function utcDayNumber(value: string): number | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const ms = dateOnly ? Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / MS_PER_DAY);
}

function dayNumberToDateOnly(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

function isStatedDays(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function computeCriticalPath(input: CriticalPathInput): CriticalPathResult {
  const { decision, gates } = input;

  if (decision === null) {
    return {
      state: "withheld",
      reason: "No subdivision decision has been recorded for this parcel yet, so there is no stated timeline to measure against.",
    };
  }
  if (!isStatedDays(decision.timelineP50Days) || !isStatedDays(decision.timelineP90Days)) {
    return {
      state: "withheld",
      reason: "The decision on record stated no timeline (p50 and p90), so there is nothing to measure elapsed time against. No timeline is assumed.",
    };
  }

  const asOfDay = utcDayNumber(input.asOf);
  if (asOfDay === null) {
    return { state: "withheld", reason: "The as-of date could not be read, so elapsed time is not computed." };
  }
  const recordedDay = utcDayNumber(decision.recordedAt);
  if (recordedDay === null) {
    return { state: "withheld", reason: "The decision on record carries no readable date, so elapsed time is not computed." };
  }

  const p50Days = decision.timelineP50Days;
  const p90Days = decision.timelineP90Days;
  const elapsedDays = Math.max(0, asOfDay - recordedDay);
  const p90EndDay = recordedDay + p90Days;

  const position: "within_p50" | "between_p50_p90" | "past_p90" =
    elapsedDays <= p50Days ? "within_p50" : elapsedDays <= p90Days ? "between_p50_p90" : "past_p90";

  const openGates = gates.filter((g) => !TERMINAL_GATE_STATUSES.includes(g.status));
  const completedGateCount = gates.length - openGates.length;

  const slippedGates: Array<{ gateKey: string; label: string; sequence: number; expectedReturnAt: string; daysOverdue: number }> = [];
  let latestReturnDay: number | null = null;
  for (const g of openGates) {
    if (g.expectedReturnAt === null) continue;
    const returnDay = utcDayNumber(g.expectedReturnAt);
    if (returnDay === null) continue;
    if (latestReturnDay === null || returnDay > latestReturnDay) latestReturnDay = returnDay;
    if (returnDay < asOfDay) {
      slippedGates.push({
        gateKey: g.gateKey,
        label: g.label,
        sequence: g.sequence,
        expectedReturnAt: g.expectedReturnAt,
        daysOverdue: asOfDay - returnDay,
      });
    }
  }
  slippedGates.sort((a, b) => a.sequence - b.sequence);

  let projectedFinish: string | null = null;
  let projectedFinishWithheldReason: string | null = null;
  let overrunVsP90Days: number | null = null;
  if (openGates.length > 0) {
    if (latestReturnDay === null) {
      projectedFinishWithheldReason = "No open gate carries an expected return date, so no finish is projected.";
    } else {
      projectedFinish = dayNumberToDateOnly(latestReturnDay);
      overrunVsP90Days = latestReturnDay - p90EndDay;
    }
  }

  return {
    state: "computed",
    elapsedDays,
    p50EndDate: dayNumberToDateOnly(recordedDay + p50Days),
    p90EndDate: dayNumberToDateOnly(p90EndDay),
    position,
    completedGateCount,
    openGateCount: openGates.length,
    slippedGates,
    projectedFinish,
    projectedFinishWithheldReason,
    overrunVsP90Days,
  };
}
