/**
 * Founder Autopilot — the budget-ramp proposer (the zero-capital compounding wire).
 *
 * A company that starts with no acquisition capital has to EARN its growth
 * budget. This is the mechanism: once owned-channel acquisition is proven —
 * real attributed signups at a healthy cost — the autopilot proposes, once,
 * lifting the monthly growth cap by a bounded step. On the founder's approval
 * (handled by policyInducer.applyProposal → settings.setGrowthBudgetOverrideUsd)
 * the live envelope widens; the next wave of revenue funds the wave after it.
 *
 * Guardrails, by construction:
 *   - it only ever PROPOSES (a calm yes/no founder ask) — never self-spends,
 *   - CAC is computed from a LOWER-BOUND signup count (attribution is a floor)
 *     and an UPPER-BOUND spend proxy, so a ramp only fires when acquisition is
 *     healthy even under pessimistic assumptions,
 *   - one open ask at a time, and a cooldown between ramps (it never nags),
 *   - the step is bounded (+50%) and the approved cap is clamped to a hard
 *     ceiling at read-time — the loop can climb, never bolt,
 *   - attribution feeds this PROPOSAL only; it never touches the learning loop.
 *
 * The detector (economics.shouldRampBudget / nextBudgetStepUsd) is pure; this is
 * the thin DB + ask glue around it. Best-effort, never throws.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { autopilotPolicyProposals } from "@shared/schema";
import { logger } from "../../utils/logger";
import { shouldRampBudget, nextBudgetStepUsd, marginAllowsRamp } from "./economics";
import { getConversionSummary } from "./attribution";
import {
  getEffectiveMonthlyCapUsd,
  getEnsembleMonthlyCapHardCeilingUsd,
  getMonthToDateSpendForType,
} from "../solene/capitalTracker";

/** Sentinel playId for the (play-agnostic) budget-ramp proposal row. */
export const BUDGET_RAMP_PLAY_ID = "__growth_budget__";
/** Don't re-propose a ramp within this window of the last ramp proposal. */
export const RAMP_PROPOSAL_COOLDOWN_DAYS = 14;

export interface BudgetRampDeps {
  ask: (input: {
    askingAgentRole: "iris" | "soren" | "beatrice" | "krieger" | "general-purpose" | "code-reviewer";
    questionSummary: string;
    questionBody: string;
    answerFormat: "yes_no";
    urgency: "urgent" | "normal" | "low";
  }) => Promise<{ askId: number }>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * Is a ramp proposal currently in flight, or resolved too recently to re-ask?
 * Open ⇒ never stack a second ask. Resolved ⇒ honor the cooldown so the founder
 * isn't pestered every tick after answering.
 */
async function rampProposalCoolingDown(now: Date): Promise<boolean> {
  const [row] = await db
    .select({
      status: autopilotPolicyProposals.status,
      createdAt: autopilotPolicyProposals.createdAt,
      resolvedAt: autopilotPolicyProposals.resolvedAt,
    })
    .from(autopilotPolicyProposals)
    .where(eq(autopilotPolicyProposals.kind, "ramp_budget"))
    .orderBy(desc(autopilotPolicyProposals.createdAt))
    .limit(1);
  if (!row) return false;
  if (row.status === "open") return true;
  const since = row.resolvedAt ?? row.createdAt;
  if (!since) return true;
  const ageMs = now.getTime() - new Date(since).getTime();
  return ageMs < RAMP_PROPOSAL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * If owned-channel CAC is proven healthy and we're not already at the ceiling
 * (or in cooldown), file one calm founder ask proposing a bounded budget lift +
 * record the ramp_budget proposal. Returns 1 if a proposal fired, else 0.
 */
export async function maybeProposeBudgetRamp(deps: BudgetRampDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  try {
    if (await rampProposalCoolingDown(now)) return 0;

    // LOWER-BOUND signups (attribution is a floor) ÷ UPPER-BOUND spend (total
    // month-to-date autopilot dispatch spend PLUS recorded marketing_spend
    // actuals — 2026-07-07 cost audit: real ad dollars now have a ledger and
    // the CAC proof must see them) ⇒ a conservative CAC: a ramp only fires
    // when acquisition looks healthy even under the most pessimistic reading.
    const summary = await getConversionSummary();
    const dispatchSpendUsd = await getMonthToDateSpendForType("agent_dispatch");
    const { marketingSpendMonthToDateUsd } = await import("../marketingSpend");
    const adSpendUsd = await marketingSpendMonthToDateUsd().catch(() => 0);
    const spendUsd = dispatchSpendUsd + adSpendUsd;
    const decision = shouldRampBudget({ attributedSignups: summary.totalSignups, spendUsd });
    if (!decision.ramp) return 0;

    // Tighten-only margin guard: even with healthy CAC, don't propose lifting
    // PAID budget while existing customers are contribution-margin-negative.
    // Reuses the existing per-tenant unit-economics rollup (never rebuilds it).
    // Fail-open: the ramp is only a founder-gated PROPOSAL and CAC already
    // passed, so a transient economics-read blip must not freeze growth.
    try {
      const { readUnitEconomicsRollup } = await import("../unitEconomics");
      const econ = await readUnitEconomicsRollup();
      const guard = marginAllowsRamp({
        revenueUsd: econ.totals.totalMrrUsd,
        marginUsd: econ.totals.grossMarginUsd,
      });
      if (!guard.allow) {
        logger.info("[autopilot/budgetRamp] ramp suppressed by margin guard", { reason: guard.reason });
        return 0;
      }
    } catch (err) {
      logger.warn("[autopilot/budgetRamp] margin guard read failed — proceeding (fail-open)", err instanceof Error ? err : undefined);
    }

    const current = await getEffectiveMonthlyCapUsd();
    const ceiling = getEnsembleMonthlyCapHardCeilingUsd();
    const target = nextBudgetStepUsd(current, ceiling);
    if (target <= current) return 0; // already at the ceiling — nothing to propose

    const cacLine = decision.cacUsd != null ? `$${decision.cacUsd.toFixed(2)}` : "n/a";
    const { askId } = await deps.ask({
      askingAgentRole: "general-purpose",
      questionSummary: `Raise the monthly growth budget to $${target}?`,
      questionBody:
        `Owned-channel acquisition is paying for itself — ${decision.reason} ` +
        `(CAC ${cacLine} over ${summary.totalSignups} attributed signups). ` +
        `Want me to lift the monthly growth cap from $${Math.round(current)} to $${target} ` +
        `so the next wave of revenue funds more reach? You approve each lift explicitly — ` +
        `saying no holds the budget where it is — and I never spend beyond it; the cap is ` +
        `hard-ceilinged at $${Math.round(ceiling)} no matter what.`,
      answerFormat: "yes_no",
      urgency: "low",
    });

    await db.insert(autopilotPolicyProposals).values({
      kind: "ramp_budget",
      playId: BUDGET_RAMP_PLAY_ID,
      domain: "growth",
      reason: decision.reason,
      status: "open",
      askId,
      targetValueUsd: target,
    });
    logger.info("[autopilot/budgetRamp] ramp proposal fired", {
      from: Math.round(current),
      to: target,
      ceiling: Math.round(ceiling),
      signups: summary.totalSignups,
      askId,
    });
    return 1;
  } catch (err) {
    logger.warn("[autopilot/budgetRamp] propose failed", err instanceof Error ? err : undefined);
    return 0;
  }
}
