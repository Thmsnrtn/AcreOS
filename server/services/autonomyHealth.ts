/**
 * Autonomy Health — the single signal that answers
 * "can I trust the system to run without me right now?"
 *
 * Built for the "1 hour per month of founder attention" goal. The
 * founder shouldn't have to sift through decision logs, briefings,
 * agent activity, budget summaries, and safety status to know whether
 * they need to intervene. They should glance at one color.
 *
 * The color is computed from 5 dimensions, each rolled up into a
 * traffic-light band:
 *
 *   1. Pending queue depth — how many decisions are sitting in the
 *      founder inbox unresolved? Green <5, yellow <15, red >=15.
 *   2. Founder intervention rate — how often has the founder
 *      overridden / reversed an auto-decision? Green <1/week,
 *      yellow <1/day, red >=1/day.
 *   3. Avg outcome score — rolling 14-day avg of graded decision
 *      outcomes (-2 to +2). Green ≥0.5, yellow ≥0, red <0.
 *   4. Agent health — any agent silent >3 days? any agent with
 *      trust dropping fast? Green all stable, yellow 1 concern,
 *      red 2+ or any critical.
 *   5. Safety-rail trip rate — hard-cap hits, guardrail-stops,
 *      anomaly escalations. Normal: <3/week. Many trips (>10/week)
 *      means the system is reaching for unsafe actions a lot —
 *      escalate for review.
 *
 * The worst single dimension drives the overall color. Yellow bands
 * don't compound — one yellow + four greens is still yellow, not red.
 * Two reds is red. One red is red. (Red is always red.)
 *
 * This service ships two things the founder uses:
 *   - GET /api/founder/intelligence/autonomy-health — machine-readable
 *   - A card on the founder dashboard (one color, one verdict line)
 *
 * And one thing agents use internally:
 *   - gradeRecentDecisions() — called by a daily cron to close the
 *     outcome-grading loop so trust scores evolve.
 */

import { db } from "../db";
import {
  decisionsInboxItems,
  companyAgents,
  agentActionLog,
  financialApprovals,
  spendAnomalies,
} from "@shared/schema";
import { eq, and, gte, lt, sql, desc, isNull, isNotNull } from "drizzle-orm";
import { logger } from "../utils/logger";

export type Band = "green" | "yellow" | "red";

export interface AutonomyHealthReport {
  generatedAt: string;
  band: Band;
  verdict: string;
  dimensions: {
    pendingQueue: DimensionResult;
    founderInterventionRate: DimensionResult;
    avgOutcomeScore: DimensionResult;
    agentHealth: DimensionResult;
    safetyRailTripRate: DimensionResult;
  };
  recommendedAction: string;
}

export interface DimensionResult {
  band: Band;
  value: number | string;
  threshold: string;
  note: string;
}

function worst(bands: Band[]): Band {
  if (bands.includes("red")) return "red";
  if (bands.includes("yellow")) return "yellow";
  return "green";
}

/**
 * Per-dimension graders — each returns a DimensionResult with its
 * current value + band + a one-line layperson note.
 */

async function gradePendingQueue(): Promise<DimensionResult> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.status, "pending"));
  const count = Number(row?.c ?? 0);
  const band: Band = count >= 15 ? "red" : count >= 5 ? "yellow" : "green";
  return {
    band,
    value: count,
    threshold: "green <5, yellow <15, red ≥15",
    note:
      count === 0
        ? "Nothing in your queue — system is handling everything on its own."
        : count < 5
          ? `${count} decision${count > 1 ? "s" : ""} waiting on you — manageable.`
          : count < 15
            ? `${count} decisions waiting. Worth a look this week.`
            : `${count} decisions backed up. System is over-escalating or you've been away too long.`,
  };
}

async function gradeFounderInterventionRate(): Promise<DimensionResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(decisionsInboxItems)
    .where(
      and(
        gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
        isNotNull(decisionsInboxItems.founderOverrideAction),
      ),
    );
  const count = Number(row?.c ?? 0);
  const band: Band = count >= 7 ? "red" : count >= 1 ? "yellow" : "green";
  return {
    band,
    value: count,
    threshold: "green <1/week, yellow 1-6/week, red ≥7/week",
    note:
      count === 0
        ? "You haven't had to override anything this week."
        : count < 7
          ? `You overrode ${count} decision${count > 1 ? "s" : ""} this week — normal calibration.`
          : `You overrode ${count} decisions this week. That's daily intervention — the system isn't matching your judgment yet.`,
  };
}

