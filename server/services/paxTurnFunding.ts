/**
 * Who pays for one Pax turn (or one unit of background ai_chat work) — founder
 * decision 2026-10-12,
 * "Included Pax turns are free" (docs/company/founder-decisions-2026-10-12.md).
 *
 * Within a paid plan's included Pax — under the plan's monthly message cap
 * (TIER_LIMITS.ai_requests) AND under the shared monthly AI allowance (founder
 * decision 2026-10-08, TIER_LIMITS.aiAllowanceCents) — a platform-key turn
 * neither requires nor charges purchased credits. Credits (or the org's own AI
 * key) are needed only once the included allowance is used up. Trial
 * behaviour is unchanged: inside the trial window a turn stays on the credit
 * lane (the org's own balance, then the trial's free allowance).
 *
 * Lanes:
 *   founder   — never metered.
 *   byok      — the org's own AI key serves the turn (unchanged behaviour).
 *   included  — paid plan, not in trial, under the message cap and under the
 *               allowance: no credit check, no credit charge.
 *   credits   — everything else (free plan, trial, past the cap or the
 *               allowance): the existing credit gate and charge apply. Past
 *               the allowance, purchased credits fund the turn on the
 *               platform key (founder decision 2026-10-17): reservePaxTurn
 *               marks a balance-paid turn (paxTurnContext.markPaxTurn) so the
 *               allowance enforcement lets it through; the AI cost ceilings
 *               still bound it.
 *
 * Only the "credits" lane is ever charged, and only through reservePaxTurn
 * (before the AI call, atomically) and settlePaxTurn (usage record or refund).
 *
 * Background AI work that charges `ai_chat` credits (campaignOptimizer,
 * leadNurturer batch runs) follows the same rule (decision 2026-10-17): it
 * calls this once per unit and reserves through the same helper.
 *
 * The allowance test is aiAllowanceRule.isAiAllowanceSpent — the same predicate
 * the wall and the per-call enforcement use — read from the same
 * checkAiTurnGate result. Every Pax charge site consults this function
 * (paxTurnsIncludedAreFree.test.ts enumerates them).
 *
 * Fails toward the CREDIT lane on a read error: the pre-decision behaviour,
 * never a free turn granted by a hiccup.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { limitsTierFor } from "@shared/billing/tier-limits";
import { logger } from "../utils/logger";
import { checkAiTurnGate, aiMessageCapAllows, type AiTurnGateResult, type UsageLimitResult } from "./usageLimits";
import { isAiAllowanceSpent } from "./aiAllowanceRule";
import { markPaxTurn } from "./paxTurnContext";
import { isInTrialWindow } from "./credits";

export type PaxTurnLane = "founder" | "byok" | "included" | "credits";

/** Whether a stored tier is a paid plan (enterprise included; free is not). */
function isPaidPlan(subscriptionTier: string | null | undefined): boolean {
  return limitsTierFor(subscriptionTier) !== "free";
}

/**
 * The pure rule, given what paxTurnFunding has read. Tests reach it through
 * paxTurnFunding with the gate and cap result supplied.
 */
function paxTurnLane(input: {
  gate: Pick<AiTurnGateResult, "mode" | "threshold" | "current">;
  subscriptionTier: string | null | undefined;
  trialEndsAt: Date | string | null | undefined;
  withinMessageCap: boolean;
}): PaxTurnLane {
  if (input.gate.mode === "founder") return "founder";
  if (input.gate.mode === "byok") return "byok";
  if (
    isPaidPlan(input.subscriptionTier) &&
    !isInTrialWindow(input.trialEndsAt) &&
    input.withinMessageCap &&
    !isAiAllowanceSpent(input.gate)
  ) {
    return "included";
  }
  return "credits";
}

export async function paxTurnFunding(
  organizationId: number,
  opts: { gate?: AiTurnGateResult; usage?: UsageLimitResult; isFounder?: boolean } = {},
): Promise<PaxTurnLane> {
  try {
    const gate = opts.gate ?? (await checkAiTurnGate(organizationId, { isFounder: opts.isFounder }));
    if (gate.mode === "founder" || gate.mode === "byok") return gate.mode;
    const withinMessageCap = opts.usage
      ? opts.usage.allowed
      : await aiMessageCapAllows(organizationId, { isFounder: opts.isFounder });
    const [org] = await db
      .select({ subscriptionTier: organizations.subscriptionTier, trialEndsAt: organizations.trialEndsAt })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    return paxTurnLane({
      gate,
      subscriptionTier: org?.subscriptionTier,
      trialEndsAt: org?.trialEndsAt,
      withinMessageCap,
    });
  } catch (err) {
    logger.warn("[pax-turn-funding] unreadable — using the credit lane", {
      metadata: { organizationId, detail: err instanceof Error ? err.message : String(err) },
    });
    return "credits";
  }
}

