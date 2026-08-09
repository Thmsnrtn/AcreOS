/**
 * Rent-charge scheduling — which periods a lease owes, and which of those are
 * already on the ledger.
 *
 * What was missing
 * ────────────────
 * `POST /api/leases/:id/rent-charges/seed` existed, but nothing ever generated
 * a charge on the lease's own schedule. A landlord who never pressed "seed"
 * had an empty ledger, so aging buckets, the collected-% tile and the late-fee
 * engine were all computing over rent that was owed and never recorded.
 *
 * Two rules this module enforces
 * ──────────────────────────────
 * 1. IDEMPOTENT PER PERIOD. `planRentCharges` is given the set of months
 *    already on the ledger and returns only the missing ones. A second run
 *    with the first run's output folded in returns an empty `create` list.
 *    (The DB unique index `rent_charges_lease_month_uk` is the second line of
 *    defence; this planner is the first, so the common path never even
 *    attempts a duplicate insert.)
 * 2. NO INVENTED PRORATION. A lease that starts or ends mid-month owes a
 *    partial period whose amount depends on the proration convention written
 *    into the lease (monthly/30ths, actual days, half-month). We do not hold
 *    that term, so we do NOT compute an amount: the partial period comes back
 *    as a `skipped` entry with a reason, for the operator to post by hand at
 *    the agreed figure. Charging a full month for a half month of tenancy
 *    would be an overcharge we invented.
 *
 * Pure module: no DB, no I/O. `throughDate` is passed in, never read from the
 * clock, so the planner is deterministic and testable.
 */

import {
  effectiveBaseRentForMonth,
  type RentScheduleStepInput,
} from "./rentEscalation";

export interface LeaseScheduleInput {
  /** YYYY-MM-DD, first day of the tenancy. */
  startDate: string;
  /** YYYY-MM-DD, last day of the tenancy. Null ⇒ month-to-month. */
  endDate: string | null;
  /** 1-31; clamped to the last day of short months. */
  rentDueDayOfMonth: number;
  /** Integer cents of full-period rent — the BASE before any escalation step. */
  monthlyRentCents: number;
  /**
   * Commercial rent-escalation steps (Wave 4). OPTIONAL and additive: omitted or
   * empty for every residential lease and every commercial lease without defined
   * escalation, in which case each period is billed the flat monthlyRentCents,
   * unchanged. When present, the amount for each period is the escalated base for
   * that month (see effectiveBaseRentForMonth).
   */
  scheduleSteps?: readonly RentScheduleStepInput[];
  /** Section 8 splits, carried onto the charge when present. */
  isSection8?: boolean;
  hapPortionCents?: number | null;
  tenantPortionCents?: number | null;
}

export interface PlannedRentCharge {
  /** YYYY-MM-01 — the period key, and the ledger's uniqueness key. */
  chargedForMonth: string;
  /** YYYY-MM-DD the rent is due for that period. */
  dueDate: string;
  amountCents: number;
  hapPortionCents: number | null;
  tenantPortionCents: number | null;
}

export interface SkippedRentPeriod {
  chargedForMonth: string;
  reason: string;
  /** Machine-readable so the UI can group. */
  code: "partial_first_period" | "partial_final_period" | "already_on_ledger";
}

