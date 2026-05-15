/**
 * Pillar S — Founder inbox attention-budget logic.
 *
 * Pure-function service. Given a set of candidate inbox items, classifies
 * them into three sections (red / amber / running-fine), sorts within each,
 * and applies the daily attention cap by deferring overflow.
 *
 * The /api/founder/now endpoint composes this from existing sources:
 *   - decisionsInboxItems (status=pending, urgencyScore, ownerAgentCodename)
 *   - strategicProposals (status=synthesized, the curated monthly slate)
 *   - jobHealthLogs (failures in the last 24h)
 *   - critical alerts (auth-revoked secrets, deploys stuck)
 *
 * The output is the single canonical surface for /founder/now. Other
 * legacy founder routes (/founder/strategy, /founder/agent-queue, …)
 * continue to exist but render filtered views of this same aggregator.
 */

export type InboxSection = "red" | "amber" | "running_fine";

export interface InboxItem {
  /** Stable identifier — used for resolve/defer mutations. */
  id: string;
  /** Where in the canonical inbox this belongs. */
  section: InboxSection;
  /** What kind of action this is — drives the icon + CTA. */
  kind: "secret_revoked" | "deploy_failed" | "regression_detected"
      | "strategic_proposal" | "agent_proposal" | "dsar_deadline"
      | "pillar_health" | "job_health" | "budget_burn"
      | "tier_promotion" | "tier_demotion";
  title: string;
  body: string;
  /** Higher = surfaces first within a section. 0-100. */
  priority: number;
  /** Where the founder goes to act on it. */
  actionUrl: string;
  /** When this item should be re-shown if not actioned. */
  deferUntil?: Date;
  /** The agent that surfaced this (if any). */
  ownerAgentCodename?: string;
}

export interface InboxBudgetConfig {
  /** Founder's per-day attention cap. From organizations.founderDailyAttentionCap. */
  dailyCap: number;
  /** Override the cap for red items — red is always surfaced regardless of budget. */
  redItemsAlwaysSurface: boolean;
}

export interface InboxBudgetResult {
  /** The items the /founder/now page should render. */
  visible: InboxItem[];
  /** Items deferred to tomorrow. */
  deferred: InboxItem[];
  /** Section counts. */
  counts: { red: number; amber: number; runningFine: number };
  /** Total candidates before budget applied. */
  totalCandidates: number;
  /** Whether any items overflowed today's cap. */
  overflowApplied: boolean;
}

export function applyBudget(
  candidates: InboxItem[],
  config: InboxBudgetConfig = { dailyCap: 5, redItemsAlwaysSurface: true },
): InboxBudgetResult {
  // Always surface red items (auth revoked, deploy down, regression).
  // Amber items consume the daily cap. Running-fine items show one
  // line per pillar with no cap (it's status, not action).
  const sorted = [...candidates].sort((a, b) => {
    const sectionOrder: Record<InboxSection, number> = { red: 0, amber: 1, running_fine: 2 };
    if (sectionOrder[a.section] !== sectionOrder[b.section]) {
      return sectionOrder[a.section] - sectionOrder[b.section];
    }
    return b.priority - a.priority;
  });

  const red = sorted.filter((i) => i.section === "red");
  const amber = sorted.filter((i) => i.section === "amber");
  const runningFine = sorted.filter((i) => i.section === "running_fine");

  // Red consumes the budget too, but takes precedence (it's the founder
  // signal that something is on fire). The amber pool gets capped at
  // max(0, dailyCap - red.length).
  const redOverBudget = config.redItemsAlwaysSurface ? red : red.slice(0, config.dailyCap);
  const amberCap = Math.max(0, config.dailyCap - redOverBudget.length);
  const amberVisible = amber.slice(0, amberCap);
  const amberDeferred = amber.slice(amberCap);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const deferred = amberDeferred.map((item) => ({ ...item, deferUntil: tomorrow }));

  return {
    visible: [...redOverBudget, ...amberVisible, ...runningFine],
    deferred,
    counts: {
      red: redOverBudget.length,
      amber: amberVisible.length,
      runningFine: runningFine.length,
    },
    totalCandidates: candidates.length,
    overflowApplied: deferred.length > 0,
  };
}

/**
 * Classify an arbitrary signal source into an InboxSection. Centralizes
 * the rules so adding a new signal source (e.g. a new Stripe drift
 * detector) only requires extending this function.
 */
export function classifyKind(kind: InboxItem["kind"], extra?: { daysUntil?: number; urgencyScore?: number }): InboxSection {
  // Always red.
  if (kind === "secret_revoked" || kind === "deploy_failed" || kind === "regression_detected") return "red";

  // Red if within 48h or urgency >85; otherwise amber.
  if (kind === "dsar_deadline" && extra?.daysUntil != null && extra.daysUntil < 2) return "red";
  if (kind === "strategic_proposal" || kind === "agent_proposal") {
    if ((extra?.urgencyScore ?? 0) > 85) return "red";
    return "amber";
  }

  // Status surfaces.
  if (kind === "pillar_health" || kind === "job_health" || kind === "budget_burn") return "running_fine";

  // Trust graduation — promotions are positive status, demotions need eyes.
  if (kind === "tier_promotion") return "running_fine";
  if (kind === "tier_demotion") return "amber";

  return "amber";
}
