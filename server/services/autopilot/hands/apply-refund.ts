/**
 * Founder Autopilot — apply_refund hand (Hands roadmap P2.2).
 *
 * Issuing a refund moves real money OUT and cannot be un-done — irreversible
 * class. Beyond the standard witnessed-send tap (requiresApproval), THIS HAND
 * enforces the refund rules itself, at execution, whoever witnessed it (a
 * founder tap or a WitnessGrant) and whoever drafted it (the Support worker or
 * any other dispatch):
 *
 *   • a HARD $50 ceiling, mirroring the platform's auto-approve threshold;
 *   • ORG-OWNED: `organization_id` is required and `charge_id` must be a
 *     purchase that org made (a credit_transactions `purchase` row carrying
 *     that payment id). Anything else — another org's payment, a charge with
 *     no recorded purchase — is refused; larger or unusual refunds go through
 *     the manual refund flow in routes-billing, never the autopilot;
 *   • ≤ COST: never more than the purchase cost;
 *   • ONCE: never a second refund of the same payment — counting refunds the
 *     autopilot made (its `purchase_refund` credit_transactions row IS the
 *     claim: written under an advisory lock and UNIQUE per payment by a
 *     partial index, so two concurrent executions cannot both pass), refunds
 *     recorded outside the autopilot (`refund` rows for that payment), and
 *     refunds made on the Stripe side (the charge's amount_refunded, read
 *     before refunding);
 *   • CREDITS: a credit-pack refund takes the purchased credits back in the
 *     same transaction as the claim. RULE CHOSEN (the safer of the two): when
 *     the org no longer holds the credits being refunded — it spent them — the
 *     refund is REFUSED rather than clawed back partially or left as free
 *     credit. A refund never leaves an org holding credits it was repaid for.
 *
 * Any failure after the claim (Stripe unreachable, Stripe already refunded,
 * the refund call failing) releases the claim and returns the credits in one
 * compensating transaction, so a failed refund can be retried and never
 * leaves the org short.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { registerHand } from "./registry";
import { handError, type HandContext, type HandResult } from "./types";
import { creditTransactions, organizations } from "@shared/schema";
import { db, withTransaction } from "../../../db";
import { logger } from "../../../utils/logger";
import { clock } from "../../../utils/clock";

const NAME = "apply_refund";
/** Hard ceiling (cents). Matches the platform auto-approve threshold. */
export const REFUND_CEILING_CENTS = 5000;
/** credit_transactions types that record money already returned for a payment. */
const PRIOR_REFUND_TYPES = ["refund", "purchase_refund"];

type Refusal = { ok: false; reason: string };
type Eligible = { ok: true; chargeId: string; amountCents: number; organizationId: number; purchaseCents: number };

/**
 * Read-only eligibility of a refund against the database: the shape, the
 * ceiling, org ownership, ≤ cost, and every refund already recorded for the
 * payment. The hand runs it at execution (inside the claim lock it is run
 * again); delegationRules runs it before a grant releases a frozen refund.
 */
export async function refundEligibility(input: Record<string, unknown>): Promise<Refusal | Eligible> {
  const chargeId = String(input.charge_id ?? "").trim();
  const amountCents = typeof input.amount_cents === "number" ? Math.floor(input.amount_cents) : NaN;
  const organizationId = typeof input.organization_id === "number" ? Math.floor(input.organization_id) : NaN;
  if (!chargeId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "apply_refund: 'charge_id' and a positive 'amount_cents' are required." };
  }
  if (amountCents > REFUND_CEILING_CENTS) {
    return {
      ok: false,
      reason: `apply_refund: $${(amountCents / 100).toFixed(2)} exceeds the $${(REFUND_CEILING_CENTS / 100).toFixed(2)} autopilot ceiling. Larger refunds must use the manual refund flow. Refusing.`,
    };
  }
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    return { ok: false, reason: "apply_refund: 'organization_id' is required — a refund is only ever of a purchase that org made. Refusing." };
  }
  const [purchase] = await db
    .select({ amountCents: creditTransactions.amountCents })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.organizationId, organizationId),
        eq(creditTransactions.type, "purchase"),
        eq(creditTransactions.stripePaymentIntentId, chargeId),
      ),
    )
    .limit(1);
  if (!purchase) {
    return { ok: false, reason: `apply_refund: ${chargeId} is not a purchase organization #${organizationId} made. Refusing.` };
  }
  if (amountCents > purchase.amountCents) {
    return {
      ok: false,
      reason: `apply_refund: $${(amountCents / 100).toFixed(2)} is more than the purchase cost ($${(purchase.amountCents / 100).toFixed(2)}). Refusing.`,
    };
  }
  const [recorded] = await db
    .select({ id: creditTransactions.id })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.organizationId, organizationId), eq(creditTransactions.stripePaymentIntentId, chargeId), inArray(creditTransactions.type, PRIOR_REFUND_TYPES)))
    .limit(1);
  if (recorded) return { ok: false, reason: `apply_refund: ${chargeId} has already been refunded (or a refund of it is in flight) — never twice. Refusing.` };
  return { ok: true, chargeId, amountCents, organizationId, purchaseCents: purchase.amountCents };
}

