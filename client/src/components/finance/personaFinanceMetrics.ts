import type { Note } from "@shared/schema";

/**
 * personaFinanceMetrics — pure, client-side derivations of the four
 * note-investor personas' real economics from the note rows the Finance
 * page already loads via `useNotes()` (the full `notes.$inferSelect`
 * shape, so every column below is present on each row).
 *
 * HONESTY CONTRACT (money surface): every figure here is computed from a
 * real stored column. Where a persona's textbook metric needs an input
 * AcreOS does not store (a note's acquisition cost basis → true IRR; a
 * cost-of-funds rate → origination spread), the function returns a
 * `null` for that field and the hero renders an explicit "not tracked
 * yet" state. We never substitute a plausible-looking number.
 */

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** YYYY-MM key in local time for a date-ish value, or null. */
function monthKey(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(value as string | number | Date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The trailing 12 month-keys ending with the current month. */
export function last12MonthKeys(now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

const ACTIVE = (n: Note) => n.status === "active";

// ── note_originator ─────────────────────────────────────────────────────
// The lender building paper. Economics are about what they DEPLOYED into
// seller-financed notes, not what's left outstanding.
export interface OriginatorMetrics {
  notesOriginated: number; // count of all notes ever written
  capitalDeployed: number; // Σ originalPrincipal (real)
  wtdAvgRate: number | null; // principal-weighted interestRate (real)
  wtdAvgTermMonths: number | null; // principal-weighted termMonths (real)
  /** Σ originalPrincipal by createdAt month, trailing 12 months. */
  volumeByMonth: { month: string; amount: number }[];
  hasOriginationDates: boolean; // false → volume timeline is an honest empty
  /**
   * Spread vs cost of funds is intentionally null: AcreOS stores no
   * cost-of-funds rate, so origination spread cannot be computed
   * honestly. The hero renders a "not tracked yet" tile instead.
   */
  spreadVsCostOfFunds: null;
}

export function computeOriginatorMetrics(notes: Note[], now = new Date()): OriginatorMetrics {
  const capitalDeployed = notes.reduce((s, n) => s + num(n.originalPrincipal), 0);
  const weightSum = notes.reduce((s, n) => s + num(n.originalPrincipal), 0);
  const wtdAvgRate =
    weightSum > 0
      ? notes.reduce((s, n) => s + num(n.interestRate) * num(n.originalPrincipal), 0) / weightSum
      : null;
  const wtdAvgTermMonths =
    weightSum > 0
      ? notes.reduce((s, n) => s + num(n.termMonths) * num(n.originalPrincipal), 0) / weightSum
      : null;

  const keys = last12MonthKeys(now);
  const byMonth = new Map<string, number>(keys.map((k) => [k, 0]));
  let anyDated = false;
  notes.forEach((n) => {
    const k = monthKey(n.createdAt);
    if (k && byMonth.has(k)) {
      byMonth.set(k, (byMonth.get(k) || 0) + num(n.originalPrincipal));
      anyDated = true;
    }
  });

  return {
    notesOriginated: notes.length,
    capitalDeployed,
    wtdAvgRate,
    wtdAvgTermMonths,
    volumeByMonth: keys.map((month) => ({ month, amount: byMonth.get(month) || 0 })),
    hasOriginationDates: anyDated,
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
  notes: Note[],
  collectedTrailing12: number,
  delinquencyRate: number | null,
): ServicerMetrics {
  const active = notes.filter(ACTIVE);
  const monthlyFeeIncome = active.reduce((s, n) => s + num(n.serviceFee), 0);
  const escrowNotes = notes.filter((n) => n.taxEscrowEnabled);
  return {
    servicedBookCount: active.length,
    servicedUpb: active.reduce((s, n) => s + num(n.currentBalance), 0),
    monthlyFeeIncome,
    hasFeeSchedule: active.some((n) => num(n.serviceFee) > 0),
    escrowUnderManagement: escrowNotes.reduce((s, n) => s + num(n.taxEscrowBalance), 0),
    escrowAccounts: escrowNotes.length,
    collectedTrailing12,
    delinquencyRate: active.length > 0 ? delinquencyRate : null,
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
  notes: Note[],
  delinquentCount: number,
): InvestorMetrics {
  const active = notes.filter(ACTIVE);
  const principalOutstanding = active.reduce((s, n) => s + num(n.currentBalance), 0);
  const bookYield =
    principalOutstanding > 0
      ? active.reduce((s, n) => s + num(n.interestRate) * num(n.currentBalance), 0) /
        principalOutstanding
      : null;
  return {
    principalOutstanding,
    performingCount: Math.max(active.length - delinquentCount, 0),
    delinquentCount,
    activeCount: active.length,
    bookYield,
    forecastMonthlyInflow: active.reduce((s, n) => s + num(n.monthlyPayment), 0),
    irr: null,
  };
}
