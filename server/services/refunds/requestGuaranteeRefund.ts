/**
 * Refund intake as a SERVICE (design 2026-11 §1.1, §3). POST
 * /api/subscription/refund-request calls this; the PKG-2 support inbox calls
 * the same function, so an emailed request gets exactly the automation an API
 * request gets.
 *
 * Intake, in order:
 *   1. E1 — no Stripe customer: refused (nothing to refund).
 *   2. E2 — resolve the org's FIRST subscription charge (never "the latest").
 *   3. Gather the E3–E6 facts and evaluate the §5A rule (a pure function).
 *   4. B7 — platform velocity: when tripped, automation pauses platform-wide.
 *   5. Persist the row: eligibility verdicts, brake, dueAt = createdAt + 24h.
 *   6. Guarantee-eligible → the shared executor, at ANY amount. Anything else
 *      is queued under its brake with the existing system_alerts notification
 *      — never a dead end.
 *
 * The customer names neither a charge nor an amount; the server picks both.
 */
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { refundRequests, creditTransactions, systemAlerts, type RefundRequest } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import type { AuditActor } from "../../utils/auditLog";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { evaluateGuaranteeEligibility, type GuaranteeEligibility, type RefundBrakeCode } from "./guaranteeEligibility";
import { resolveFirstSubscriptionCharge, chargeFactsOf, type GuaranteeStripe } from "./guaranteeFacts";
import { executeRefundRequest, type ExecuteRefundDeps } from "./executeRefund";
import { GUARANTEE_REFUND_VELOCITY, REFUND_DECISION_SLA_HOURS } from "./refundConfig";
import { raiseRefundPipelineAlert, raiseRefundQueueAlert } from "./refundAlerts";

