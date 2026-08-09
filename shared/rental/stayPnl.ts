// ============================================================================
// SHARED/RENTAL/STAYPNL.TS — the per-stay profit & loss, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports beyond the sibling NOI
// axis. This is the ONE place a short-term-rental stay's P&L is computed, so the
// rule that keeps that number honest is decided once here and cannot be
// re-decided per call site:
//
//   REFUSE, NEVER FABRICATE. A stay's net is
//       gross − channelFee − cleaningFee − taxes − allocatedOperatingExpense
//   and every term of it is a figure the operator RECORDED off their own channel
//   payout (or a real allocation of their own recorded expenses). A term the
//   operator never recorded is UNKNOWN, and an unknown term is not "0":
//     • A fee the reservation genuinely records as absent (a recorded 0 — a
//       direct booking with no channel fee) shows a real $0 line and subtracts
//       0. That is a measurement, not a guess.
//     • A fee the reservation does NOT record (a null column) is UNKNOWN. Its
//       line is OMITTED (marked unavailable), and — because "gross − unknown" is
//       itself unknown — the NET REFUSES (null) rather than silently subtract a
//       fabricated 0 that would overstate profit. Disclose the gap; never invent
//       the fee, and never a "$0" that reads as a recorded zero.
//     • The allocated operating expense is a real allocation of the property's
//       MEASURED operating expenses (noi.ts's isOperating rule — never
//       mortgage_interest/depreciation) across the stay's nights. When the
//       property has NO measured operating expenses, that term is null
//       (unavailable, disclosed) — NOT a guessed 40%-of-revenue ratio — and the
//       net refuses with it. A guessed opex ratio is exactly the fabricated
//       number the property_expenses ledger exists to replace.
//
// This mirrors noi.ts (NOI falls away when op-ex is unmeasured, never a guess)
// and camReconciliation.ts (a share is derived or REFUSED, never invented). A
// per-stay P&L that quietly assumed the missing pieces were zero would read as a
// fatter margin than the operator actually earned — the precise dishonesty this
// engine refuses.
//
// MONEY POSTURE (founder ruling "be the rail, not the provider")
// ──────────────────────────────────────────────────────────────
// RECORD-ONLY. Every figure here is one the operator already recorded off money
// that moved elsewhere (Airbnb/VRBO/their own processor). Nothing in this file
// moves, holds, collects or charges a cent; it totals recorded facts.
// ============================================================================

import { summarizeMeasuredOpEx, type MeasurableExpenseRow } from "./noi";

/** cents → a whole-cent integer, tolerant of a numeric-string column read. */
function centsOf(value: number): number {
  return Math.round(Number(value));
}

const DAY = 86_400_000;

/** Midnight-UTC epoch ms for a YYYY-MM-DD date, or null when blank/malformed. */
function dayMs(isoDate: string | null | undefined): number | null {
  if (typeof isoDate !== "string" || isoDate.length < 10) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** First-of-month (UTC ms) for a YYYY-MM-DD date, or null when unparseable. */
function monthStartMs(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  return Number.isNaN(ms) ? null : ms;
}

/** First-of-NEXT-month (UTC ms) for a YYYY-MM-DD date, or null when unparseable. */
function nextMonthStartMs(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]), 1); // month index +1 (Date.UTC normalises Dec→Jan)
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The reservation's OWN recorded money, as much of it as the P&L needs. Every
 * field is nullable and carries the exact column value: a NUMBER (including a
 * genuine 0) is a recorded figure; NULL is "not recorded" — unknown, never 0.
 * The gross is the anchor; the three fees are pass-through/deducted terms.
 */
export interface StayPnlReservationInput {
  grossBookingCents: number | null;
  channelFeeCents: number | null;
  cleaningFeeCents: number | null;
  taxesCents: number | null;
}

/** The five P&L component keys, in statement order (gross first, then deductions). */
export type StayPnlLineKey =
  | "gross_booking"
  | "channel_fee"
  | "cleaning_fee"
  | "taxes"
  | "allocated_operating_expense";