async function gradeAvgOutcomeScore(): Promise<DimensionResult> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ score: decisionsInboxItems.outcomeScore })
    .from(decisionsInboxItems)
    .where(
      and(
        gte(decisionsInboxItems.outcomeRecordedAt, fourteenDaysAgo),
        isNotNull(decisionsInboxItems.outcomeScore),
      ),
    );
  if (rows.length === 0) {
    return {
      band: "yellow",
      value: "n/a",
      threshold: "green ≥0.5, yellow ≥0, red <0",
      note:
        "No decisions graded yet — the outcome-grading job hasn't closed the loop on anything. Run the grader.",
    };
  }
  const avg = rows.reduce((s, r) => s + (r.score ?? 0), 0) / rows.length;
  const rounded = Math.round(avg * 100) / 100;
  const band: Band = avg < 0 ? "red" : avg < 0.5 ? "yellow" : "green";
  return {
    band,
    value: rounded,
    threshold: "green ≥0.5, yellow 0-0.5, red <0",
    note:
      avg >= 0.5
        ? `Decisions are landing positive (${rounded}/2). System is choosing well.`
        : avg >= 0
          ? `Decisions are about neutral (${rounded}/2). Not bad, not great — review a sample.`
          : `Decisions are trending negative (${rounded}/2). Something's systematically off.`,
  };
}

async function gradeAgentHealth(): Promise<DimensionResult> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const agents = await db.select().from(companyAgents).where(eq(companyAgents.status, "active"));
  if (agents.length === 0) {
    return {
      band: "red",
      value: "0 agents",
      threshold: "green all active, red any silent >3d or trust <40",
      note:
        "Zero agents active. The 12-agent board hasn't been seeded or has been paused.",
    };
  }
  const recentActions = await db
    .select({ agentCodename: agentActionLog.agentCodename, c: sql<number>`count(*)::int` })
    .from(agentActionLog)
    .where(gte(agentActionLog.createdAt, threeDaysAgo))
    .groupBy(agentActionLog.agentCodename);
  const active = new Set(recentActions.map((r) => r.agentCodename));
  const silent = agents.filter((a) => !active.has(a.codename));
  const lowTrust = agents.filter((a) => a.trustScore < 40);
  const concerns = silent.length + lowTrust.length;
  const band: Band = concerns >= 2 || lowTrust.length > 0 ? "red" : concerns === 1 ? "yellow" : "green";
  return {
    band,
    value: `${agents.length} active, ${silent.length} silent 3d+, ${lowTrust.length} low-trust`,
    threshold: "green all healthy, yellow 1 concern, red 2+ or any low-trust",
    note:
      concerns === 0
        ? `All ${agents.length} agents active and trusted.`
        : `${silent.length} agent${silent.length === 1 ? "" : "s"} silent 3+ days${lowTrust.length ? `, ${lowTrust.length} below trust floor` : ""}. Check if they have work to do or if something's blocking them.`,
  };
}

