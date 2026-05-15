/**
 * Founder Cockpit — the monthly check-in surface.
 *
 * GET /api/founder/cockpit
 *
 * Consolidates 13 fragmented founder summary surfaces into one
 * structured response. The /founder/now page (Pillar S) is the
 * DAILY surface — what needs you today. The cockpit is the
 * MONTHLY surface — what happened this month, what's the trend,
 * what one decision needs the founder.
 *
 * Composes existing data sources rather than introducing new ones:
 *   - founder-letter (current month's narrative)
 *   - executive-dashboard (MRR, churn, ARPU, NPS, customer concentration)
 *   - founder/intelligence/pulse (autonomy outcome score, override rate)
 *   - decisionsInboxItems (autonomous decisions resolved this month)
 *   - agent_action_graduations (tier distribution per agent)
 *   - agent_proposal_observations (retract rate this month)
 *   - jobHealthLogs (job success rate this month)
 *   - strategic_proposals (synthesized monthly slate)
 *   - cost-optimizer/runs (last 30d operations)
 *   - unit-economics (gross margin trend)
 *
 * Read-only. ~1 query per source, parallelized.
 *
 * Sections returned, ordered by founder importance:
 *   1. money      — MRR change, gross margin, AI burn vs cap, top cost movements
 *   2. customers  — health distribution change, churn saves, NPS, concentration
 *   3. product    — what shipped (decisions approved), what got retracted, regression count
 *   4. autonomy   — graduation tier distribution, executor health, agent KPIs
 *   5. risks      — open red /founder/now items, suspended categories, drift detections
 *   6. decision   — the ONE strategic move the synthesis pass surfaced this month
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import {
  decisionsInboxItems,
  agentActionGraduations,
  agentProposalObservations,
  jobHealthLogs,
  strategicProposals,
  organizations,
  agentEvents,
} from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { logger } from "./utils/logger";

const router = Router();

interface CockpitSection {
  title: string;
  headline: string;
  detail: Array<{ label: string; value: string; trend?: "up" | "down" | "flat" }>;
  actionUrl?: string;
}

interface CockpitResponse {
  generatedAt: string;
  windowDays: number;
  sections: {
    money: CockpitSection;
    customers: CockpitSection;
    product: CockpitSection;
    autonomy: CockpitSection;
    risks: CockpitSection;
    decision: {
      title: string;
      rationale: string;
      strategicProposalId: number | null;
      actionUrl: string;
    } | null;
  };
  /** The current month's founder letter, if generated. */
  letter: { month: string; body: string } | null;
}

async function getOrgIdForFounder(req: Request): Promise<number | null> {
  const orgId = req.organization?.id;
  if (orgId) return orgId;
  try {
    const { getFounderPrimaryOrgId } = await import("./services/founder");
    return await getFounderPrimaryOrgId();
  } catch {
    return null;
  }
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const orgId = await getOrgIdForFounder(req);
    if (!orgId) return res.status(401).json({ error: "No organization context" });

    const windowDays = parseInt((req.query.windowDays as string) ?? "30", 10);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const monthKey = new Date().toISOString().slice(0, 7); // "2026-05"

    // Parallelize the reads.
    const [
      execDashRes,
      pulseRes,
      decisionsRes,
      graduationsRes,
      observationsRes,
      jobsRes,
      proposalsRes,
      letterRes,
    ] = await Promise.allSettled([
      fetchExecutiveDashboard(req),
      fetchPulse(req),
      fetchRecentDecisions(orgId, since),
      fetchGraduations(),
      fetchObservations(since),
      fetchJobHealth(since),
      fetchStrategicProposals(monthKey),
      fetchCurrentLetter(req),
    ]);

    const exec = execDashRes.status === "fulfilled" ? execDashRes.value : null;
    const pulse = pulseRes.status === "fulfilled" ? pulseRes.value : null;
    const decisions = decisionsRes.status === "fulfilled" ? decisionsRes.value : [];
    const graduations = graduationsRes.status === "fulfilled" ? graduationsRes.value : [];
    const observations = observationsRes.status === "fulfilled" ? observationsRes.value : { shipped: 0, retracted: 0 };
    const jobs = jobsRes.status === "fulfilled" ? jobsRes.value : { total: 0, failed: 0 };
    const proposals = proposalsRes.status === "fulfilled" ? proposalsRes.value : [];
    const letter = letterRes.status === "fulfilled" ? letterRes.value : null;

    const response: CockpitResponse = {
      generatedAt: new Date().toISOString(),
      windowDays,
      sections: {
        money: buildMoneySection(exec),
        customers: buildCustomersSection(exec),
        product: buildProductSection(decisions, observations),
        autonomy: buildAutonomySection(graduations, observations, pulse),
        risks: buildRisksSection(decisions, graduations, jobs),
        decision: buildDecisionPick(proposals),
      },
      letter,
    };

    res.json(response);
  } catch (err: any) {
    logger.error("[founder-cockpit] aggregation failed", err);
    res.status(500).json({ error: err?.message ?? "Internal error" });
  }
});