export interface RefundIntakeOrg {
  id: number;
  name: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface RefundIntakeInput {
  organization: RefundIntakeOrg;
  userId?: string | null;
  reason: string;
  actor?: AuditActor;
}

export type RefundIntakeResult =
  | { kind: "no_billing_account" }
  | { kind: "no_charges" }
  | {
      kind: "recorded";
      /** What the customer is told: processed | pending | processing. */
      status: "processed" | "pending" | "processing";
      amountCents: number;
      message: string;
      requestId: number;
      brake: RefundBrakeCode | null;
    };

const OPEN_STATUSES = ["pending", "processing", "uncertain", "processed"] as const;
const BUSY_OR_DONE = ["processed", "processing", "uncertain"] as const;

/** What the customer reads — never an amount rule, never an internal brake code. */
export const REFUND_COPY = {
  processed: "Your refund has been processed. It should appear on your statement within 5-10 business days.",
  queued:
    "Your refund request is with our founder for review. Our Terms handle requests like this case by case, and we will email you the decision.",
  retrying:
    "Your refund request is received and being processed. We hit a temporary problem and will retry it automatically; our founder has it in front of them too.",
  confirming:
    "Your refund request is received and is being confirmed with our payment processor. We will email you once it is settled.",
  alreadyProcessed: "A refund for this charge has already been processed.",
  alreadyOpen: "A refund request for this charge is already with us — we will email you the decision.",
} as const;

export interface VelocityVerdict {
  tripped: boolean;
  count: number;
  cents: number;
}

/**
 * B7: automatic guarantee refunds in the rolling window. Platform-wide, so the
 * read crosses orgs deliberately.
 */
async function guaranteeRefundVelocity(nextAmountCents: number, nowMs = clock.nowMs()): Promise<VelocityVerdict> {
  const since = new Date(nowMs - GUARANTEE_REFUND_VELOCITY.windowHours * 60 * 60 * 1000);
  const rows = await unscopedForPlatformOps("refund velocity brake B7: platform-wide count of automatic guarantee refunds in the rolling window")
    .select({ amountCents: refundRequests.amountCents })
    .from(refundRequests)
    .where(and(eq(refundRequests.autoApproved, true), inArray(refundRequests.status, [...BUSY_OR_DONE]), gte(refundRequests.createdAt, since)))
    .limit(GUARANTEE_REFUND_VELOCITY.maxCount + 1000);
  const count = rows.length;
  const cents = rows.reduce((n, r) => n + (r.amountCents ?? 0), 0);
  const tripped = count >= GUARANTEE_REFUND_VELOCITY.maxCount || cents + nextAmountCents > GUARANTEE_REFUND_VELOCITY.maxCents;
  return { tripped, count, cents };
}

/** Page the founder once per window when B7 trips. Never throws. */
async function pageVelocityTrip(v: VelocityVerdict, nowMs: number): Promise<void> {
  try {
    const since = new Date(nowMs - GUARANTEE_REFUND_VELOCITY.windowHours * 60 * 60 * 1000);
    const [existing] = await unscopedForPlatformOps("refund velocity brake B7: dedupe the founder page within the window")
      .select({ id: systemAlerts.id })
      .from(systemAlerts)
      .where(and(eq(systemAlerts.type, "refund_velocity_brake"), gte(systemAlerts.createdAt, since)))
      .limit(1);
    if (existing) return;
    await raiseRefundPipelineAlert({
      type: "refund_velocity_brake",
      severity: "critical",
      title: "Refund automation PAUSED platform-wide (brake B7)",
      message:
        `${v.count} automatic guarantee refund(s) totalling $${(v.cents / 100).toFixed(2)} in the last ${GUARANTEE_REFUND_VELOCITY.windowHours}h ` +
        `reached the velocity threshold (${GUARANTEE_REFUND_VELOCITY.maxCount} refunds or $${(GUARANTEE_REFUND_VELOCITY.maxCents / 100).toFixed(2)}). ` +
        `Eligible requests now queue under B7 until the window clears or you approve them one by one. Look for a signup farm.`,
    });
  } catch (err) {
    logger.error("[Refund] could not page the founder about the B7 velocity brake", err instanceof Error ? err : undefined);
  }
}

function eligibilityRecord(e: GuaranteeEligibility, extra: Record<string, unknown>): Record<string, unknown> {
  return { eligible: e.eligible, failed: e.failed, verdicts: e.verdicts, evaluatedAt: clock.now().toISOString(), ...extra };
}

function responseFor(row: Pick<RefundRequest, "id" | "amountCents" | "brake">, status: "processed" | "pending" | "processing", message: string): RefundIntakeResult {
  return { kind: "recorded", status, amountCents: row.amountCents, message, requestId: row.id, brake: (row.brake as RefundBrakeCode | null) ?? null };
}

/**
 * Create a guarantee refund request and run it as far as the rules allow.
 * `stripe` is injectable for the proof legs; production resolves it itself.
 */
export async function requestGuaranteeRefund(
  input: RefundIntakeInput,
  deps: ExecuteRefundDeps & { stripe?: GuaranteeStripe } = {},
): Promise<RefundIntakeResult> {
  const org = input.organization;
  if (!org.stripeCustomerId) return { kind: "no_billing_account" };

  const stripe =
    deps.stripe ?? ((await (await import("../../stripeClient")).getUncachableStripeClient()) as unknown as GuaranteeStripe);
  const nowMs = clock.nowMs();

  // Credit-pack purchases are not subscription charges (E2's fallback skips them).
  const purchases = await db
    .select({ pi: creditTransactions.stripePaymentIntentId })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.organizationId, org.id), eq(creditTransactions.type, "purchase"), isNotNull(creditTransactions.stripePaymentIntentId)));
  const creditPurchasePaymentIntentIds = new Set(purchases.map((p) => p.pi).filter((v): v is string => typeof v === "string"));

  // E2 — the target is the FIRST subscription charge, never "the latest".
  const target = await resolveFirstSubscriptionCharge(stripe, {
    customerId: org.stripeCustomerId,
    subscriptionId: org.stripeSubscriptionId,
    creditPurchasePaymentIntentIds,
  });
  if (!target) return { kind: "no_charges" };
  const charge = target.charge;
  const amountCents = charge.amount;
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;

  // The same charge may already have a request: never a duplicate row for it.
  const [existing] = await db
    .select()
    .from(refundRequests)
    .where(and(eq(refundRequests.organizationId, org.id), eq(refundRequests.stripeChargeId, charge.id), inArray(refundRequests.status, [...OPEN_STATUSES])))
    .limit(1);
  if (existing) {
    if (existing.status === "processed") return responseFor(existing, "processed", REFUND_COPY.alreadyProcessed);
    if (existing.status === "pending") return responseFor(existing, "pending", REFUND_COPY.alreadyOpen);
    return responseFor(existing, "processing", REFUND_COPY.alreadyOpen);
  }

  // E6 facts (this org's own rows).
  const [consumed] = await db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(and(eq(refundRequests.organizationId, org.id), eq(refundRequests.status, "processed")))
    .limit(1);

  const eligibility = evaluateGuaranteeEligibility({
    hasStripeCustomer: true,
    targetIsFirstSubscriptionCharge: true, // the resolver returned it as the first charge
    chargeCreatedAtMs: charge.created * 1000,
    nowMs,
    charge: chargeFactsOf(charge),
    // E5 is not automated: no abuse-termination flag exists on the org. Nothing
    // recorded excludes it; the verdict says exactly that and no more.
    abuseExclusion: "no_recorded_exclusion",
    guaranteeAlreadyConsumed: Boolean(consumed),
    sameChargeInFlightOrProcessed: false, // checked above (no open row for this charge)
  });

  // B7 — only meaningful for a request that would otherwise run automatically.
  let brake: RefundBrakeCode | null = eligibility.brake;
  let velocity: VelocityVerdict | null = null;
  if (eligibility.eligible) {
    velocity = await guaranteeRefundVelocity(amountCents, nowMs);
    if (velocity.tripped) {
      brake = "B7";
      await pageVelocityTrip(velocity, nowMs);
    }
  }

  const createdAt = clock.now();
  const [row] = await db
    .insert(refundRequests)
    .values({
      organizationId: org.id,
      userId: input.userId ?? undefined,
      stripeChargeId: charge.id,
      stripePaymentIntentId: paymentIntentId ?? undefined,
      amountCents,
      reason: input.reason,
      status: "pending",
      autoApproved: false,
      eligibility: eligibilityRecord(eligibility, {
        firstCharge: { chargeId: charge.id, via: target.via, createdAt: new Date(charge.created * 1000).toISOString() },
        ...(velocity ? { velocity } : {}),
      }),
      brake,
      createdAt, // explicit: dueAt is createdAt + SLA exactly, not a second clock read
      dueAt: new Date(createdAt.getTime() + REFUND_DECISION_SLA_HOURS * 60 * 60 * 1000),
      attempts: 0,
    })
    .returning();

  if (eligibility.eligible && brake === null) {
    const result = await executeRefundRequest(
      { requestId: row.id, organizationId: org.id, processedBy: "auto", trigger: "intake", actor: input.actor },
      deps,
    );
    switch (result.outcome) {
      case "processed":
        return responseFor(row, "processed", REFUND_COPY.processed);
      case "queued": // re-verification held it; the executor already alerted
        return responseFor({ ...row, brake: result.brake }, "pending", REFUND_COPY.queued);
      case "retry_queued":
        return responseFor(row, "pending", REFUND_COPY.retrying);
      case "uncertain":
        return responseFor({ ...row, brake: "B6" }, "processing", REFUND_COPY.confirming);
      case "not_claimable": {
        // Lost a race (or already handled). Report what the row now says.
        const state = result.status;
        if (state === "processed") return responseFor(row, "processed", REFUND_COPY.processed);
        if (state === "processing" || state === "uncertain") return responseFor(row, "processing", REFUND_COPY.confirming);
        return responseFor(row, "pending", REFUND_COPY.queued);
      }
    }
  }

  // Queued under a brake: the existing notification, with the brake on it.
  await raiseRefundQueueAlert({
    organizationId: org.id,
    organizationName: org.name,
    requestId: row.id,
    amountCents,
    brake,
    reason: input.reason,
    note: eligibility.failed.length
      ? `Failed predicates: ${eligibility.failed.map((id) => `${id} (${eligibility.verdicts[id].detail})`).join("; ")}`
      : "Guarantee-eligible, held by the platform velocity brake (B7).",
  });
  return responseFor({ ...row, brake }, "pending", REFUND_COPY.queued);
}