export interface RentChargePlan {
  create: PlannedRentCharge[];
  skipped: SkippedRentPeriod[];
  /** Periods the planner considered, whatever their fate. */
  periodsConsidered: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a (1-based) month. */
export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function parseYmd(iso: string): { y: number; m: number; d: number } | null {
  const t = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const d = Number(t.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** monthKey for a date: YYYY-MM-01. */
export function monthKeyOf(iso: string): string | null {
  const p = parseYmd(iso);
  return p ? `${p.y}-${pad2(p.m)}-01` : null;
}

/** Months between two month keys, inclusive of both ends. */
function monthSpan(fromKey: string, toKey: string): string[] {
  const from = parseYmd(fromKey);
  const to = parseYmd(toKey);
  if (!from || !to) return [];
  const out: string[] = [];
  let y = from.y;
  let m = from.m;
  // Guard against a runaway loop on absurd inputs (cap at 25 years).
  for (let i = 0; i < 300; i++) {
    const key = `${y}-${pad2(m)}-01`;
    out.push(key);
    if (y === to.y && m === to.m) return out;
    if (y > to.y || (y === to.y && m > to.m)) return out.slice(0, -1);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Due date for a period: the lease's due day, clamped to the month's length. */
export function dueDateForPeriod(monthKey: string, rentDueDayOfMonth: number): string {
  const p = parseYmd(monthKey);
  if (!p) return monthKey;
  const clamped = Math.min(Math.max(1, Math.trunc(rentDueDayOfMonth)), daysInMonth(p.y, p.m));
  return `${p.y}-${pad2(p.m)}-${pad2(clamped)}`;
}

/**
 * Plan the charges a lease owes through `throughDate`, minus the periods
 * already on the ledger.
 *
 * @param existingMonths month keys (YYYY-MM-01) already present in
 *        `rent_charges` for this lease. Pass every one of them — a partial set
 *        is what would let a duplicate through.
 */
export function planRentCharges(args: {
  lease: LeaseScheduleInput;
  existingMonths: readonly string[];
  /** YYYY-MM-DD — generate periods whose month starts on or before this. */
  throughDate: string;
}): RentChargePlan {
  const { lease } = args;
  const startKey = monthKeyOf(lease.startDate);
  const throughKey = monthKeyOf(args.throughDate);
  if (!startKey || !throughKey) {
    return { create: [], skipped: [], periodsConsidered: 0 };
  }

  const endKeyFromLease = lease.endDate ? monthKeyOf(lease.endDate) : null;
  // Never generate past the lease's own end, and never past the horizon.
  const lastKey =
    endKeyFromLease && endKeyFromLease < throughKey ? endKeyFromLease : throughKey;
  if (lastKey < startKey) {
    return { create: [], skipped: [], periodsConsidered: 0 };
  }

  const existing = new Set(args.existingMonths.map((m) => String(m).slice(0, 10)));
  const start = parseYmd(lease.startDate);
  const end = lease.endDate ? parseYmd(lease.endDate) : null;

  const create: PlannedRentCharge[] = [];
  const skipped: SkippedRentPeriod[] = [];
  const periods = monthSpan(startKey, lastKey);

  for (const key of periods) {
    if (existing.has(key)) {
      skipped.push({ chargedForMonth: key, code: "already_on_ledger", reason: "Already on the ledger." });
      continue;
    }

    // Partial FIRST period — tenancy begins after the 1st.
    if (start && key === startKey && start.d !== 1) {
      skipped.push({
        chargedForMonth: key,
        code: "partial_first_period",
        reason:
          `Tenancy starts ${lease.startDate}, so ${key.slice(0, 7)} is a partial period. ` +
          "Proration is a lease term AcreOS does not hold — post this first charge manually at the agreed amount.",
      });
      continue;
    }

    // Partial FINAL period — tenancy ends before the month's last day.
    if (end && key === endKeyFromLease && end.d !== daysInMonth(end.y, end.m)) {
      skipped.push({
        chargedForMonth: key,
        code: "partial_final_period",
        reason:
          `Tenancy ends ${lease.endDate}, so ${key.slice(0, 7)} is a partial period. ` +
          "Proration is a lease term AcreOS does not hold — post this final charge manually at the agreed amount.",
      });
      continue;
    }

    create.push({
      chargedForMonth: key,
      dueDate: dueDateForPeriod(key, lease.rentDueDayOfMonth),
      // No steps ⇒ effectiveBaseRentForMonth returns monthlyRentCents unchanged
      // (the residential invariant); steps ⇒ the escalated base for this month.
      amountCents: effectiveBaseRentForMonth(
        lease.monthlyRentCents,
        lease.scheduleSteps ?? [],
        key,
      ),
      hapPortionCents: lease.isSection8 ? lease.hapPortionCents ?? null : null,
      tenantPortionCents: lease.isSection8 ? lease.tenantPortionCents ?? null : null,
    });
  }

  return { create, skipped, periodsConsidered: periods.length };
}