class RefundRefused extends Error {}

/** A claim still "claimed" this long after it was written was interrupted. */
const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;
const PLATFORM_REFUNDS = "Decisions door: refunds the autopilot could not confirm, across every org, for the founder to check";

/**
 * Refunds whose outcome is uncertain — listed on the Decisions door so the
 * founder sees each one even if the ask about it failed:
 *   • state "uncertain": the refund call was made but did not return, or its
 *     record could not be written;
 *   • state "claimed" for more than 10 minutes: the process stopped between
 *     the claim and any outcome (the read IS the sweep — nothing has to run
 *     for an interrupted refund to surface).
 * The claim row stays either way, so the payment is never refunded twice.
 */
export async function listUncertainRefunds(limit = 50, now = clock.nowMs()): Promise<Array<{ id: number; organizationId: number; chargeId: string | null; createdAt: Date | null; why: string | null }>> {
  const { unscopedForPlatformOps } = await import("../../../utils/orgScopedDb");
  const cutoff = new Date(now - INTERRUPTED_AFTER_MS);
  const rows = await unscopedForPlatformOps(PLATFORM_REFUNDS)
    .select({
      id: creditTransactions.id,
      organizationId: creditTransactions.organizationId,
      chargeId: creditTransactions.stripePaymentIntentId,
      createdAt: creditTransactions.createdAt,
      metadata: creditTransactions.metadata,
    })
    .from(creditTransactions)
    .where(
      and(
        eq(creditTransactions.type, "purchase_refund"),
        sql`(${creditTransactions.metadata}->>'state' = 'uncertain' or (${creditTransactions.metadata}->>'state' = 'claimed' and ${creditTransactions.createdAt} < ${cutoff}))`,
      ),
    )
    .limit(limit);
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as { state?: string; uncertainBecause?: string };
    return {
      id: r.id,
      organizationId: r.organizationId,
      chargeId: r.chargeId,
      createdAt: r.createdAt,
      why: m.state === "claimed" ? "interrupted: claimed but no outcome was recorded" : (m.uncertainBecause ?? null),
    };
  });
}

/**
 * The founder has checked an uncertain refund on Stripe: record that he
 * resolved it (who, when, what he found). The claim row STAYS — the payment
 * is still never refunded again by the autopilot. Founder-only (the route).
 */
export async function resolveUncertainRefund(organizationId: number, id: number, by: string, note: string): Promise<boolean> {
  const { unscopedForPlatformOps } = await import("../../../utils/orgScopedDb");
  const db2 = unscopedForPlatformOps(PLATFORM_REFUNDS);
  const [row] = await db2
    .select({ metadata: creditTransactions.metadata })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.organizationId, organizationId), eq(creditTransactions.id, id), eq(creditTransactions.type, "purchase_refund")))
    .limit(1);
  const state = (row?.metadata as { state?: string } | null)?.state;
  if (!row || (state !== "uncertain" && state !== "claimed")) return false;
  const updated = await db2
    .update(creditTransactions)
    .set({ metadata: { ...(row.metadata as Record<string, unknown>), state: "resolved_by_founder", resolvedBy: by, resolvedAt: clock.now().toISOString(), resolution: note.slice(0, 1000) } })
    .where(and(eq(creditTransactions.organizationId, organizationId), eq(creditTransactions.id, id), eq(creditTransactions.type, "purchase_refund")))
    .returning({ id: creditTransactions.id });
  if (updated.length > 0) logger.warn(`[autopilot/hands] uncertain refund #${id} (org #${organizationId}) resolved by ${by}: ${note.slice(0, 200)}`);
  return updated.length > 0;
}

