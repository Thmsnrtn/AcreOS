/**
 * The §5A guarantee-eligibility rule — a PURE function (design 2026-11 §3.1).
 *
 * Published terms: a full refund of the initial paid subscription's FIRST
 * charge, requested within 30 days of that charge, no questions asked.
 * AMOUNT IS NOT A PREDICATE: $49 and $1,990 are the same question.
 *
 * No I/O. Stripe and database facts are gathered by the caller and passed in,
 * so every predicate is unit-testable on its own.
 *
 *   E1  the org has a Stripe customer
 *   E2  the target charge is the org's FIRST subscription charge
 *   E3  the request is within 30 days of that charge
 *   E4  (fresh at execution) the charge succeeded, amount_refunded = 0, no dispute
 *   E5  the org was not terminated for abuse/fraud/material breach
 *   E6  no guarantee refund already consumed; no other request for the same
 *       charge is processed / processing / uncertain
 *
 * E5 IS NOT AUTOMATED. No abuse-termination flag exists on the org; the input
 * verdict defaults to "unattested", which fails E5 and routes to brake B4.
 * "no_recorded_exclusion" states only that nothing recorded excludes the org —
 * it is not a determination, and the verdict detail says so.
 */
import { GUARANTEE_WINDOW_DAYS } from "./refundConfig";

export type RefundBrakeCode = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7";
export type PredicateId = "E1" | "E2" | "E3" | "E4" | "E5" | "E6";
export type PredicateVerdict = "pass" | "fail";

/** What is known about §5A's abuse/fraud/material-breach exclusion. */
export type AbuseExclusionVerdict =
  | "attested_clear" // a human looked at the account and cleared it (queue approval)
  | "no_recorded_exclusion" // nothing recorded excludes the org; NOT a determination
  | "excluded" // a human or a record says the exclusion applies
  | "unattested"; // default — nobody has looked

export interface ChargeFacts {
  /** Stripe charge.status ("succeeded" | "pending" | "failed"). */
  status: string | null | undefined;
  /** Stripe charge.amount_refunded, cents. */
  amountRefundedCents: number | null | undefined;
  /** Stripe charge.refunded. */
  refunded?: boolean | null;
  /** Stripe charge.disputed — a dispute exists on the charge (open or not). */
  disputed: boolean | null | undefined;
}

export interface GuaranteeEligibilityInput {
  /** E1 */
  hasStripeCustomer: boolean;
  /** E2 — true only when the target IS the resolved first subscription charge. */
  targetIsFirstSubscriptionCharge: boolean;
  /** E3 */
  chargeCreatedAtMs: number | null | undefined;
  nowMs: number;
  /** E4 — null when the charge could not be read: E4 fails (never assumed). */
  charge: ChargeFacts | null;
  /** E5 — defaults to "unattested". */
  abuseExclusion?: AbuseExclusionVerdict;
  /** E6 — the org already has a processed refund (a guarantee refund consumed). */
  guaranteeAlreadyConsumed: boolean;
  /** E6 — another request for the same charge is processed/processing/uncertain. */
  sameChargeInFlightOrProcessed: boolean;
}

export interface PredicateResult {
  verdict: PredicateVerdict;
  detail: string;
}

