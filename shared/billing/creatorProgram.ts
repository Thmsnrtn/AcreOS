/**
 * Creator revenue share — the rules (W3 acquisition engine). Browser-safe.
 *
 * A creator (a YouTuber, a podcaster, a land-investing educator) shares a link
 * with their code (`?ref=CODE`). A signup that arrives with it is attributed to
 * them. When that customer's organization PAYS AcreOS an invoice, the creator
 * earns a commission on what was actually collected — and only then.
 *
 * This is AcreOS paying its OWN money to a creator for bringing a customer.
 * It is not customer money and never touches a customer's processor. Nothing
 * here moves money: a payout is approved by the founder and paid by the
 * founder outside AcreOS; AcreOS records the approval and the founder's
 * payment reference.
 *
 * THE RATE IS A FOUNDER DECISION AND SHIPS UNSET. While `commissionBps` is
 * null, conversions are recorded with status "rate_unset", nothing is owed or
 * computed, and payouts are refused. Setting it is a founder-only code change
 * (pricing-class hard stop), recorded in docs/company/founder-decisions-*.md.
 */

export const CREATOR_PROGRAM: {
  /** Commission in basis points of the amount paid (2,000 = 20%). null = not decided. */
  commissionBps: number | null;
  /** When the rate was decided, and where the decision is recorded. */
  decidedOn: string | null;
  decisionRecord: string | null;
} = {
  commissionBps: null,
  decidedOn: null,
  decisionRecord: null,
};

export const CREATOR_RATE_UNSET_REFUSAL =
  "The creator commission rate is not set — a founder decision. Paid conversions are recorded, but no amount is owed or computed until the rate is set.";

const CREATOR_CODE_RE = /^[A-Z0-9_-]{4,16}$/;

export function normalizeCreatorCode(raw: string): string | null {
  const c = String(raw ?? "").trim().toUpperCase();
  return CREATOR_CODE_RE.test(c) ? c : null;
}

/** floor(amount × bps / 10,000); null when no rate is set. */
function commissionFor(amountPaidCents: number, bps: number | null): number | null {
  if (bps === null) return null;
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`creator commission rate out of range: ${bps}`);
  return Math.floor((Math.max(0, amountPaidCents) * bps) / 10_000);
}

export type CreatorConversionStatus = "rate_unset" | "owed" | "approved" | "paid" | "void";

export type ConversionDecision =
  | { record: true; status: "rate_unset" | "owed"; commissionBps: number | null; commissionCents: number | null }
  | { record: false; reason: "nothing_paid" };

/** What to record for one paid invoice of an attributed customer. */
export function conversionDecision(invoice: { amountPaidCents: number }, bps: number | null): ConversionDecision {
  if (!(invoice.amountPaidCents > 0)) return { record: false, reason: "nothing_paid" };
  if (bps === null) return { record: true, status: "rate_unset", commissionBps: null, commissionCents: null };
  return { record: true, status: "owed", commissionBps: bps, commissionCents: commissionFor(invoice.amountPaidCents, bps) };
}

export interface CreatorLedgerRow {
  paidConversions: number;
  paidRevenueCents: number;
  /** Sum still owed; null while the rate is unset. */
  owedCents: number | null;
  approvedCents: number;
  paidOutCents: number;
  /** Conversions recorded before a rate existed. */
  awaitingRate: number;
  refusal: string | null;
}

/** Aggregate one creator's conversions. Void conversions count for nothing. */
export function creatorLedgerRow(
  rows: ReadonlyArray<{ status: string; amountPaidCents: number; commissionCents: number | null }>,
  bps: number | null,
): CreatorLedgerRow {
  const live = rows.filter((r) => r.status !== "void");
  const sum = (status: string) => live.filter((r) => r.status === status).reduce((s, r) => s + (r.commissionCents ?? 0), 0);
  return {
    paidConversions: live.length,
    paidRevenueCents: live.reduce((s, r) => s + r.amountPaidCents, 0),
    owedCents: bps === null ? null : sum("owed"),
    approvedCents: sum("approved"),
    paidOutCents: sum("paid"),
    awaitingRate: live.filter((r) => r.status === "rate_unset").length,
    refusal: bps === null ? CREATOR_RATE_UNSET_REFUSAL : null,
  };
}

/**
 * The attribution rule, pure: a signup belongs to a creator when its
 * first-touch ref code (users.acquisition_utm.ref, written once at signup) is
 * that creator's code, the creator is active, and the creator existed when the
 * person signed up (a code invented later cannot claim an earlier signup).
 */
export function creatorForSignupCode<C extends { id: number; code: string; status: string; createdAt: Date | string | null }>(
  acquisitionRef: unknown,
  signedUpAt: Date | null,
  all: ReadonlyArray<C>,
): { id: number; code: string } | null {
  if (typeof acquisitionRef !== "string") return null;
  const code = normalizeCreatorCode(acquisitionRef);
  if (!code) return null;
  const c = all.find((x) => x.code === code);
  if (!c || c.status !== "active") return null;
  if (signedUpAt && c.createdAt && new Date(c.createdAt).getTime() > new Date(signedUpAt).getTime()) return null;
  return { id: c.id, code: c.code };
}