/**
 * Claim the payment (once, race-safe) and take the purchased credits back, in
 * ONE transaction under an advisory lock on the payment id. The claim IS the
 * 'purchase_refund' credit_transactions row (UNIQUE per payment). Throws
 * RefundRefused when a refund is already recorded or the org no longer holds
 * the credits.
 */
async function claimRefund(e: Eligible, approvedBy: string | null): Promise<{ claimId: number; clawedCents: number }> {
  try {
    return await withTransaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`apply_refund:${e.chargeId}`}))`);
      const [recorded] = await tx
        .select({ id: creditTransactions.id })
        .from(creditTransactions)
        .where(and(eq(creditTransactions.organizationId, e.organizationId), eq(creditTransactions.stripePaymentIntentId, e.chargeId), inArray(creditTransactions.type, PRIOR_REFUND_TYPES)))
        .limit(1);
      if (recorded) throw new RefundRefused(`${e.chargeId} has already been refunded (or a refund of it is in flight) — never twice`);
      const [org] = await tx
        .select({ isFounder: organizations.isFounder, balance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` })
        .from(organizations)
        .where(eq(organizations.id, e.organizationId))
        .limit(1);
      if (!org) throw new RefundRefused(`organization #${e.organizationId} does not exist`);
      // The founder's own org carries no credit balance to take back.
      let clawedCents = 0;
      let balanceAfter = org.balance;
      if (org.isFounder !== true) {
        const [after] = await tx
          .update(organizations)
          .set({ creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric - ${e.amountCents}` })
          .where(and(eq(organizations.id, e.organizationId), sql`COALESCE(${organizations.creditBalance}, '0')::numeric >= ${e.amountCents}`))
          .returning({ balance: sql<number>`(COALESCE(${organizations.creditBalance}, '0')::numeric)::int` });
        if (!after) {
          throw new RefundRefused(
            `organization #${e.organizationId} no longer holds the $${(e.amountCents / 100).toFixed(2)} of credits this would refund — they were spent. A refund never leaves an org holding credits it was repaid for; the founder decides this one by hand`,
          );
        }
        clawedCents = e.amountCents;
        balanceAfter = after.balance;
      }
      const [claim] = await tx
        .insert(creditTransactions)
        .values({
          organizationId: e.organizationId,
          type: "purchase_refund",
          amountCents: -clawedCents,
          balanceAfterCents: balanceAfter,
          description: `Refund of purchase ${e.chargeId}: purchased credits returned`,
          stripePaymentIntentId: e.chargeId,
          // "claimed" until an outcome is written: a claim that is still
          // "claimed" minutes later was interrupted mid-refund and is listed
          // as uncertain for the founder (listUncertainRefunds).
          metadata: { refundAmountCents: e.amountCents, approvedBy, state: "claimed", claimedAt: clock.now().toISOString() },
        })
        .returning({ id: creditTransactions.id });
      return { claimId: claim.id, clawedCents };
    });
  } catch (err) {
    // The partial UNIQUE index refusing a second claim (a race the lock did
    // not serialize, e.g. a different spelling path) is "never twice", not an error.
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new RefundRefused(`${e.chargeId} has already been refunded (or a refund of it is in flight) — never twice`);
    throw err;
  }
}

/** Undo a claim whose refund did not happen: release it and give the credits back. */
async function releaseClaim(e: Eligible, claimId: number, clawedCents: number): Promise<void> {
  await withTransaction(async (tx) => {
    await tx
      .delete(creditTransactions)
      .where(and(eq(creditTransactions.organizationId, e.organizationId), eq(creditTransactions.id, claimId), eq(creditTransactions.type, "purchase_refund")));
    if (clawedCents > 0) {
      await tx
        .update(organizations)
        .set({ creditBalance: sql`COALESCE(${organizations.creditBalance}, '0')::numeric + ${clawedCents}` })
        .where(eq(organizations.id, e.organizationId));
    }
  });
}

