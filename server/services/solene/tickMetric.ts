/**
 * SOLENE — tick metric: the two numbers every cycle opens with.
 *
 * Kernel-restructure work-order step 5 (founder directive 2026-07-13):
 * "The Letter and the tick's own success criteria must open with two
 * numbers every cycle: (a) customer-visible/revenue-relevant outcomes
 * shipped, (b) founder decisions consumed vs. budget. A machine graded
 * only on restraint optimizes for restraint."
 *
 * The budget is CONSTITUTIONAL — FOUNDER_MINUTES_BUDGET from the
 * sovereign-protocol immutables loader (classABDecisionsPerWeek),
 * never a local constant that can drift from the amendment process.
 *
 * HONESTY CONTRACT — what metric (a) counts and what it does NOT:
 *
 *   COUNTED:     solene_dispatch_queue rows that reached status
 *                'completed' in the trailing 7 days, excluding internal
 *                machinery (code_review / self_debug / adversarial_test)
 *                — i.e. real agent work with an outward work product.
 *
 *   NOT COUNTED: production deploys and merged PRs (not tracked in the
 *                DB today), reflex-layer autonomic actions, and content
 *                that shipped through any path other than the dispatch
 *                queue. The breakdown string says so explicitly, so a
 *                founder reading the number knows the counter's blind
 *                spots. When those sources gain honest DB records they
 *                should be folded in here — never estimated.
 *
 * Metric (b) counts what the autonomy-score (v14) tables record over the
 * trailing 7 days: cascade resolutions that escalated to the founder
 * (cascade_resolutions.founder_escalated) plus founder overrides
 * (founder_overrides). Decisions are not yet classified A/B/C per row,
 * so EVERY founder-consumed decision counts against the Class-A/B
 * budget — conservative: it can overcount founder attention, never
 * undercount it. Founder-collab asks that never left the Solene surface
 * are NOT double-counted here.
 *
 * Week = trailing 7 days from `now` (injectable for tests). Both metrics
 * re-apply the window in process so the arithmetic is pinned by unit
 * tests independent of the SQL layer; the SQL WHERE clauses keep the
 * scans cheap in production.
 */

import { and, eq, gte } from "drizzle-orm";
import { db } from "../../db";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { cascadeResolutions, founderOverrides } from "@shared/schema";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dispatch source types that improve the machine rather than ship anything
 * a customer (or the revenue line) can see. Excluded from metric (a).
 */
const INTERNAL_DISPATCH_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "code_review",
  "self_debug",
  "adversarial_test",
]);

export interface TickMetric {
  /** Metric (a): completed outward dispatches in the trailing 7 days. */
  revenueRelevantShippedThisWeek: number;
  /** Plain-language account of what (a) counted — and its blind spots. */
  shippedBreakdown: string;
  /** Metric (b): founder decisions consumed in the trailing 7 days. */
  founderDecisionsThisWeek: number;
  /** Constitutional weekly Class-A/B decision budget. */
  founderDecisionsBudget: number;
  /** Provenance of the budget — always the sovereign-protocol immutables. */
  budgetSource: "constitution";
}

/**
 * Compute the two numbers for the trailing 7 days ending at `now`.
 *
 * Throws on a genuine read failure — callers (the Letter, the tick, the
 * morning pulse) degrade to an explicit "unmeasured" line rather than a
 * fabricated zero.
 */
export async function getTickMetric(now: Date = new Date()): Promise<TickMetric> {
  const weekStart = new Date(now.getTime() - WEEK_MS);

  // ── Metric (a): completed outward dispatches, trailing 7 days ────────────
  const dispatchRows = await db
    .select({
      status: soleneDispatchQueue.status,
      sourceType: soleneDispatchQueue.sourceType,
      completedAt: soleneDispatchQueue.completedAt,
    })
    .from(soleneDispatchQueue)
    .where(
      and(
        eq(soleneDispatchQueue.status, "completed"),
        gte(soleneDispatchQueue.completedAt, weekStart),
      ),
    );

  const shipped = dispatchRows.filter(
    (r) =>
      r.status === "completed" &&
      r.completedAt != null &&
      inTrailingWeek(r.completedAt, now) &&
      !INTERNAL_DISPATCH_SOURCE_TYPES.has(r.sourceType),
  ).length;

  // ── Metric (b): founder decisions consumed, trailing 7 days ─────────────
  const escalationRows = await db
    .select({
      founderEscalated: cascadeResolutions.founderEscalated,
      createdAt: cascadeResolutions.createdAt,
    })
    .from(cascadeResolutions)
    .where(
      and(
        eq(cascadeResolutions.founderEscalated, true),
        gte(cascadeResolutions.createdAt, weekStart),
      ),
    );

  const overrideRows = await db
    .select({ createdAt: founderOverrides.createdAt })
    .from(founderOverrides)
    .where(gte(founderOverrides.createdAt, weekStart));

  const founderDecisionsThisWeek =
    escalationRows.filter(
      (r) => r.founderEscalated === true && r.createdAt != null && inTrailingWeek(r.createdAt, now),
    ).length +
    overrideRows.filter((r) => r.createdAt != null && inTrailingWeek(r.createdAt, now)).length;

  return {
    revenueRelevantShippedThisWeek: shipped,
    shippedBreakdown: renderShippedBreakdown(shipped),
    founderDecisionsThisWeek,
    founderDecisionsBudget: FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek,
    budgetSource: "constitution",
  };
}

/**
 * The canonical two-number opener. Used verbatim as the first content line
 * of The Letter; the tick logs the same fields as structured metadata.
 */
export function renderTickMetricLine(m: TickMetric): string {
  return (
    `Shipped for customers this week: ${m.revenueRelevantShippedThisWeek} (${m.shippedBreakdown}). ` +
    `Founder decisions consumed: ${m.founderDecisionsThisWeek} of ${m.founderDecisionsBudget} budget.`
  );
}

function renderShippedBreakdown(shipped: number): string {
  // Honest about the blind spots in every rendering — including zero.
  const notCounted = "deploys and merged PRs not counted yet";
  return shipped === 0
    ? `no completed outward dispatches; ${notCounted}`
    : `${shipped} completed outward dispatch${shipped === 1 ? "" : "es"}; internal review/debug machinery excluded; ${notCounted}`;
}

function inTrailingWeek(ts: Date, now: Date): boolean {
  const t = ts.getTime();
  return t > now.getTime() - WEEK_MS && t <= now.getTime();
}
