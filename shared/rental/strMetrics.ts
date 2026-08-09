// ============================================================================
// SHARED/RENTAL/STRMETRICS.TS — the short-term-rental performance metrics.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. This turns a window of
// RESERVATIONS (the nightly-stay primitive, shared/schema/rental.ts) into the
// four numbers an STR operator manages to — occupancy, room revenue, ADR
// (average daily rate) and RevPAR (revenue per available night) — with the ONE
// honesty rule that no call site can re-decide living here:
//
//   REFUSE, NEVER FABRICATE. A rate is a ratio, and a ratio with a zero or
//   unknown denominator is not "0" — it is UNKNOWN. So:
//     • ADR (roomRevenue / bookedNights) is NULL when bookedNights is 0.
//       There is no average nightly rate across zero nights; a "$0 ADR" would
//       read as "we rent for nothing", which is a lie about an empty window.
//     • Occupancy (bookedNights / availableNights) and RevPAR
//       (roomRevenue / availableNights) are NULL when availableNights is not
//       derivable — i.e. availableUnitNights is 0 or unknown. Occupancy against
//       an unknown denominator is the exact "half-empty building reports 100%"
//       failure the units table was built to end; refuse it here too.
//
// WHY A SEPARATE, PURE FUNCTION
// ─────────────────────────────
// The str-metrics route (server/routes-rent-ledger.ts) is DB-backed, so its math
// cannot be exercised without a database. Pulling the windowing, the pro-ration
// and the two refusals into a pure function gives them a real behavioural test
// (tests/unit/strMetrics.test.ts) rather than a source-level assertion, and keeps
// the refusal rule in ONE place.
//
// OPERATOR'S OWN AMOUNTS ONLY — NO SUGGESTED RATE
// ───────────────────────────────────────────────
// roomRevenue is derived ONLY from the reservation's OWN recorded amounts (gross
// booking, less the pass-through cleaning fee and taxes). There is no market/
// dynamic "suggested nightly rate" here — that would touch the residential-comps
// data plane (a standing hard-stop) and require a vendor. This engine never
// looks outside the operator's own book.
//
// CANCELLED STAYS DO NOT COUNT
// ────────────────────────────
// Only reservations that are NOT cancelled and that overlap the window
// contribute; a cancelled booking earned no night and no revenue. Nights and
// revenue are PRO-RATED to the window: a stay straddling the window boundary
// contributes only the nights inside it, and the same fraction of its room
// revenue — so a booking is never double-counted across two windows nor credited
// whole to a window it only partly falls in.
// ============================================================================

/** cents → a whole-cent integer, tolerant of a numeric-string column read. */
function centsOf(value: number | null | undefined): number {
  if (value == null) return 0;
  return Math.round(Number(value));
}

/** Midnight-UTC epoch ms for a YYYY-MM-DD date, or null when blank/malformed. */
function dayMs(isoDate: string | null | undefined): number | null {
  if (typeof isoDate !== "string" || isoDate.length < 10) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

const DAY = 86_400_000;

/** Whole nights between two YYYY-MM-DD dates (end exclusive), or null if unparseable. */
function nightsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const a = dayMs(start);
  const b = dayMs(end);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY);
}

/**
 * One reservation, as much of it as the metrics need. `status` gates the row
 * (a 'cancelled' stay is dropped); the money columns are the operator's OWN
 * recorded figures (nullable — an unrecorded amount contributes 0, never a
 * fabricated number). Room revenue is gross booking net of the pass-through
 * cleaning fee and taxes.
 */
export interface StrReservationInput {
  checkIn: string;
  checkOut: string;
  status: string;
  grossBookingCents: number | null;
  cleaningFeeCents: number | null;
  taxesCents: number | null;
}

export interface StrMetricsInput {
  reservations: StrReservationInput[];
  /** Window start, YYYY-MM-DD, inclusive. */
  windowStart: string;
  /** Window end, YYYY-MM-DD, EXCLUSIVE — the window is [windowStart, windowEnd). */
  windowEnd: string;
  /**
   * The denominator of occupancy and RevPAR: how many unit-nights the operator
   * COULD have sold over the window (rentable units × window nights). Null or a
   * non-positive value means it is not derivable — the operator has no rentable
   * units on record, or the window is empty — and occupancy + RevPAR REFUSE
   * (return null) rather than divide by an invented denominator.
   */
  availableUnitNights: number | null;
}

export interface StrMetrics {
  /** Nights actually booked in the window (non-cancelled, pro-rated to the window). */
  bookedNights: number;
  /** The occupancy denominator — availableUnitNights when derivable, else null. */
  availableNights: number | null;
  /** bookedNights / availableNights, in basis points (10000 = 100%). Null when availableNights is null. */
  occupancyBps: number | null;
  /** Room revenue in the window (gross booking − cleaning − taxes), pro-rated, in cents. */
  roomRevenueCents: number;
  /** roomRevenueCents / bookedNights — the average daily rate. NULL when bookedNights is 0. */
  adrCents: number | null;
  /** roomRevenueCents / availableNights — revenue per available night. Null when availableNights is null. */
  revparCents: number | null;
}

/**
 * Compute the STR performance metrics for a window of reservations.
 *
 * Counts ONLY non-cancelled stays that overlap [windowStart, windowEnd), and
 * pro-rates each stay's nights AND its room revenue to the overlap — so a
 * booking straddling the boundary contributes only its in-window nights and the
 * same fraction of its room revenue. ADR refuses (null) when nothing was booked;
 * occupancy and RevPAR refuse (null) when availableUnitNights is not derivable.
 */