async function gradeSafetyRailTripRate(): Promise<DimensionResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [guardrailRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.resolvedBy, "hard_guardrail"),
        gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
      ),
    );
  const guardrailTrips = Number(guardrailRow?.c ?? 0);

  const [anomalyRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(spendAnomalies)
    .where(gte(spendAnomalies.createdAt, sevenDaysAgo));
  const anomalyCount = Number(anomalyRow?.c ?? 0);

  const [approvalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(financialApprovals)
    .where(
      and(
        eq(financialApprovals.status, "expired"),
        gte(financialApprovals.updatedAt, sevenDaysAgo),
      ),
    );
  const expiredApprovals = Number(approvalRow?.c ?? 0);

  const total = guardrailTrips + anomalyCount + expiredApprovals;
  const band: Band = total >= 10 ? "red" : total >= 3 ? "yellow" : "green";
  return {
    band,
    value: total,
    threshold: "green <3/week, yellow 3-9/week, red ≥10/week",
    note:
      total < 3
        ? "Safety rails rarely tripped — system is mostly operating in its authority zone."
        : total < 10
          ? `Safety rails tripped ${total} times (guardrail:${guardrailTrips} anomaly:${anomalyCount} expired:${expiredApprovals}). Normal range; review what's reaching for limits.`
          : `Safety rails tripped ${total} times — the system is frequently reaching for actions the rails block. Either thresholds are wrong or something's off.`,
  };
}

/**
 * Top-level roll-up. Called by the API route and by the cron job.
 */
export async function getAutonomyHealth(): Promise<AutonomyHealthReport> {
  const [pendingQueue, founderInterventionRate, avgOutcomeScore, agentHealth, safetyRailTripRate] =
    await Promise.all([
      gradePendingQueue(),
      gradeFounderInterventionRate(),
      gradeAvgOutcomeScore(),
      gradeAgentHealth(),
      gradeSafetyRailTripRate(),
    ]);
  const band = worst([
    pendingQueue.band,
    founderInterventionRate.band,
    avgOutcomeScore.band,
    agentHealth.band,
    safetyRailTripRate.band,
  ]);
  const verdict =
    band === "green"
      ? "System is running itself. No action needed from you."
      : band === "yellow"
        ? "System is mostly autonomous but something is off. Spend 15 minutes reviewing the yellow dimensions."
        : "System needs your attention. At least one dimension is failing — intervene now.";

  const worstDim =
    band === "red"
      ? Object.entries({
          pendingQueue,
          founderInterventionRate,
          avgOutcomeScore,
          agentHealth,
          safetyRailTripRate,
        }).find(([, d]) => d.band === "red")
      : band === "yellow"
        ? Object.entries({
            pendingQueue,
            founderInterventionRate,
            avgOutcomeScore,
            agentHealth,
            safetyRailTripRate,
          }).find(([, d]) => d.band === "yellow")
        : null;
  const recommendedAction = worstDim
    ? `Review: ${worstDim[0]} — ${worstDim[1].note}`
    : "Nothing specific. Glance at the decision log if you want reassurance.";

  return {
    generatedAt: new Date().toISOString(),
    band,
    verdict,
    dimensions: {
      pendingQueue,
      founderInterventionRate,
      avgOutcomeScore,
      agentHealth,
      safetyRailTripRate,
    },
    recommendedAction,
  };
}

/**
 * Outcome grader — closes the learning loop by automatically scoring
 * decisions 3+ days after they resolved. Heuristics:
 *
 *   +2  no new related decisions in the window AND no negative trend
 *   +1  related decision count unchanged
 *    0  one related decision surfaced but not critical
 *   -1  multiple related decisions surfaced
 *   -2  founder manually reversed OR customer complaint logged
 *
 * This service is intentionally modest — real outcome grading needs
 * business-context rubrics per decision category. The default here
 * errs on neutral (+0) when signal is ambiguous so a noisy grading
 * loop doesn't unfairly punish agent trust.
 */
export async function gradeRecentDecisions(): Promise<{ graded: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(
      and(
        isNotNull(decisionsInboxItems.resolvedAt),
        gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
        lt(decisionsInboxItems.resolvedAt, threeDaysAgo),
        isNull(decisionsInboxItems.outcomeScore),
      ),
    );

  let graded = 0;
  for (const row of rows) {
    let score = 0;
    let outcome = "Graded by auto-outcome heuristic.";

    // Founder reversed? hard negative.
    if (
      row.founderOverrideAction === "reverse" ||
      row.founderOverrideAction === "reject"
    ) {
      score = -2;
      outcome = "Founder reversed this decision — system chose poorly.";
    } else if (row.resolvedBy === "hard_guardrail") {
      // Hard-guardrail stops are a system WIN, not a decision failure.
      score = 2;
      outcome = "Safety rail correctly blocked an unsafe proposal.";
    } else if (row.resolvedBy === "autonomous_executor" && row.status === "auto_resolved") {
      // See if the same org/entity has surfaced new decisions since.
      const related = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(decisionsInboxItems)
        .where(
          and(
            row.organizationId
              ? eq(decisionsInboxItems.organizationId, row.organizationId)
              : sql`1=1`,
            eq(decisionsInboxItems.itemType, row.itemType),
            gte(decisionsInboxItems.createdAt, row.resolvedAt!),
          ),
        );
      const count = Number(related[0]?.c ?? 0);
      if (count === 0) {
        score = 2;
        outcome = "No recurrence — the fix stuck.";
      } else if (count === 1) {
        score = 0;
        outcome = "One related decision surfaced since. Partial fix.";
      } else {
        score = -1;
        outcome = `${count} related decisions surfaced since — the fix didn't fully resolve the issue.`;
      }
    } else {
      // Human-resolved without override; assume neutral.
      score = 1;
      outcome = "Human-resolved, no reversal needed.";
    }

    await db
      .update(decisionsInboxItems)
      .set({
        outcomeScore: score,
        actualOutcome: outcome,
        outcomeRecordedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, row.id));
    graded++;
  }

  if (graded > 0) {
    logger.info(`[autonomyHealth] graded ${graded} decisions`, {
      metadata: { graded },
    });
  }
  return { graded };
}
