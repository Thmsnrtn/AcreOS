/**
 * Support Customer Context API
 *
 * Powers the right-side context sidebar inside the customer-support
 * inbox. Whenever an operator opens a case, this endpoint returns the
 * everything-you-need-to-feel-prepared snapshot of the customer org:
 *
 *   - Org details (tier, MRR, signup date)
 *   - Recent activity (last 5 audit_events for that org)
 *   - Open ticket count (support_cases not in resolved/closed)
 *   - Notes (most-recent support_messages with role='human_support'
 *     across the org's other cases — the closest thing we have to
 *     "previous interaction notes" today)
 *
 * Endpoint:
 *   GET /api/admin/support/customer-context/:organizationId
 */

import { Router, type Response } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  organizations,
  supportCases,
  supportMessages,
  auditEvents,
} from "@shared/schema";
import { Errors } from "./utils/errors";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import type { AuthenticatedRequest } from "./types/request";

const router = Router();

router.get("/:organizationId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = parseInt(req.params.organizationId, 10);
    if (isNaN(orgId)) return Errors.badRequest(res, "Invalid organizationId");

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return Errors.notFound(res, "Organization");

    // Tier → MRR estimate. monthlyRevenueCentsFor handles yearly→monthly
    // normalisation so the figure stays comparable for the support sidebar.
    const mrrCents = monthlyRevenueCentsFor(
      org.subscriptionTier,
      (org.billingInterval as "monthly" | "yearly") || "monthly"
    );

    // Open ticket count
    const allCasesForOrg = await db
      .select({ id: supportCases.id, status: supportCases.status })
      .from(supportCases)
      .where(eq(supportCases.organizationId, orgId));
    const openTickets = allCasesForOrg.filter(
      (c) => c.status !== "resolved" && c.status !== "closed"
    ).length;

    // Recent activity — last 5 audit events with target_type=organization for this org
    const recentActivity = await db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorEmail: auditEvents.actorEmail,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetType, "organization"),
          eq(auditEvents.targetId, String(orgId))
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(5);

    // Notes from previous interactions — last 5 human_support messages
    // across the org's cases (excluding the case currently in view, if
    // provided as ?excludeCaseId=N).
    const excludeCaseIdRaw = req.query.excludeCaseId;
    const excludeCaseId =
      typeof excludeCaseIdRaw === "string" && /^\d+$/.test(excludeCaseIdRaw)
        ? parseInt(excludeCaseIdRaw, 10)
        : null;
    const caseIds = allCasesForOrg.map((c) => c.id).filter((id) => id !== excludeCaseId);
    let notes: Array<{ id: number; caseId: number; content: string; createdAt: Date | null }> = [];
    if (caseIds.length > 0) {
      const rows = await db
        .select({
          id: supportMessages.id,
          caseId: supportMessages.caseId,
          content: supportMessages.content,
          createdAt: supportMessages.createdAt,
        })
        .from(supportMessages)
        .where(
          and(
            eq(supportMessages.role, "human_support"),
            inArray(supportMessages.caseId, caseIds)
          )
        )
        .orderBy(desc(supportMessages.createdAt))
        .limit(5);
      notes = rows;
    }

    res.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        tier: org.subscriptionTier,
        billingInterval: org.billingInterval,
        subscriptionStatus: org.subscriptionStatus,
        mrrCents,
        signupDate: org.createdAt,
        dunningStage: org.dunningStage,
        isFounder: org.isFounder,
      },
      openTickets,
      recentActivity,
      notes,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