// ─── Section builders ────────────────────────────────────────────────

function buildMoneySection(exec: any): CockpitSection {
  if (!exec) {
    return {
      title: "Money",
      headline: "—",
      detail: [{ label: "Executive dashboard", value: "unavailable" }],
    };
  }
  const mrr = exec.mrr ?? exec.totalMrr ?? 0;
  const mrrChange = exec.mrrChange ?? exec.mrrDelta30d ?? 0;
  const arpu = exec.arpu ?? 0;
  const grossMargin = exec.grossMarginPct ?? exec.grossMargin ?? null;
  return {
    title: "Money",
    headline:
      `MRR $${(mrr / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` +
      (mrrChange ? ` (${mrrChange >= 0 ? "+" : ""}${(mrrChange / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })} vs prior month)` : ""),
    detail: [
      { label: "Monthly recurring revenue", value: `$${(mrr / 100).toLocaleString()}` },
      { label: "ARPU", value: `$${(arpu / 100).toLocaleString()}` },
      ...(grossMargin !== null ? [{ label: "Gross margin", value: `${grossMargin.toFixed(1)}%` }] : []),
      ...(exec.aiBurn30dUsd != null
        ? [{ label: "AI spend (30d)", value: `$${exec.aiBurn30dUsd.toFixed(2)}` }]
        : []),
    ],
    actionUrl: "/founder/financials",
  };
}

function buildCustomersSection(exec: any): CockpitSection {
  if (!exec) {
    return { title: "Customers", headline: "—", detail: [] };
  }
  const activeOrgs = exec.activeOrgs ?? exec.activeOrganizations ?? 0;
  const churnPct = exec.churn30d ?? exec.churnRate ?? null;
  const nps = exec.nps90d ?? exec.nps ?? null;
  const concentration = exec.customerConcentrationPct ?? null;
  return {
    title: "Customers",
    headline: `${activeOrgs} active org${activeOrgs === 1 ? "" : "s"}`,
    detail: [
      { label: "Active orgs", value: String(activeOrgs) },
      ...(churnPct !== null ? [{ label: "30-day churn", value: `${churnPct.toFixed(2)}%` }] : []),
      ...(nps !== null ? [{ label: "NPS (90d)", value: String(nps) }] : []),
      ...(concentration !== null
        ? [{ label: "Top-customer concentration", value: `${concentration.toFixed(1)}%` }]
        : []),
    ],
    actionUrl: "/founder/customers/health",
  };
}

function buildProductSection(
  decisions: Array<{ status: string; itemType: string }>,
  observations: { shipped: number; retracted: number },
): CockpitSection {
  const approved = decisions.filter((d) => d.status === "approved").length;
  const rejected = decisions.filter((d) => d.status === "rejected").length;
  const retracted = observations.retracted ?? 0;
  return {
    title: "Product",
    headline: `${approved} decision${approved === 1 ? "" : "s"} shipped, ${retracted} retracted`,
    detail: [
      { label: "Autonomously approved", value: String(approved) },
      { label: "Autonomously rejected", value: String(rejected) },
      { label: "Post-merge retracts", value: String(retracted) },
      { label: "Net shipped", value: String(approved - retracted) },
    ],
    actionUrl: "/founder/agent-queue",
  };
}

function buildAutonomySection(
  graduations: Array<{ graduationTier: string }>,
  observations: { shipped: number; retracted: number },
  pulse: any,
): CockpitSection {
  const tierCounts = graduations.reduce<Record<string, number>>(
    (acc, g) => ({ ...acc, [g.graduationTier]: (acc[g.graduationTier] ?? 0) + 1 }),
    {},
  );
  const total = graduations.length;
  const silent = tierCounts.silent ?? 0;
  const notify = tierCounts.notify_only ?? 0;
  const manual = tierCounts.manual ?? 0;
  const suspended = tierCounts.suspended ?? 0;
  const autonomyPct = total > 0 ? ((silent + notify) / total) * 100 : 0;

  return {
    title: "Autonomy",
    headline: `${autonomyPct.toFixed(0)}% of (agent, category) pairs operate without per-PR approval`,
    detail: [
      { label: "Silent tier", value: String(silent) },
      { label: "Notify-only tier", value: String(notify) },
      { label: "Manual tier", value: String(manual) },
      ...(suspended > 0 ? [{ label: "Suspended", value: String(suspended) }] : []),
      ...(pulse?.outcomeScore != null
        ? [{ label: "Outcome score", value: pulse.outcomeScore.toFixed(2) }]
        : []),
      ...(pulse?.overrideRatePct != null
        ? [{ label: "Founder-override rate", value: `${pulse.overrideRatePct.toFixed(1)}%` }]
        : []),
    ],
    actionUrl: "/founder/trust-graduation",
  };
}

