/**
 * Buyer match analytics + freshness (W-6).
 *
 * Trey: "Given the buyer_property_matches.status enum is already there,
 * surface a 'deal X had 14 buyers presented → 6 interested → 1 purchased'
 * funnel per assignment. Then aggregate: 'your 30-day average is 38%
 * buyer interest rate; market average is 24%.'"
 *
 * + freshness: "Flag buyers I haven't pinged in 90 days; auto-send a
 * re-engagement email; auto-deactivate after 180 days of silence with
 * my approval."
 *
 * Endpoints:
 *   GET  /api/buyer-analytics                — per-blast funnel + 30d
 *                                              aggregate interest rate
 *   GET  /api/buyer-profiles/freshness       — bucketed by last-contact age
 *   POST /api/buyer-profiles/:id/deactivate  — soft-archive a stale buyer
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  buyerBlasts,
  buyerBlastRecipients,
  buyerProfiles,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerBuyerAnalyticsRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── Per-blast funnel + 30d aggregate ──────────────────────────────────────
  app.get(
    "/api/buyer-analytics",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const days = Math.min(365, Math.max(7, parseInt(String(req.query.days ?? "30"), 10) || 30));
        const since = new Date(Date.now() - days * 86_400_000);

        // Pull recent blasts with their recipient counts grouped by status.
        // Aggregating client-side for simplicity (small datasets per org).
        const recentBlasts = await db
          .select()
          .from(buyerBlasts)
          .where(and(
            eq(buyerBlasts.organizationId, orgId),
            sql`${buyerBlasts.createdAt} >= ${since}`,
          ))
          .orderBy(desc(buyerBlasts.createdAt));

        const blastIds = recentBlasts.map((b) => b.id);
        const recipientCounts = blastIds.length === 0 ? [] : await db
          .select({
            blastId: buyerBlastRecipients.blastId,
            status: buyerBlastRecipients.status,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(buyerBlastRecipients)
          .where(and(
            eq(buyerBlastRecipients.organizationId, orgId),
            sql`${buyerBlastRecipients.blastId} IN ${blastIds}`,
          ))
          .groupBy(buyerBlastRecipients.blastId, buyerBlastRecipients.status);

        // Per-blast funnel.
        const perBlast = recentBlasts.map((b) => {
          const counts = recipientCounts.filter((r) => r.blastId === b.id);
          const presented = counts.reduce((s, r) =>
            s + (r.status === "sent" || r.status === "delivered" || r.status === "opened" ||
                 r.status === "replied_interested" || r.status === "replied_not_interested"
              ? Number(r.count) : 0), 0);
          const interested = counts.find((r) => r.status === "replied_interested")?.count ?? 0;
          const notInterested = counts.find((r) => r.status === "replied_not_interested")?.count ?? 0;
          return {
            blastId: b.id,
            subject: b.subject,
            propertyId: b.propertyId,
            presented,
            interested: Number(interested),
            notInterested: Number(notInterested),
            interestRate: presented > 0 ? Number(interested) / presented : 0,
            createdAt: b.createdAt,
          };
        });

        // Aggregate.
        const totalPresented = perBlast.reduce((s, p) => s + p.presented, 0);
        const totalInterested = perBlast.reduce((s, p) => s + p.interested, 0);
        const aggregateInterestRate = totalPresented > 0 ? totalInterested / totalPresented : 0;

        return res.json({
          windowDays: days,
          blastCount: perBlast.length,
          totalPresented,
          totalInterested,
          aggregateInterestRate,
          perBlast,
        });
      } catch (err) {
        logger.error("buyerAnalytics.summary failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Buyer freshness ──────────────────────────────────────────────────────
  app.get(
    "/api/buyer-profiles/freshness",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select()
          .from(buyerProfiles)
          .where(eq(buyerProfiles.organizationId, orgId));

        const now = Date.now();
        const buckets = {
          fresh: [] as typeof rows,         // ≤ 30 days
          warming: [] as typeof rows,       // 31-90 days
          stale: [] as typeof rows,         // 91-180 days
          deactivation_candidate: [] as typeof rows,  // > 180 days
          unknown: [] as typeof rows,       // no lastContactDate
        };

        for (const b of rows) {
          const lcd = (b.engagement as any)?.lastContactDate;
          if (typeof lcd !== "string") {
            buckets.unknown.push(b);
            continue;
          }
          const t = new Date(lcd).getTime();
          if (!isFinite(t)) { buckets.unknown.push(b); continue; }
          const daysAgo = (now - t) / 86_400_000;
          if (daysAgo <= 30) buckets.fresh.push(b);
          else if (daysAgo <= 90) buckets.warming.push(b);
          else if (daysAgo <= 180) buckets.stale.push(b);
          else buckets.deactivation_candidate.push(b);
        }

        return res.json({
          totalBuyers: rows.length,
          counts: {
            fresh: buckets.fresh.length,
            warming: buckets.warming.length,
            stale: buckets.stale.length,
            deactivationCandidate: buckets.deactivation_candidate.length,
            unknown: buckets.unknown.length,
          },
          // Return only the lists the wholesaler is most likely to act on.
          stale: buckets.stale.map(toClientShape),
          deactivationCandidates: buckets.deactivation_candidate.map(toClientShape),
        });
      } catch (err) {
        logger.error("buyerFreshness failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Deactivate a buyer ───────────────────────────────────────────────────
  // Trey: "auto-deactivate after 180 days of silence with my approval."
  // Approval = the user clicking the deactivate button.
  app.post(
    "/api/buyer-profiles/:id/deactivate",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return Errors.badRequest(res, "Invalid buyer id");

        // We don't add a separate "active" column — just stash the
        // deactivation signal in engagement so reads see it. UIs that
        // already read engagement get this for free.
        const [existing] = await db
          .select({ engagement: buyerProfiles.engagement })
          .from(buyerProfiles)
          .where(and(eq(buyerProfiles.id, id), eq(buyerProfiles.organizationId, orgId)))
          .limit(1);
        if (!existing) return Errors.notFound(res, "Buyer");

        const newEngagement = {
          ...((existing.engagement as any) ?? {}),
          deactivatedAt: new Date().toISOString(),
        };

        const [row] = await db
          .update(buyerProfiles)
          .set({ engagement: newEngagement, updatedAt: new Date() })
          .where(and(eq(buyerProfiles.id, id), eq(buyerProfiles.organizationId, orgId)))
          .returning();
        return res.json({ buyer: row });
      } catch (err) {
        logger.error("buyerDeactivate failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}

function toClientShape(b: typeof buyerProfiles.$inferSelect) {
  return {
    id: b.id,
    name: (b as any).name,
    email: (b as any).email,
    phone: (b as any).phone,
    lastContactDate: (b.engagement as any)?.lastContactDate ?? null,
    deactivatedAt: (b.engagement as any)?.deactivatedAt ?? null,
    matchesCount: 0, // can be filled in later
  };
}