export interface StayPnlLine {
  key: StayPnlLineKey;
  label: string;
  /** "income" for gross booking; "deduction" for the fees and allocated op-ex. */
  kind: "income" | "deduction";
  /** The recorded/allocated cents, or null when the input was unknown (unavailable). */
  amountCents: number | null;
  /**
   * True when the term is a recorded/allocated figure (a real number, incl. a
   * genuine 0). False when the input was unknown — the line is disclosed as
   * unavailable rather than fabricated as a 0.
   */
  available: boolean;
}

export interface StayPnl {
  grossBookingCents: number | null;
  channelFeeCents: number | null;
  cleaningFeeCents: number | null;
  taxesCents: number | null;
  allocatedOperatingExpenseCents: number | null;
  /**
   * gross − channelFee − cleaningFee − taxes − allocatedOperatingExpense — a real
   * figure ONLY when every term is known. NULL when any term is unknown (an
   * unrecorded fee, or an unmeasured operating expense): the honest refusal, not
   * a net computed by treating the unknowns as 0.
   */
  netCents: number | null;
  /** The component keys whose input was unknown (unavailable) — disclosed, never invented. */
  unavailableComponents: StayPnlLineKey[];
  /** One line per component, in statement order, each with its availability. */
  lines: StayPnlLine[];
}

const LINE_LABELS: Record<StayPnlLineKey, string> = {
  gross_booking: "Gross booking",
  channel_fee: "Channel fee",
  cleaning_fee: "Cleaning fee",
  taxes: "Taxes",
  allocated_operating_expense: "Allocated operating expense",
};

/**
 * Compute a short-term-rental stay's P&L from the reservation's OWN recorded
 * amounts plus an allocated operating expense (see allocateStayOperatingExpense).
 *
 * `allocatedOperatingExpenseCents` is passed SEPARATELY (the route allocates the
 * property's measured operating expenses to the stay) and is null when the
 * property has no measured operating expenses — in which case the op-ex line is
 * unavailable and the net refuses rather than assume the overhead was zero.
 *
 * netCents is a real number only when gross AND all four deductions are known;
 * any unknown term makes netCents null and lists the term in
 * unavailableComponents. A genuine recorded 0 is known (not unknown) and
 * subtracts 0 — the direct-booking-with-no-channel-fee case computes a real net.
 */
export function computeStayPnl(input: {
  reservation: StayPnlReservationInput;
  allocatedOperatingExpenseCents: number | null;
}): StayPnl {
  const { reservation, allocatedOperatingExpenseCents } = input;

  const raw: Record<StayPnlLineKey, number | null> = {
    gross_booking: reservation.grossBookingCents,
    channel_fee: reservation.channelFeeCents,
    cleaning_fee: reservation.cleaningFeeCents,
    taxes: reservation.taxesCents,
    allocated_operating_expense: allocatedOperatingExpenseCents,
  };

  const order: StayPnlLineKey[] = [
    "gross_booking",
    "channel_fee",
    "cleaning_fee",
    "taxes",
    "allocated_operating_expense",
  ];

  const lines: StayPnlLine[] = [];
  const unavailableComponents: StayPnlLineKey[] = [];
  for (const key of order) {
    const value = raw[key];
    const available = value != null;
    if (!available) unavailableComponents.push(key);
    lines.push({
      key,
      label: LINE_LABELS[key],
      kind: key === "gross_booking" ? "income" : "deduction",
      amountCents: available ? centsOf(value) : null,
      available,
    });
  }

  // Net refuses (null) unless every term is known: "gross − unknown" is unknown,
  // and subtracting a fabricated 0 would overstate the margin.
  const netCents =
    unavailableComponents.length === 0
      ? centsOf(raw.gross_booking as number) -
        centsOf(raw.channel_fee as number) -
        centsOf(raw.cleaning_fee as number) -
        centsOf(raw.taxes as number) -
        centsOf(raw.allocated_operating_expense as number)
      : null;

  return {
    grossBookingCents: raw.gross_booking != null ? centsOf(raw.gross_booking) : null,
    channelFeeCents: raw.channel_fee != null ? centsOf(raw.channel_fee) : null,
    cleaningFeeCents: raw.cleaning_fee != null ? centsOf(raw.cleaning_fee) : null,
    taxesCents: raw.taxes != null ? centsOf(raw.taxes) : null,
    allocatedOperatingExpenseCents:
      raw.allocated_operating_expense != null ? centsOf(raw.allocated_operating_expense) : null,
    netCents,
    unavailableComponents,
    lines,
  };
}

