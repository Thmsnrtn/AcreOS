/**
 * Pillar R — Trust graduation founder admin.
 *
 * GET /api/founder/graduation — list all (agent, category) tiers
 * POST /api/founder/graduation/override — flip a specific (agent, category) tier
 *
 * Closes the visibility-and-control loop on Pillar R. Without these
 * endpoints the founder can see graduations happen in /founder/now but
 * has no way to force-promote a category they've watched succeed outside
 * the system, or freeze a category at manual after a near-miss.
 *
 * Founder-only — gate is the same isAuthenticated + isFounder check used
 * by the cockpit. Mutation is structured and logged so every tier flip
 * lands in agent_events for the audit trail.
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { agentActionGraduations, agentEvents } from "@shared/schema";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";
import { logger } from "./utils/logger";
import { overrideTier } from "./services/trustGraduation";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(agentActionGraduations)
      .orderBy(desc(agentActionGraduations.tierChangedAt))
      .limit(500);
    res.json({
      generatedAt: new Date().toISOString(),
      rows: rows.map((r) => ({
        id: r.id,
        agentCodename: r.agentCodename,
        actionCategory: r.actionCategory,
        graduationTier: r.graduationTier,
        consecutiveAccepted: r.consecutiveAccepted,
        consecutiveRetracted: r.consecutiveRetracted,
        totalAccepted: r.totalAccepted,
        totalRetracted: r.totalRetracted,
        founderOverride: r.founderOverride,
        tierChangedAt: r.tierChangedAt,
      })),
    });
  } catch (err: any) {
    logger.error("[founder-graduation] list failed", err);
    Errors.internal(res, err);
  }
});

const overrideSchema = z.object({
  agentCodename: z.string().min(1).max(60),
  actionCategory: z.string().min(1).max(60),
  tier: z.enum(["manual", "notify_only", "silent", "suspended"]),
  override: z.enum(["force_silent", "freeze_manual"]).nullable().optional(),
});

router.post("/override", async (req: Request, res: Response) => {
  const parsed = overrideSchema.safeParse(req.body);
  if (!parsed.success) {
    return Errors.badRequest(res, "Invalid input", parsed.error.flatten());
  }
  const { agentCodename, actionCategory, tier, override } = parsed.data;
  try {
    await overrideTier(agentCodename, actionCategory, tier, override ?? null);
    // Surface the override in agent_events so /founder/now (Source 4) can
    // pick it up as a status signal that the founder explicitly intervened.
    await db.insert(agentEvents).values({
      organizationId: req.organization?.id ?? 0,
      eventType: "tier_override_by_founder",
      eventSource: "founder_graduation_admin",
      payload: {
        agentCodename,
        actionCategory,
        tier,
        override: override ?? null,
        title: `Founder set ${agentCodename}:${actionCategory} → ${tier}`,
        message: override
          ? `Override flag: ${override}. This tier is pinned until the founder clears the flag.`
          : `No override flag — tier will continue auto-graduating from here.`,
      },
    });
    res.json({ ok: true });
  } catch (err: any) {
    logger.error("[founder-graduation] override failed", err);
    Errors.internal(res, err);
  }
});

export default router;
