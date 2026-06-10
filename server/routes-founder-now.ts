/**
 * Pillar S — One inbox.
 *
 * GET /api/founder/now
 *
 * Aggregates every source the founder used to check across 7 separate
 * routes (/founder/agent-queue, /founder/strategy, /founder/decisions,
 * /founder/notifications, /founder/feed, /founder/todo, /founder/daily-
 * digest) into one structured response. Applies the per-org daily
 * attention cap (organizations.founderDailyAttentionCap) and defers
 * overflow.
 *
 * Read-only — the resolve/defer mutations live on the existing surfaces
 * we're consolidating from. Section + sort + cap are the value-add.
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { db } from "./db";
import {
  decisionsInboxItems,
  strategicProposals,
  jobHealthLogs,
  organizations,
  agentEvents,
  agentActionGraduations,
} from "@shared/schema";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { logger } from "./utils/logger";
import { applyBudget, classifyKind, type InboxItem } from "./services/founderInboxBudget";

const router = Router();

// Helper: pull the founder's primary org. Reuses Pillar K helper.
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

    // Read the cap from the org row (default 5).
    const [org] = await db
      .select({ cap: organizations.founderDailyAttentionCap })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    const dailyCap = org?.cap ?? 5;

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86_400_000);

    const candidates: InboxItem[] = [];

    // ── Source 1: decisions_inbox_items (pending, not deferred-to-future)
    const inboxRows = await db
      .select()
      .from(decisionsInboxItems)
      .where(
        and(
          eq(decisionsInboxItems.organizationId, orgId),
          eq(decisionsInboxItems.status, "pending"),
        ),
      )
      .orderBy(desc(decisionsInboxItems.urgencyScore))
      .limit(50);
    for (const row of inboxRows) {
      if (row.deferredUntil && row.deferredUntil > now) continue;
      candidates.push({
        id: `inbox:${row.id}`,
        section: classifyKind("agent_proposal", { urgencyScore: row.urgencyScore ?? 0 }),
        kind: "agent_proposal",
        title: row.recommendedActionLabel,
        body: row.sophieAnalysis,
        priority: row.urgencyScore ?? 50,
        actionUrl: `/founder/decisions#item-${row.id}`,
        ownerAgentCodename: row.ownerAgentCodename ?? undefined,
      });
    }

    // ── Source 2: strategic_proposals (synthesized monthly slate)
    const stratRows = await db
      .select()
      .from(strategicProposals)
      .where(eq(strategicProposals.status, "synthesized"))
      .orderBy(desc(strategicProposals.confidence))
      .limit(10);
    for (const row of stratRows) {
      const urgency = (row.confidence ?? 0) * 100;
      candidates.push({
        id: `strategic:${row.id}`,
        section: classifyKind("strategic_proposal", { urgencyScore: urgency }),
        kind: "strategic_proposal",
        title: row.title,
        body: row.rationale,
        priority: Math.min(100, urgency),
        actionUrl: `/founder/strategy#proposal-${row.id}`,
        ownerAgentCodename: row.proposedBy,
      });
    }

    // ── Source 3: job-health failures in the last 24h
    const dayAgo = new Date(now.getTime() - 86_400_000);
    try {
      const jobFails = await db
        .select()
        .from(jobHealthLogs)
        .where(
          and(
            gte(jobHealthLogs.runStartedAt, dayAgo),
            sql`${jobHealthLogs.status} != 'success'`,
          ),
        )
        .orderBy(desc(jobHealthLogs.runStartedAt))
        .limit(20);
      for (const row of jobFails) {
        candidates.push({
          id: `job:${row.id}`,
          section: "running_fine",
          kind: "job_health",
          title: `Job: ${row.jobName} — ${row.status}`,
          body: row.errorMessage ?? "Background job reported a non-success status",
          priority: 30,
          actionUrl: `/founder/job-health#job-${row.jobName}`,
        });
      }
    } catch {
      // jobHealthLogs schema may shift over time; skip cleanly if read fails.
    }

    // ── Source 4: recent auth/secret-revoked agent_events
    try {
      const recentSecrets = await db
        .select()
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.organizationId, orgId),
            sql`${agentEvents.eventType} IN ('secret_revoked','deploy_failed','regression_detected')`,
            gte(agentEvents.createdAt, dayAgo),
          ),
        )
        .orderBy(desc(agentEvents.createdAt))
        .limit(10);
      for (const row of recentSecrets) {
        candidates.push({
          id: `event:${row.id}`,
          section: "red",
          kind: row.eventType as InboxItem["kind"],
          title: ((row.payload as any)?.title as string) ?? `${row.eventType}`,
          body: ((row.payload as any)?.message as string) ?? "",
          priority: 95,
          actionUrl: ((row.payload as any)?.actionUrl as string) ?? `/founder/now#${row.id}`,
        });
      }
    } catch {
      /* shape drift — skip */
    }

    // ── Source 5: trust-graduation tier changes in the last 24h
    // Promotions are positive status (running_fine); demotions are amber.
    // Suspensions already surfaced via Source 4 (regression_detected event).
    try {
      const tierChanges = await db
        .select()
        .from(agentActionGraduations)
        .where(gte(agentActionGraduations.tierChangedAt, dayAgo))
        .orderBy(desc(agentActionGraduations.tierChangedAt))
        .limit(20);
      for (const row of tierChanges) {
        const tier = row.graduationTier;
        const isPromotion = tier === "notify_only" || tier === "silent";
        const isDemotion = tier === "suspended" || (tier === "manual" && row.totalRetracted > 0);
        if (!isPromotion && !isDemotion) continue;
        if (tier === "suspended") continue; // already covered by retract-cron red surface
        candidates.push({
          id: `grad:${row.id}`,
          section: isPromotion ? "running_fine" : "amber",
          kind: isPromotion ? "tier_promotion" : "tier_demotion",
          title: isPromotion
            ? `${row.agentCodename} graduated → ${tier} on ${row.actionCategory}`
            : `${row.agentCodename} demoted → ${tier} on ${row.actionCategory}`,
          body: isPromotion
            ? `${row.totalAccepted} accepted, ${row.totalRetracted} retracted lifetime.`
            : `${row.consecutiveRetracted} consecutive retracts. Confirm the demotion was warranted.`,
          priority: isPromotion ? 25 : 60,
          actionUrl: `/founder/cockpit#autonomy`,
          ownerAgentCodename: row.agentCodename,
        });
      }
    } catch {
      /* table may not exist yet on older deploys — skip */
    }

    const result = applyBudget(candidates, { dailyCap, redItemsAlwaysSurface: true });

    res.json({
      generatedAt: now.toISOString(),
      tomorrowResetsAt: tomorrow.toISOString(),
      dailyCap,
      ...result,
    });
  } catch (err: any) {
    logger.error("[founder-now] aggregation failed", err);
    Errors.internal(res, err);
  }
});

export default router;