async function handler(input: Record<string, unknown>, ctx: HandContext = {}): Promise<HandResult> {
  const started = clock.nowMs();
  let eligible: Eligible | null = null;
  let claim: { claimId: number; clawedCents: number } | null = null;
  let refundCalled = false;
  try {
    const e = await refundEligibility(input);
    if (!e.ok) return { success: false, output: e.reason, durationMs: clock.nowMs() - started };
    eligible = e;
    try {
      claim = await claimRefund(e, ctx.witnessedBy ?? null);
    } catch (err) {
      if (err instanceof RefundRefused) return { success: false, output: `apply_refund: ${err.message}. Refusing.`, durationMs: clock.nowMs() - started };
      throw err;
    }

    const { getUncachableStripeClient } = await import("../../../stripeClient");
    const stripe = await getUncachableStripeClient();
    // A credit-pack purchase is recorded by its PaymentIntent id; Stripe
    // refunds take either a charge or a payment_intent. Read the payment
    // first: a refund made on the Stripe side counts as "already refunded".
    const charge = e.chargeId.startsWith("pi_")
      ? ((await stripe.paymentIntents.retrieve(e.chargeId, { expand: ["latest_charge"] })).latest_charge as { amount?: number; amount_refunded?: number; refunded?: boolean } | null)
      : await stripe.charges.retrieve(e.chargeId);
    if (!charge || typeof charge !== "object") {
      await releaseClaim(e, claim.claimId, claim.clawedCents);
      return { success: false, output: `apply_refund: Stripe has no charge for ${e.chargeId}. Refusing.`, durationMs: clock.nowMs() - started };
    }
    if ((charge.amount_refunded ?? 0) > 0 || charge.refunded === true) {
      // Refunded outside the autopilot. Keep NO claim of ours (none was paid
      // out), give the credits back — the outside refund owns the record.
      await releaseClaim(e, claim.claimId, claim.clawedCents);
      return { success: false, output: `apply_refund: ${e.chargeId} was already refunded on Stripe — never twice. Refusing.`, durationMs: clock.nowMs() - started };
    }
    if (typeof charge.amount === "number" && e.amountCents > charge.amount) {
      await releaseClaim(e, claim.claimId, claim.clawedCents);
      return { success: false, output: `apply_refund: $${(e.amountCents / 100).toFixed(2)} is more than Stripe charged. Refusing.`, durationMs: clock.nowMs() - started };
    }
    // From here on the money may have moved. Once refunds.create has been
    // CALLED, the claim is never released and the credits are never given
    // back — a timeout on a refund that succeeded, or a failing bookkeeping
    // write after it, would otherwise let a retry refund the same payment
    // twice. Such an outcome is recorded as UNCERTAIN and put in front of the
    // founder instead.
    refundCalled = true;
    const refund = await stripe.refunds.create(
      e.chargeId.startsWith("pi_") ? { payment_intent: e.chargeId, amount: e.amountCents } : { charge: e.chargeId, amount: e.amountCents },
      { idempotencyKey: `apply_refund:${e.chargeId}` },
    );
    try {
      await db
        .update(creditTransactions)
        .set({ metadata: { refundAmountCents: e.amountCents, approvedBy: ctx.witnessedBy ?? null, stripeRefundId: refund.id, state: "refunded" } })
        .where(and(eq(creditTransactions.organizationId, e.organizationId), eq(creditTransactions.id, claim.claimId)));
    } catch (bookErr) {
      // The refund WENT OUT; only our record of its id did not. Keep the claim.
      await markUncertain(e, claim.claimId, `refund ${refund.id} issued but its record could not be written: ${bookErr instanceof Error ? bookErr.message : String(bookErr)}`);
      return {
        success: true,
        output: JSON.stringify({ refundId: refund.id, amountCents: e.amountCents, creditsReturned: claim.clawedCents, recordIncomplete: true }),
        durationMs: clock.nowMs() - started,
      };
    }
    return { success: true, output: JSON.stringify({ refundId: refund.id, amountCents: e.amountCents, creditsReturned: claim.clawedCents }), durationMs: clock.nowMs() - started };
  } catch (err) {
    if (eligible && claim) {
      if (refundCalled) {
        // The outcome at Stripe is unknown: keep the claim (a retry is refused
        // as "never twice") and tell the founder to look.
        await markUncertain(eligible, claim.claimId, `refund call failed or timed out — Stripe may or may not have refunded: ${err instanceof Error ? err.message : String(err)}`);
        return {
          success: false,
          output: `apply_refund: the outcome of refunding ${eligible.chargeId} is UNCERTAIN (the refund call did not return). The claim is kept so it can never be refunded twice; the founder has been asked to check Stripe.`,
          durationMs: clock.nowMs() - started,
        };
      }
      try {
        // Nothing reached Stripe's refund call: undo the claim and the clawback.
        await releaseClaim(eligible, claim.claimId, claim.clawedCents);
      } catch {
        /* the claim stays: fail closed — a second refund is refused until a human looks */
      }
    }
    return handError(NAME, err, started);
  }
}