// ─── Taking and settling the charge for one Pax turn ───────────────────────

/** What one turn was charged. `fundedBy: null` — nothing was taken (included, own key, founder). */
export interface PaxTurnCharge {
  organizationId: number;
  lane: PaxTurnLane;
  cents: number;
  fundedBy: "balance" | "trial" | null;
}

export type PaxTurnReservation =
  | { ok: true; charge: PaxTurnCharge }
  | { ok: false; refusal: { lane: "trial" | "balance"; requiredCents: number; balanceCents: number } };

/**
 * Take the turn's charge BEFORE the AI call — atomically, so concurrent turns
 * cannot all pass a balance only one of them can pay for (the debit is a
 * conditional `credit_balance >= cents` update). Only the credit lane is ever
 * charged: an included, own-key or founder turn takes nothing. On the credit
 * lane the org's own balance pays first, then an active trial's allowance
 * (CreditService.deductOrFundFromTrial, unchanged trial behaviour).
 *
 * `markTurn` (Pax turn routes): marks the request's Pax-turn scope so that,
 * past the allowance, a balance-paid turn runs on the platform key.
 */
export async function reservePaxTurn(
  organizationId: number,
  lane: PaxTurnLane,
  opts: { description: string; cents?: number; markTurn?: boolean },
): Promise<PaxTurnReservation> {
  const { CreditService, usageMeteringService } = await import("./credits");
  const cents = opts.cents ?? (await usageMeteringService.calculateCost("ai_chat", 1).catch(() => 2));
  if (lane !== "credits") {
    if (opts.markTurn) markPaxTurn(organizationId, false);
    return { ok: true, charge: { organizationId, lane, cents, fundedBy: null } };
  }
  const credits = new CreditService();
  const fundedBy = await credits.deductOrFundFromTrial(organizationId, cents, opts.description, {
    actionType: "ai_chat",
    paxLane: lane,
  });
  if (!fundedBy) {
    const balanceCents = await credits.getBalance(organizationId).catch(() => 0);
    const inTrial = (await credits.trialAllowanceRemaining(organizationId).catch(() => null)) !== null;
    return { ok: false, refusal: { lane: inTrial ? "trial" : "balance", requiredCents: cents, balanceCents } };
  }
  if (opts.markTurn) markPaxTurn(organizationId, fundedBy === "balance");
  return { ok: true, charge: { organizationId, lane, cents, fundedBy } };
}

async function countSettleFailure(stage: "refund" | "record"): Promise<void> {
  try {
    const { paxTurnSettleFailuresTotal } = await import("../metrics");
    paxTurnSettleFailuresTotal.inc({ stage });
  } catch {
    /* metrics unavailable (tests, scripts) — the error log above still stands */
  }
}

/**
 * Settle a reserved turn. Delivered: write the usage record (the money is
 * already settled; a trial-funded turn's record was written when it was
 * funded). Not delivered: return a balance-paid charge as a refund. Neither
 * failure is swallowed — each is logged at error level and counted
 * (acreos_pax_turn_settle_failures_total). A trial-funded turn has no balance
 * charge to return: its use of the trial's free allowance was recorded when it
 * was funded and stands.
 */
export async function settlePaxTurn(
  charge: PaxTurnCharge,
  outcome: { delivered: boolean; reason?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const { CreditService, usageMeteringService } = await import("./credits");
  if (outcome.delivered) {
    if (charge.fundedBy === "trial") return;
    try {
      await usageMeteringService.recordUsage(
        charge.organizationId,
        "ai_chat",
        1,
        { ...(outcome.metadata ?? {}), paxLane: charge.lane, fundedBy: charge.fundedBy ?? "not_charged" },
        false,
      );
    } catch (err) {
      logger.error("[pax-turn] usage record failed after a delivered turn", err instanceof Error ? err : undefined, {
        metadata: { organizationId: charge.organizationId, lane: charge.lane },
      });
      await countSettleFailure("record");
    }
    return;
  }
  if (charge.fundedBy !== "balance") return;
  try {
    await new CreditService().addCredits(
      charge.organizationId,
      charge.cents,
      "refund",
      `Refund: Pax turn not delivered (${outcome.reason ?? "failed"})`,
      { actionType: "ai_chat", paxLane: charge.lane },
    );
  } catch (err) {
    logger.error("[pax-turn] refund of an undelivered turn failed", err instanceof Error ? err : undefined, {
      metadata: { organizationId: charge.organizationId, cents: charge.cents, reason: outcome.reason },
    });
    await countSettleFailure("refund");
  }
}
