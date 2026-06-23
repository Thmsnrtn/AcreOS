/**
 * Founder Autopilot — the Policy Inducer (the load-reducing learning layer).
 *
 * The system watches the Experience Log for durable patterns and offers to
 * codify them — turning repeated micro-decisions into macro-policy:
 *   - a play it keeps DECLINING  → propose a standing order to stop it.
 *   - a play it keeps APPROVING  → propose granting its domain more autonomy.
 *
 * This is the loop that REDUCES founder load over time: the system learns the
 * founder's implicit policy and asks, once, to make it permanent. Guardrails:
 *   - it only ever PROPOSES (a calm founder ask); it never self-authors policy,
 *   - each (kind, play) is proposed at most once — it never nags,
 *   - approval applies a real, reversible change (a standing order the founder
 *     can delete; an autonomy bump the founder can pause).
 *
 * The detector is PURE → exhaustively testable. The orchestrator + apply are
 * thin DB glue.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  autopilotExperiences,
  autopilotPolicyProposals,
  type AutopilotPolicyProposal,
} from "@shared/schema";
import { logger } from "../../utils/logger";
import { outcomeOf, type ExperienceVote } from "./experienceLog";

/** Consecutive recent declines/failures that trigger a "stop" proposal. */
export const DECLINE_STREAK = 3;
/** Consecutive recent successes that trigger a "trust" proposal. */
export const TRUST_STREAK = 5;

export type ProposalKind = "stop_play" | "trust_play" | "ramp_budget";

export interface InductionProposal {
  kind: ProposalKind;
  playId: string;
  reason: string;
}

/**
 * Detect whether a play's recent history (votes, MOST RECENT FIRST) warrants a
 * proposal. Pure + total. Stop takes precedence (acting on a bad streak is more
 * urgent than rewarding a good one). Pending votes must be filtered out by the
 * caller — only resolved successes/failures vote.
 */
export function detectPlayProposal(
  playId: string,
  votesRecentFirst: ExperienceVote[],
): InductionProposal | null {
  const v = votesRecentFirst.filter((x) => x !== "pending");
  if (v.length >= DECLINE_STREAK && v.slice(0, DECLINE_STREAK).every((x) => x === "failure")) {
    return { kind: "stop_play", playId, reason: `declined or failed the last ${DECLINE_STREAK} times running` };
  }
  if (v.length >= TRUST_STREAK && v.slice(0, TRUST_STREAK).every((x) => x === "success")) {
    return { kind: "trust_play", playId, reason: `approved/succeeded the last ${TRUST_STREAK} times running` };
  }
  return null;
}

// ── Orchestration (DB) ───────────────────────────────────────────────────────

/** Has this exact (kind, play) ever been proposed? (proposed at most once.) */
async function alreadyProposed(kind: ProposalKind, playId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: autopilotPolicyProposals.id })
    .from(autopilotPolicyProposals)
    .where(and(eq(autopilotPolicyProposals.kind, kind), eq(autopilotPolicyProposals.playId, playId)))
    .limit(1);
  return !!row;
}

/** Build a play's resolved-vote history (most recent first) from experiences. */
async function votesForPlay(domain: string, playId: string): Promise<ExperienceVote[]> {
  const rows = await db
    .select({
      dispatchSuccess: autopilotExperiences.dispatchSuccess,
      evalScore: autopilotExperiences.evalScore,
      founderVerdict: autopilotExperiences.founderVerdict,
      resolution: autopilotExperiences.resolution,
      satisfaction: autopilotExperiences.satisfaction,
    })
    .from(autopilotExperiences)
    .where(and(eq(autopilotExperiences.domain, domain), eq(autopilotExperiences.playId, playId)))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(50);
  return rows.map((r) =>
    outcomeOf({
      dispatchSuccess: r.dispatchSuccess,
      evalScore: r.evalScore != null ? Number(r.evalScore) : null,
      founderVerdict: r.founderVerdict,
      resolution: r.resolution,
      satisfaction: r.satisfaction,
    }),
  );
}

export interface InductionDeps {
  ask: (input: {
    askingAgentRole: "iris" | "soren" | "beatrice" | "krieger" | "general-purpose" | "code-reviewer";
    questionSummary: string;
    questionBody: string;
    answerFormat: "yes_no";
    urgency: "urgent" | "normal" | "low";
  }) => Promise<{ askId: number }>;
}

/**
 * Scan the distinct plays seen in a domain; for any that warrants a proposal and
 * hasn't been proposed before, fire one calm founder ask + record the proposal.
 * Returns how many proposals were fired. Best-effort, never throws.
 */
