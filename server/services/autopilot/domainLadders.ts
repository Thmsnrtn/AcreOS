/**
 * Founder Autopilot — domain action ladders (the discipline, applied everywhere).
 *
 * Each facet expresses its options as a ladder under the ONE universal
 * discipline (actionLadder.ts): cheapest/safest/most-reversible effective action
 * first; escalate to costlier/riskier/irreversible only as evidence + earned
 * trust justify. This is what makes the autopilot reason at the same elite
 * caliber in every domain, not just marketing.
 *
 * These are illustrative, real ladders for the core domains; the same shape
 * extends to engineering (monitor → safe-patch → witnessed-fix → founder),
 * compliance, and beyond. Pure data + thin selectors → testable.
 */
import { climbLadder, type LadderRung, type LadderChoice } from "./actionLadder";

// ── Support ──────────────────────────────────────────────────────────────────
export interface SupportCtx {
  /** AI resolver confidence (0..1). */
  aiConfidence: number;
  reopened: boolean;
  complexity: "low" | "high";
}

export const SUPPORT_LADDER: ReadonlyArray<LadderRung<SupportCtx>> = [
  {
    id: "auto_resolve", label: "AI auto-resolve", rung: 0, cost: "free", reversible: true, requiresEarnedAutonomy: false,
    available: () => true,
    justified: (c) => c.aiConfidence >= 0.8 && c.complexity === "low" && !c.reopened,
  },
  {
    id: "drafted_reply", label: "Draft a reply for the founder's tap", rung: 1, cost: "cheap", reversible: true, requiresEarnedAutonomy: true,
    available: () => true,
    justified: (c) => c.aiConfidence < 0.8 && !c.reopened,
  },
  {
    id: "escalate_founder", label: "Escalate to the founder", rung: 2, cost: "costly", reversible: true, requiresEarnedAutonomy: false,
    available: () => true,
    // The always-valid last resort: a support ticket must never be dropped. As
    // the top rung it's only chosen when no cheaper rung qualified.
    justified: () => true,
  },
];

// ── Finance ──────────────────────────────────────────────────────────────────
export interface FinanceCtx {
  paymentFailed: boolean;
  retryExhausted: boolean;
  retentionCritical: boolean;
}

export const FINANCE_LADDER: ReadonlyArray<LadderRung<FinanceCtx>> = [
  {
    id: "dunning_retry", label: "Retry the charge (reversible)", rung: 0, cost: "free", reversible: true, requiresEarnedAutonomy: false,
    available: (c) => c.paymentFailed,
    justified: (c) => c.paymentFailed && !c.retryExhausted,
  },
  {
    id: "courtesy_credit", label: "Goodwill credit (irreversible, ≤$50)", rung: 1, cost: "costly", reversible: false, requiresEarnedAutonomy: true,
    available: () => true,
    justified: (c) => c.retryExhausted && c.retentionCritical,
  },
];

// ── Growth (mirrors the marketing free-first/paid-when-proven discipline) ─────
export interface GrowthCtx {
  publishEnabled: boolean;
  realIntent: boolean;
  funnelProven: boolean;
  paidProvider: boolean;
}

export const GROWTH_LADDER: ReadonlyArray<LadderRung<GrowthCtx>> = [
  {
    id: "owned_content", label: "Publish owned content (free SEO)", rung: 0, cost: "free", reversible: true, requiresEarnedAutonomy: false,
    available: (c) => c.publishEnabled,
    justified: () => true,
  },
  {
    id: "witnessed_outbound", label: "Witnessed outbound to real intent", rung: 1, cost: "cheap", reversible: true, requiresEarnedAutonomy: true,
    available: () => true,
    justified: (c) => c.realIntent,
  },
  {
    id: "paid_ads", label: "Paid amplification", rung: 2, cost: "costly", reversible: false, requiresEarnedAutonomy: true,
    available: (c) => c.paidProvider,
    justified: (c) => c.funnelProven,
  },
];

// ── Thin per-domain selectors ────────────────────────────────────────────────
export function chooseSupportAction(ctx: SupportCtx, earned: (id: string) => boolean = () => false): LadderChoice<SupportCtx> {
  return climbLadder(SUPPORT_LADDER, ctx, earned);
}
export function chooseFinanceAction(ctx: FinanceCtx, earned: (id: string) => boolean = () => false): LadderChoice<FinanceCtx> {
  return climbLadder(FINANCE_LADDER, ctx, earned);
}
export function chooseGrowthAction(ctx: GrowthCtx, earned: (id: string) => boolean = () => false): LadderChoice<GrowthCtx> {
  return climbLadder(GROWTH_LADDER, ctx, earned);
}