export function computeStrMetrics(input: StrMetricsInput): StrMetrics {
  const winStart = dayMs(input.windowStart);
  const winEnd = dayMs(input.windowEnd);

  let bookedNights = 0;
  let roomRevenueCents = 0;

  if (winStart != null && winEnd != null && winEnd > winStart) {
    for (const r of input.reservations) {
      if (r.status === "cancelled") continue;
      const inMs = dayMs(r.checkIn);
      const outMs = dayMs(r.checkOut);
      if (inMs == null || outMs == null || outMs <= inMs) continue;

      const totalNights = Math.round((outMs - inMs) / DAY);
      if (totalNights <= 0) continue;

      // Overlap of [checkIn, checkOut) with [windowStart, windowEnd).
      const overlapStart = Math.max(inMs, winStart);
      const overlapEnd = Math.min(outMs, winEnd);
      const overlapNights = Math.max(0, Math.round((overlapEnd - overlapStart) / DAY));
      if (overlapNights === 0) continue;

      bookedNights += overlapNights;

      // Room revenue = gross booking less the pass-through cleaning fee + taxes,
      // pro-rated by the fraction of the stay that falls inside the window.
      const roomRevenueFull = centsOf(r.grossBookingCents) - centsOf(r.cleaningFeeCents) - centsOf(r.taxesCents);
      roomRevenueCents += Math.round(roomRevenueFull * (overlapNights / totalNights));
    }
  }

  // availableNights refuses when the denominator is not derivable.
  const availableNights =
    input.availableUnitNights != null && input.availableUnitNights > 0
      ? Math.round(input.availableUnitNights)
      : null;

  const occupancyBps =
    availableNights != null ? Math.round((bookedNights / availableNights) * 10000) : null;

  // ADR refuses when nothing was booked — no average rate across zero nights.
  const adrCents = bookedNights > 0 ? Math.round(roomRevenueCents / bookedNights) : null;

  const revparCents =
    availableNights != null ? Math.round(roomRevenueCents / availableNights) : null;

  return {
    bookedNights,
    availableNights,
    occupancyBps,
    roomRevenueCents,
    adrCents,
    revparCents,
  };
}

/**
 * The nights in a [windowStart, windowEnd) window — the multiplier the route
 * uses to turn a rentable-unit COUNT into availableUnitNights. Null when the
 * window is empty or malformed, so the route refuses occupancy rather than
 * fabricate a denominator. Kept here so the window arithmetic lives with the
 * engine it feeds.
 */
export function windowNights(windowStart: string, windowEnd: string): number | null {
  const n = nightsBetween(windowStart, windowEnd);
  return n != null && n > 0 ? n : null;
}

// ============================================================================
// OPERATOR-SET NIGHTLY PRICING — NOT market pricing.
// ----------------------------------------------------------------------------
// The ONLY nightly rate this engine knows is the operator's OWN set rate for a
// stay (reservations.nightly_rate_cents), a figure they recorded — never a
// market/dynamic/"suggested" rate. A suggested rate would touch the
// residential-comps data plane (a standing hard-stop) and require a vendor;
// there is none here. From the operator's own rate we compute the expected
// revenue for the stay and its variance against the gross booking they actually
// recorded — a self-consistency check on their own book, nothing external.
//
// REFUSE, NEVER FABRICATE: when the operator has NOT set a nightly rate, the
// expectation is UNKNOWN — expectedRevenue and variance are null, never a
// back-filled market rate. This is the null-when-unset refusal the pricing test
// pins.
// ============================================================================

export interface NightlyRateInput {
  /** The operator's OWN set nightly rate for this stay, in cents. Null when unset. */
  nightlyRateCents: number | null;
  /** The stay's nights (derived from check-in/out by the caller). Null when not derivable. */
  nights: number | null;
  /** The gross booking the operator actually recorded, in cents. Null when unrecorded. */
  grossBookingCents: number | null;
}

export interface NightlyRateExpectation {
  nightlyRateCents: number | null;
  nights: number | null;
  /**
   * nightlyRateCents × nights — the revenue the operator's OWN set rate implies.
   * NULL when the rate is unset or the nights are not derivable (never a market
   * rate substituted in). This is the null-when-unset refusal.
   */
  expectedRevenueCents: number | null;
  /**
   * grossBookingCents − expectedRevenueCents (positive = booked above the set
   * rate, negative = below). NULL when either side is unknown — no variance is
   * computed against a fabricated expectation.
   */
  varianceCents: number | null;
}

/**
 * Turn the operator's OWN set nightly rate into an expected stay revenue and its
 * variance against the recorded gross booking. Everything refuses (null) rather
 * than substitute a market/suggested rate: no nightly rate set → no expectation,
 * no variance. This is the operator's book checked against itself, never a
 * comps-derived number.
 */
export function computeNightlyRateExpectation(input: NightlyRateInput): NightlyRateExpectation {
  const nightlyRateCents =
    input.nightlyRateCents != null ? Math.round(Number(input.nightlyRateCents)) : null;
  const nights = input.nights != null && input.nights > 0 ? Math.round(input.nights) : null;
  const grossBookingCents =
    input.grossBookingCents != null ? Math.round(Number(input.grossBookingCents)) : null;

  // Expected revenue needs BOTH the operator's own rate and a derivable nights.
  const expectedRevenueCents =
    nightlyRateCents != null && nights != null ? nightlyRateCents * nights : null;

  // Variance needs the expectation AND a recorded gross — else refuse.
  const varianceCents =
    expectedRevenueCents != null && grossBookingCents != null
      ? grossBookingCents - expectedRevenueCents
      : null;

  return { nightlyRateCents, nights, expectedRevenueCents, varianceCents };
}