export interface StayOperatingExpenseAllocation {
  /**
   * The operating expense allocated to the stay, in cents — a real number only
   * when the property has measured operating expenses AND a derivable expense
   * window. NULL (unavailable) otherwise: no measured op-ex means no allocation,
   * NOT a guessed ratio.
   */
  allocatedOperatingExpenseCents: number | null;
  /** Sum of the property's OPERATING expense rows over the window, in cents. */
  operatingSumCents: number;
  /** How many OPERATING rows were present — 0 means nothing was measured. */
  operatingRowCount: number;
  /**
   * Nights the operating-expense window spans (first-of-earliest-month to
   * first-of-month-after-latest), or null when not derivable. The allocation
   * denominator — refused rather than guessed when unknowable.
   */
  windowNights: number | null;
  /** The stay's nights (the allocation numerator), echoed back. */
  stayNights: number;
}

/**
 * Allocate a property's MEASURED operating expenses to one stay, pro-rated by the
 * stay's nights over the expense window's nights.
 *
 * The operating rows are summarised by noi.ts's summarizeMeasuredOpEx (REUSED),
 * so the isOperating rule is the SAME one NOI and CAM use — mortgage_interest and
 * depreciation can never enter the allocation even if passed in. The window is
 * the span from the first day of the earliest operating-expense month to the
 * first day of the month after the latest, so a single month of expenses is that
 * month's real day-count (never a fabricated span). A stay bears
 *   operatingSum × stayNights / windowNights
 * of that recorded cost. If nothing was measured (rowCount 0) or the window is
 * not derivable, the allocation is null (unavailable) — the caller discloses it
 * and the net refuses, rather than inventing an operating cost from a ratio.
 */
export function allocateStayOperatingExpense(args: {
  expenseRows: MeasurableExpenseRow[];
  stayNights: number;
}): StayOperatingExpenseAllocation {
  const { expenseRows, stayNights } = args;
  const summary = summarizeMeasuredOpEx(expenseRows);

  // The window spans only the OPERATING rows (the ones the allocation sums).
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const r of expenseRows) {
    if (!r.isOperating) continue;
    const start = monthStartMs(r.incurredOn);
    const end = nextMonthStartMs(r.incurredOn);
    if (start == null || end == null) continue;
    if (earliest == null || start < earliest) earliest = start;
    if (latest == null || end > latest) latest = end;
  }

  const windowNights =
    earliest != null && latest != null && latest > earliest
      ? Math.round((latest - earliest) / DAY)
      : null;

  let allocatedOperatingExpenseCents: number | null;
  if (summary.rowCount <= 0 || windowNights == null) {
    // No measured op-ex, or no derivable window → unavailable, never a guess.
    allocatedOperatingExpenseCents = null;
  } else if (stayNights <= 0) {
    allocatedOperatingExpenseCents = 0;
  } else {
    allocatedOperatingExpenseCents = Math.round(
      summary.sumCents * (stayNights / windowNights),
    );
  }

  return {
    allocatedOperatingExpenseCents,
    operatingSumCents: summary.sumCents,
    operatingRowCount: summary.rowCount,
    windowNights,
    stayNights,
  };
}

/** Whole nights between two YYYY-MM-DD dates (end exclusive), or null if unparseable. */
export function stayNightsBetween(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number | null {
  const a = dayMs(checkIn);
  const b = dayMs(checkOut);
  if (a == null || b == null || b <= a) return null;
  return Math.round((b - a) / DAY);
}
