/**
 * Who pays for one customer-triggered Pax turn — founder decision 2026-10-12,
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
 *               the allowance the existing wall (aiByokThresholdGate /
 *               enforceAiAllowance) still governs.
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