export async function runPolicyInduction(domain: string, deps: InductionDeps): Promise<number> {
  let fired = 0;
  try {
    const playRows = await db
      .selectDistinct({ playId: autopilotExperiences.playId })
      .from(autopilotExperiences)
      .where(eq(autopilotExperiences.domain, domain));
    const playIds = playRows.map((r) => r.playId).filter((p): p is string => !!p);

    for (const playId of playIds) {
      const votes = await votesForPlay(domain, playId);
      const proposal = detectPlayProposal(playId, votes);
      if (!proposal) continue;
      if (await alreadyProposed(proposal.kind, playId)) continue;

      const isStop = proposal.kind === "stop_play";
      const { askId } = await deps.ask({
        askingAgentRole: "general-purpose",
        questionSummary: isStop
          ? `Stop running the "${playId}" play?`
          : `Trust the ${domain} domain to act more on its own?`,
        questionBody: isStop
          ? `I've ${proposal.reason} for the "${playId}" play. Want me to stop proposing it? (Yes writes a standing order you can remove anytime.)`
          : `The "${playId}" play has ${proposal.reason}. Want me to grant the ${domain} domain its next autonomy level? (Yes promotes it one rung; you can pause it anytime.)`,
        answerFormat: "yes_no",
        urgency: "low",
      });

      await db.insert(autopilotPolicyProposals).values({
        kind: proposal.kind,
        playId,
        domain,
        reason: proposal.reason,
        status: "open",
        askId,
      });
      fired += 1;
      logger.info("[autopilot/inducer] proposal fired", { kind: proposal.kind, playId, domain, askId });
    }
  } catch (err) {
    logger.warn("[autopilot/inducer] induction failed", err instanceof Error ? err : undefined);
  }
  return fired;
}

/**
 * When the founder answers an induction ask, resolve the proposal + apply it.
 * No-op if the ask isn't an induction proposal. Best-effort.
 *   - stop_play approved  → write a standing order (durable, removable).
 *   - trust_play approved → bump the domain one autonomy level (reversible).
 */
export async function resolvePolicyProposalForAsk(askId: number, approved: boolean): Promise<void> {
  try {
    const [proposal] = await db
      .select()
      .from(autopilotPolicyProposals)
      .where(and(eq(autopilotPolicyProposals.askId, askId), eq(autopilotPolicyProposals.status, "open")))
      .limit(1);
    if (!proposal) return;

    await db
      .update(autopilotPolicyProposals)
      .set({ status: approved ? "approved" : "declined", resolvedAt: new Date() })
      .where(eq(autopilotPolicyProposals.id, proposal.id));

    if (!approved) return;
    await applyProposal(proposal);
  } catch (err) {
    logger.warn("[autopilot/inducer] proposal resolution failed", err instanceof Error ? err : undefined);
  }
}

async function applyProposal(proposal: AutopilotPolicyProposal): Promise<void> {
  if (proposal.kind === "stop_play") {
    const { createStandingOrder } = await import("./standingOrders");
    await createStandingOrder({
      kind: "standing_order",
      body: `Do not run the "${proposal.playId}" play.`,
      createdBy: "autopilot:induction",
    });
    logger.info("[autopilot/inducer] applied stop_play → standing order", { playId: proposal.playId });
  } else if (proposal.kind === "trust_play") {
    const { getDomainLevel, nextLevel, setDomainLevel } = await import("./domainAutonomy");
    const current = await getDomainLevel(proposal.domain as never);
    const promoted = nextLevel(current);
    if (promoted) {
      await setDomainLevel(proposal.domain as never, promoted, `founder-approved trust for "${proposal.playId}"`);
      logger.info("[autopilot/inducer] applied trust_play → autonomy bump", { domain: proposal.domain, to: promoted });
    }
  } else if (proposal.kind === "ramp_budget") {
    // Apply the founder-approved growth-budget lift: write the DB-backed cap the
    // live envelope reads. Clamped to the hard ceiling at read-time, so even a
    // stale target can never set an unbounded budget. Reversible (the founder can
    // pause or clear it from the Control Center).
    if (proposal.targetValueUsd != null && Number.isFinite(proposal.targetValueUsd)) {
      const { setGrowthBudgetOverrideUsd } = await import("./settings");
      await setGrowthBudgetOverrideUsd(proposal.targetValueUsd, "autopilot:budget-ramp");
      logger.info("[autopilot/inducer] applied ramp_budget → growth cap raised", {
        to: proposal.targetValueUsd,
      });
    }
  }
}

/** Play ids the founder has approved stopping — growth selection excludes these. */
export async function getStoppedPlayIds(): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ playId: autopilotPolicyProposals.playId })
      .from(autopilotPolicyProposals)
      .where(and(eq(autopilotPolicyProposals.kind, "stop_play"), eq(autopilotPolicyProposals.status, "approved")));
    return new Set(rows.map((r) => r.playId));
  } catch {
    return new Set();
  }
}