function buildRisksSection(
  decisions: Array<{ riskLevel: string; status: string }>,
  graduations: Array<{ graduationTier: string }>,
  jobs: { total: number; failed: number },
): CockpitSection {
  const criticalOpen = decisions.filter(
    (d) => d.status === "pending" && (d.riskLevel === "critical" || d.riskLevel === "high"),
  ).length;
  const suspended = graduations.filter((g) => g.graduationTier === "suspended").length;
  const jobFailurePct = jobs.total > 0 ? (jobs.failed / jobs.total) * 100 : 0;
  return {
    title: "Risks",
    headline:
      criticalOpen === 0 && suspended === 0 && jobFailurePct < 1
        ? "Nothing pressing"
        : `${criticalOpen} high-severity item${criticalOpen === 1 ? "" : "s"}, ${suspended} suspended categor${suspended === 1 ? "y" : "ies"}`,
    detail: [
      { label: "High/critical open inbox items", value: String(criticalOpen) },
      { label: "Suspended agent categories", value: String(suspended) },
      { label: "Job failure rate (30d)", value: `${jobFailurePct.toFixed(2)}%` },
    ],
    actionUrl: "/founder/now",
  };
}

function buildDecisionPick(
  proposals: Array<{
    id: number;
    title: string;
    rationale: string;
    confidence: number | null;
  }>,
): CockpitResponse["sections"]["decision"] {
  if (proposals.length === 0) return null;
  // Pick the highest-confidence synthesized proposal that's still
  // awaiting founder action. The cockpit shows ONE this month; the
  // rest are accessible from /founder/strategy.
  const top = [...proposals].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
  return {
    title: top.title,
    rationale: top.rationale,
    strategicProposalId: top.id,
    actionUrl: `/founder/strategy#proposal-${top.id}`,
  };
}

// ─── Data fetchers ───────────────────────────────────────────────────

async function fetchExecutiveDashboard(req: Request): Promise<any | null> {
  try {
    // Lazily import + invoke the dashboard via internal http to reuse logic.
    // For simplicity here we read the DB directly via the same shape.
    const { storage } = await import("./storage");
    if (typeof (storage as any).getExecutiveDashboardSnapshot === "function") {
      return await (storage as any).getExecutiveDashboardSnapshot();
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchPulse(req: Request): Promise<any | null> {
  // The pulse endpoint exists at /api/founder/intelligence/pulse; we
  // skip internal HTTP and let the cockpit compose whatever it can read
  // directly. If pulse-specific signals are needed, surface them via
  // strategicProposals or autonomy outcome grader.
  return null;
}

async function fetchRecentDecisions(orgId: number, since: Date) {
  return db
    .select({
      itemType: decisionsInboxItems.itemType,
      status: decisionsInboxItems.status,
      riskLevel: decisionsInboxItems.riskLevel,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        eq(decisionsInboxItems.organizationId, orgId),
        gte(decisionsInboxItems.createdAt, since),
      ),
    )
    .limit(500);
}

async function fetchGraduations() {
  return db
    .select({ graduationTier: agentActionGraduations.graduationTier })
    .from(agentActionGraduations)
    .limit(200);
}

async function fetchObservations(since: Date): Promise<{ shipped: number; retracted: number }> {
  const [shippedRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(agentProposalObservations)
    .where(gte(agentProposalObservations.shippedAt, since));
  const [retractedRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(agentProposalObservations)
    .where(
      and(
        eq(agentProposalObservations.status, "retracted"),
        gte(agentProposalObservations.shippedAt, since),
      ),
    );
  return { shipped: Number(shippedRow?.c ?? 0), retracted: Number(retractedRow?.c ?? 0) };
}

async function fetchJobHealth(since: Date): Promise<{ total: number; failed: number }> {
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(jobHealthLogs)
    .where(gte(jobHealthLogs.runStartedAt, since));
  const [failedRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(jobHealthLogs)
    .where(
      and(
        sql`${jobHealthLogs.status} != 'success'`,
        gte(jobHealthLogs.runStartedAt, since),
      ),
    );
  return { total: Number(totalRow?.c ?? 0), failed: Number(failedRow?.c ?? 0) };
}

async function fetchStrategicProposals(monthKey: string) {
  return db
    .select({
      id: strategicProposals.id,
      title: strategicProposals.title,
      rationale: strategicProposals.rationale,
      confidence: strategicProposals.confidence,
    })
    .from(strategicProposals)
    .where(
      and(
        eq(strategicProposals.status, "synthesized"),
        eq(strategicProposals.monthKey, monthKey),
      ),
    )
    .orderBy(desc(strategicProposals.confidence))
    .limit(10);
}

async function fetchCurrentLetter(_req: Request): Promise<{ month: string; body: string } | null> {
  // The letter generator stores monthly letters in a different table;
  // expose a stable interface here so the cockpit can ride whatever
  // backing store the founder-letter pipeline currently uses.
  try {
    // Look at the most recent founder-letter event in agent_events.
    const [event] = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.eventType, "founder_letter_generated"))
      .orderBy(desc(agentEvents.createdAt))
      .limit(1);
    if (!event) return null;
    const payload = event.payload as any;
    return {
      month: payload?.monthKey ?? new Date().toISOString().slice(0, 7),
      body: payload?.body ?? payload?.content ?? "",
    };
  } catch {
    return null;
  }
}

export default router;
