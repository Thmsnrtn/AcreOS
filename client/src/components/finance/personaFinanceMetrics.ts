import type { NoteBookFigures } from "@/hooks/use-note-book-figures";

/**
 * personaFinanceMetrics — pure projections of the note book's whole-book
 * figures (GET /api/notes/book-figures, SQL over every note of the org) into
 * the three note personas' hero metrics.
 *
 * These were sums over the Finance page's `useNotes()` rows — GET /api/notes,
 * the capped newest-5,000 table payload — so past 5,000 notes the hero and
 * the page's own headline cards disagreed (W10.2b audit). Each figure is now
 * the same arithmetic, done server-side over the population the old sum used
 * (see server/storage/noteBookFigures.ts).
 *
 * HONESTY CONTRACT (money surface): every figure here is computed from a
 * real stored column. Where a persona's textbook metric needs an input
 * AcreOS does not store (a note's acquisition cost basis → true IRR; a
 * cost-of-funds rate → origination spread), the function returns a
 * `null` for that field and the hero renders an explicit "not tracked
 * yet" state. We never substitute a plausible-looking number.
 */

// ── note_originator ─────────────────────────────────────────────────────
// The lender building paper. Economics are about what they DEPLOYED into
// seller-financed notes, not what's left outstanding.
export interface OriginatorMetrics {
  notesOriginated: number; // count of all notes ever written
  capitalDeployed: number; // Σ originalPrincipal (real)
  wtdAvgRate: number | null; // principal-weighted interestRate (real)
  wtdAvgTermMonths: number | null; // principal-weighted termMonths (real)
  /** Σ originalPrincipal by createdAt month, trailing 12 months (the viewer's local months). */
  volumeByMonth: { month: string; amount: number }[];
  hasOriginationDates: boolean; // false → volume timeline is an honest empty
  /**
   * Spread vs cost of funds is intentionally null: AcreOS stores no
   * cost-of-funds rate, so origination spread cannot be computed
   * honestly. The hero renders a "not tracked yet" tile instead.
   */
  spreadVsCostOfFunds: null;
}

export function computeOriginatorMetrics(f: NoteBookFigures): OriginatorMetrics {
  // Every note, any status — "ever written", not "still outstanding".
  return {
    notesOriginated: f.notesWritten,
    capitalDeployed: f.capitalDeployed,
    wtdAvgRate: f.principalWeightedRate,
    wtdAvgTermMonths: f.principalWeightedTermMonths,
    volumeByMonth: f.originationVolume,
    hasOriginationDates: f.originationsInWindow > 0,
    spreadVsCostOfFunds: null,
  };
}

// ── note_servicer ───────────────────────────────────────────────────────
// A SERVICE business — they do NOT own the notes. Their P&L is fee income
// + escrow under management + the size/health of the book they service.
export interface ServicerMetrics {
  servicedBookCount: number; // active notes serviced (real)
  servicedUpb: number; // Σ currentBalance of active serviced notes (real)
  monthlyFeeIncome: number; // Σ serviceFee on active notes (real recurring)
  hasFeeSchedule: boolean; // false → fee income is honest-empty
  escrowUnderManagement: number; // Σ taxEscrowBalance where escrow enabled (real)
  escrowAccounts: number; // count of notes with escrow enabled (real)
  collectedTrailing12: number; // Σ payments routed through the book, last 12 mo (real)
  delinquencyRate: number | null; // from summary (real) — null if no active book
}

export function computeServicerMetrics(
  f: NoteBookFigures,
  collectedTrailing12: number,
  delinquencyRate: number | null,
): ServicerMetrics {
  return {
    servicedBookCount: f.activeCount,
    servicedUpb: f.totalOutstanding,
    monthlyFeeIncome: f.totalServiceFees,
    hasFeeSchedule: f.feeScheduledCount > 0,
    // Escrow is every escrow-enabled note, whatever its status.
    escrowUnderManagement: f.escrowUnderManagement,
    escrowAccounts: f.escrowAccounts,
    collectedTrailing12,
    delinquencyRate: f.activeCount > 0 ? delinquencyRate : null,
  };
}

// ── note_investor ────────────────────────────────────────────────────────
// Owns secondary-market paper. Economics are about the portfolio they HOLD.
export interface InvestorMetrics {
  principalOutstanding: number; // Σ currentBalance active (real UPB)
  performingCount: number; // active − delinquent (real)
  delinquentCount: number; // real
  activeCount: number; // real
  bookYield: number | null; // principal-weighted interestRate (real coupon yield)
  forecastMonthlyInflow: number; // Σ monthlyPayment active (real forward cash flow)
  /**
   * True IRR needs each note's acquisition cost basis (what the investor
   * paid for the paper on the secondary market), which AcreOS does not
   * store. Null → hero shows "not tracked yet" rather than passing the
   * coupon off as a yield-to-cost.
   */
  irr: null;
}

export function computeInvestorMetrics(
  f: NoteBookFigures,
  delinquentCount: number,
): InvestorMetrics {
  return {
    principalOutstanding: f.totalOutstanding,
    performingCount: Math.max(f.activeCount - delinquentCount, 0),
    delinquentCount,
    activeCount: f.activeCount,
    bookYield: f.bookYield,
    forecastMonthlyInflow: f.totalMonthly,
    irr: null,
  };
}