export interface GuaranteeEligibility {
  eligible: boolean;
  verdicts: Record<PredicateId, PredicateResult>;
  failed: PredicateId[];
  /** The brake for the first-priority failed predicate; null when eligible. */
  brake: RefundBrakeCode | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const pass = (detail: string): PredicateResult => ({ verdict: "pass", detail });
const fail = (detail: string): PredicateResult => ({ verdict: "fail", detail });

/**
 * Which brake a failed set lands in. Priority: a charge that is disputed or
 * partly refunded is the most dangerous to touch (B2, B3), then a repeat (B1),
 * then outside-the-guarantee (B5), then the unattested exclusion (B4).
 * Every failed predicate is still recorded in `failed`.
 */
export function brakeForFailures(failed: ReadonlySet<PredicateId>, charge: ChargeFacts | null): RefundBrakeCode | null {
  if (failed.size === 0) return null;
  if (failed.has("E4")) {
    if (charge?.disputed === true) return "B2";
    if ((charge?.amountRefundedCents ?? 0) > 0 || charge?.refunded === true) return "B3";
    // Charge unreadable or not succeeded: a human call — case-by-case queue.
    return "B5";
  }
  if (failed.has("E6")) return "B1";
  if (failed.has("E2") || failed.has("E3")) return "B5";
  if (failed.has("E5")) return "B4";
  // E1 alone: no billing account — nothing to refund; the intake refuses before this matters.
  return "B5";
}

/**
 * E4 on its own — the executor re-reads the charge fresh and asks exactly this
 * question again, so intake and execution can never disagree on its meaning.
 */
export function evaluateChargeRefundable(c: ChargeFacts | null): PredicateResult {
  if (!c) return fail("the charge could not be read from Stripe");
  if (c.status !== "succeeded") return fail(`charge status is ${String(c.status)}, not succeeded`);
  if (c.disputed === true) return fail("a dispute exists on the charge — refunding into a dispute can double-pay");
  if ((c.amountRefundedCents ?? 0) > 0 || c.refunded === true) return fail(`the charge already has ${c.amountRefundedCents ?? 0} cents refunded`);
  return pass("charge succeeded, nothing refunded, no dispute");
}

export function evaluateGuaranteeEligibility(input: GuaranteeEligibilityInput): GuaranteeEligibility {
  const abuse: AbuseExclusionVerdict = input.abuseExclusion ?? "unattested";
  const verdicts = {} as Record<PredicateId, PredicateResult>;

  verdicts.E1 = input.hasStripeCustomer ? pass("org has a Stripe customer") : fail("no Stripe customer / billing account");

  verdicts.E2 = input.targetIsFirstSubscriptionCharge
    ? pass("target is the org's first subscription charge")
    : fail("target is not the org's first subscription charge (a renewal is case-by-case under §5A)");

  if (typeof input.chargeCreatedAtMs !== "number" || !Number.isFinite(input.chargeCreatedAtMs)) {
    verdicts.E3 = fail("the first charge's date is unknown");
  } else {
    const ageDays = (input.nowMs - input.chargeCreatedAtMs) / DAY_MS;
    verdicts.E3 =
      ageDays <= GUARANTEE_WINDOW_DAYS
        ? pass(`requested ${ageDays.toFixed(1)} days after the first charge (window ${GUARANTEE_WINDOW_DAYS})`)
        : fail(`requested ${ageDays.toFixed(1)} days after the first charge (window ${GUARANTEE_WINDOW_DAYS}) — case-by-case under §5A`);
  }

  const c = input.charge;
  verdicts.E4 = evaluateChargeRefundable(c);

  if (abuse === "attested_clear") verdicts.E5 = pass("a human attested the account clear of the §5A abuse exclusion");
  else if (abuse === "no_recorded_exclusion")
    verdicts.E5 = pass("nothing recorded excludes the org — NOT an automated determination: no abuse-termination flag exists, the founder queue is where a human can still apply the exclusion");
  else if (abuse === "excluded") verdicts.E5 = fail("the §5A abuse/fraud/material-breach exclusion applies");
  else verdicts.E5 = fail("abuse exclusion unattested — a human must confirm or clear it");

  if (input.guaranteeAlreadyConsumed) verdicts.E6 = fail("the org has already had a refund processed");
  else if (input.sameChargeInFlightOrProcessed) verdicts.E6 = fail("another request for this charge is processed, processing or uncertain");
  else verdicts.E6 = pass("no refund consumed, none in flight for this charge");

  const order: PredicateId[] = ["E1", "E2", "E3", "E4", "E5", "E6"];
  const failed = order.filter((id) => verdicts[id].verdict === "fail");
  const eligible = failed.length === 0;
  return { eligible, verdicts, failed, brake: eligible ? null : brakeForFailures(new Set(failed), c) };
}