/**
 * Record a refund whose outcome is not certain, where the founder sees it: the
 * claim row says so, and a founder ask names the payment to check on Stripe.
 * Best-effort on each half; never throws (the claim itself already stands).
 */
async function markUncertain(e: Eligible, claimId: number, why: string): Promise<void> {
  try {
    await db
      .update(creditTransactions)
      .set({ metadata: { refundAmountCents: e.amountCents, state: "uncertain", uncertainBecause: why.slice(0, 500) } })
      .where(and(eq(creditTransactions.organizationId, e.organizationId), eq(creditTransactions.id, claimId)));
  } catch (err) {
    logger.error(`[autopilot/hands] apply_refund: could not mark ${e.chargeId} uncertain on its claim row`, err instanceof Error ? err : undefined);
  }
  try {
    const { askFounder } = await import("../../solene/founderCollab");
    await askFounder({
      askingAgentRole: "general-purpose",
      questionSummary: `Refund outcome uncertain: ${e.chargeId} (org #${e.organizationId})`,
      questionBody: [
        `A $${(e.amountCents / 100).toFixed(2)} refund of ${e.chargeId} for organization #${e.organizationId} may or may not have gone out.`,
        `Why: ${why.slice(0, 500)}`,
        "",
        "The claim is kept, so the autopilot will never refund this payment again. Check the payment on Stripe and record what happened.",
      ].join("\n"),
      answerFormat: "free_text",
      urgency: "urgent",
    });
  } catch (err) {
    // Never silent: the founder must be told at least once. The claim row
    // still carries state "uncertain", which the Decisions door lists
    // (listUncertainRefunds), so a failed ask is not a lost one.
    logger.error(`[autopilot/hands] apply_refund: the founder could NOT be asked about the uncertain refund of ${e.chargeId}`, err instanceof Error ? err : undefined);
  }
}

registerHand({
  name: NAME,
  schema: {
    name: NAME,
    description:
      "Refund (partial allowed) a purchase an organization made (its credit-pack PaymentIntent id), for a retention save. IRREVERSIBLE; hard-capped at $50, never more than the purchase cost, never twice, and only while the org still holds the credits being refunded. REQUIRES a founder tap.",
    input_schema: {
      type: "object",
      properties: {
        charge_id: { type: "string", description: "The purchase's PaymentIntent id (pi_...) as the org's purchase recorded it." },
        amount_cents: { type: "number", description: "Amount to refund in cents (≤ 5000, ≤ the purchase)." },
        organization_id: { type: "number", description: "The organization that made the purchase. Required." },
        reason: { type: "string", description: "Why — for the audit trail." },
      },
      required: ["charge_id", "amount_cents", "organization_id"],
    },
  },
  domain: "finance",
  isCustomerFacing: true,
  movesMoney: true,
  outwardClass: "none",
  requiresApproval: true,
  surface: "generic",
  handler,
});
