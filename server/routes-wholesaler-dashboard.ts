/**
 * Wholesaler dashboard endpoint (W-5).
 *
 * Trey: "It's hardcoded mock data. […] If I see those exact numbers and
 * I have zero deals in the system, I lose trust in everything around it.
 * Replace the mock or hide the widget until you have data."
 *
 * Replaces WHOLESALER_MOCK in client/src/components/dashboard/
 * type-specific-widgets.tsx with real org-scoped queries:
 *
 *   - assignmentFees: sum(analysisResults.netProfit) for closed deals
 *                     (closest proxy we have for assignment-fee total)
 *   - avgAssignmentFee: mean across closed deals
 *   - speedToClose: avg (closingDate - offerDate) in days for closed
 *                   deals — Trey's days-on-contract KPI
 *   - buyerListHealth: total / active (last contact ≤ 90d) / stale
 *   - dealFunnel: counts by canonical stage (Leads / Under Contract /
 *                 Assigned / Closed)
 *
 * Returns hasData=false when the org has zero deals. Client uses that
 * to suppress the widget rather than display zero-y mock-shaped tiles.
 */

import type { Express, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { deals, leads, buyerProfiles } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerWholesalerDashboardRoutes(app: Express): void {
  app.get(
    "/api/wholesaler/dashboard",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);

        // Total + closed-deal stats. Pull all closed deals and aggregate
        // in-process to keep the SQL simple and fold the analysisResults
        // jsonb extraction client-side. Wholesalers' deal volumes are
        // small enough (≤ low hundreds annually) that this is fine.
        const closedDeals = await db
          .select({
            offerDate: deals.offerDate,
            closingDate: deals.closingDate,
            analysisResults: deals.analysisResults,
            acceptedAmount: deals.acceptedAmount,
          })
          .from(deals)
          .where(and(
            eq(deals.organizationId, orgId),
            eq(deals.status, "closed"),
          ));

        let totalAssignmentFeesCents = 0;
        let speedToCloseDaysSum = 0;
        let speedToCloseDaysCount = 0;
        for (const d of closedDeals) {
          const netProfit = (d.analysisResults as any)?.netProfit;
          if (typeof netProfit === "number" && isFinite(netProfit)) {
            totalAssignmentFeesCents += Math.round(netProfit * 100);
          }
          if (d.offerDate && d.closingDate) {
            const days = Math.round(
              (new Date(d.closingDate).getTime() - new Date(d.offerDate).getTime()) / 86_400_000,
            );
            if (days >= 0 && days < 365) {
              speedToCloseDaysSum += days;
              speedToCloseDaysCount++;
            }
          }
        }
        const avgAssignmentFeeCents = closedDeals.length > 0
          ? Math.round(totalAssignmentFeesCents / closedDeals.length)
          : 0;
        const speedToCloseDays = speedToCloseDaysCount > 0
          ? Math.round(speedToCloseDaysSum / speedToCloseDaysCount)
          : null;

        // Buyer list health.
        const [{ totalBuyers = 0 } = {}] = await db
          .select({ totalBuyers: sql<number>`COUNT(*)::int` })
          .from(buyerProfiles)
          .where(eq(buyerProfiles.organizationId, orgId));
        // 'active' = lastContactDate within 90 days. The field is in
        // engagement jsonb; pull all rows and filter in process (small
        // dataset, simple code).
        const allBuyers = await db
          .select({
            engagement: buyerProfiles.engagement,
          })
          .from(buyerProfiles)
          .where(eq(buyerProfiles.organizationId, orgId));
        const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
        let activeBuyers = 0;
        for (const b of allBuyers) {
          const lcd = (b.engagement as any)?.lastContactDate;
          if (typeof lcd === "string") {
            const t = new Date(lcd).getTime();
            if (isFinite(t) && t >= ninetyDaysAgo) activeBuyers++;
          }
        }
        const staleBuyers = Math.max(0, Number(totalBuyers) - activeBuyers);

        // Deal funnel — Leads / Under Contract (accepted) / Assigned
        // (in_escrow) / Closed.
        const [{ leadsCount = 0 } = {}] = await db
          .select({ leadsCount: sql<number>`COUNT(*)::int` })
          .from(leads)
          .where(eq(leads.organizationId, orgId));

        const dealCountsByStatus = await db
          .select({
            status: deals.status,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(deals)
          .where(eq(deals.organizationId, orgId))
          .groupBy(deals.status);

        const acceptedCount = dealCountsByStatus.find((r) => r.status === "accepted")?.count ?? 0;
        const inEscrowCount = dealCountsByStatus.find((r) => r.status === "in_escrow")?.count ?? 0;
        const closedCount = closedDeals.length;

        const hasData =
          closedCount > 0 ||
          acceptedCount > 0 ||
          inEscrowCount > 0 ||
          Number(totalBuyers) > 0;

        return res.json({
          hasData,
          assignmentFeesCents: totalAssignmentFeesCents,
          avgAssignmentFeeCents,
          speedToCloseDays,
          buyerListHealth: {
            total: Number(totalBuyers),
            active: activeBuyers,
            stale: staleBuyers,
          },
          dealFunnel: [
            { stage: "Leads",          count: Number(leadsCount) },
            { stage: "Under Contract", count: Number(acceptedCount) },
            { stage: "Assigned",       count: Number(inEscrowCount) },
            { stage: "Closed",         count: Number(closedCount) },
          ],
        });
      } catch (err) {
        logger.error("wholesaler.dashboard failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
