/**
 * /api/county-coverage — customer-facing parcel-coverage request + status.
 *
 * The binary coverage gap (a parcel outside the ~34 seeded counties returns
 * nothing) is closed demand-first. When the maps surface gets a no-endpoint
 * miss it renders a "request this county" CTA; that CTA POSTs here. We:
 *   - record the per-org request (county_coverage_requests),
 *   - enqueue the (state, county) for priority background discovery
 *     (county_discovery_queue, demand-bumped + priority-boosted),
 *   - return the current discovery status so the UI can say
 *     "we're on it" / "already covered".
 *
 * The discovery worker (runScheduledJobs → runDiscoveryQueueDrain) does the
 * actual ArcGIS probe + endpoint insertion; this route only captures demand.
 *
 * Pattern: isAuthenticated + getOrCreateOrg, AuthenticatedRequest, Errors.*.
 * No founder gate — this is a customer (Pax-persona) surface behind the Map door.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import { dbForReads } from "./db-replica";
import {
  countyCoverageRequests,
  countyDiscoveryQueue,
  countyGisEndpoints,
} from "@shared/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  enqueueCountyForDiscovery,
  normalizeState,
  normalizeCounty,
} from "./services/coverageLedger";

const requestSchema = z.object({
  state: z.string().trim().min(2).max(2),
  county: z.string().trim().min(1).max(120),
});

/**
 * Resolve the live coverage/discovery status for a normalized (state, county).
 * Shared by POST (the response) and GET (status polling).
 */
async function resolveStatus(
  state: string,
  county: string,
): Promise<{
  covered: boolean;
  status: "covered" | "discovering" | "queued" | "pending" | "unavailable" | "none";
  queueId: number | null;
  demandCount: number | null;
  message: string;
}> {
  const reader = await dbForReads("county-coverage.status");

  const active = await reader
    .select({ id: countyGisEndpoints.id })
    .from(countyGisEndpoints)
    .where(
      and(
        eq(countyGisEndpoints.state, state),
        sql`lower(regexp_replace(${countyGisEndpoints.county}, ' county$', '', 'i')) = ${county}`,
        eq(countyGisEndpoints.isActive, true),
      ),
    )
    .limit(1);

  if (active.length > 0) {
    return {
      covered: true,
      status: "covered",
      queueId: null,
      demandCount: null,
      message: "This county already has free parcel coverage.",
    };
  }

  const queued = await reader
    .select({
      id: countyDiscoveryQueue.id,
      status: countyDiscoveryQueue.status,
      demandCount: countyDiscoveryQueue.demandCount,
    })
    .from(countyDiscoveryQueue)
    .where(
      and(
        eq(countyDiscoveryQueue.state, state),
        eq(countyDiscoveryQueue.county, county),
      ),
    )
    .limit(1);

  if (queued.length === 0) {
    return {
      covered: false,
      status: "none",
      queueId: null,
      demandCount: null,
      message: "Not yet requested.",
    };
  }

  const q = queued[0];
  const statusMap: Record<string, { status: any; message: string }> = {
    pending: { status: "discovering", message: "We're searching for a free parcel source for this county." },
    in_progress: { status: "discovering", message: "We're searching for a free parcel source for this county." },
    failed: { status: "discovering", message: "We're still working on coverage for this county." },
    resolved: { status: "covered", message: "Coverage is now live for this county." },
    exhausted: { status: "unavailable", message: "No free parcel source is currently available for this county." },
  };
  const mapped = statusMap[q.status] ?? {
    status: "queued" as const,
    message: "Your request is queued for discovery.",
  };

  return {
    covered: q.status === "resolved",
    status: mapped.status,
    queueId: q.id,
    demandCount: q.demandCount,
    message: mapped.message,
  };
}

export function registerCountyCoverageRoutes(app: Express) {
  // POST /api/county-coverage/request — capture a customer's coverage request
  // and enqueue it for priority discovery. Body: { state, county }.
  app.post(
    "/api/county-coverage/request",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error);
      }

      try {
        const organizationId = getOrganizationId(req);
        const userId = getUserId(req);
        const state = normalizeState(parsed.data.state);
        const county = normalizeCounty(parsed.data.county);

        if (!state || !county) {
          return Errors.badRequest(res, "A valid state and county are required.");
        }

        // Enqueue with a customer-priority boost so customer-requested
        // counties jump ahead of system-miss counties in the crawl order.
        const enqueue = await enqueueCountyForDiscovery(state, county, {
          organizationId,
          priorityBoost: 100,
        });

        // Record the per-org request ledger row (idempotent-ish: one open
        // request per org/county — bump nothing, just log demand explicitly).
        let requestId: number | null = null;
        if (!enqueue.alreadyCovered) {
          const existing = await db
            .select({ id: countyCoverageRequests.id })
            .from(countyCoverageRequests)
            .where(
              and(
                eq(countyCoverageRequests.organizationId, organizationId),
                eq(countyCoverageRequests.state, state),
                eq(countyCoverageRequests.county, county),
                eq(countyCoverageRequests.status, "pending"),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            requestId = existing[0].id;
          } else {
            const ins = await db
              .insert(countyCoverageRequests)
              .values({
                organizationId,
                requestedByUserId: userId,
                state,
                county,
                status: "pending",
                queueId: enqueue.queueId,
              })
              .returning({ id: countyCoverageRequests.id });
            requestId = ins[0]?.id ?? null;
          }
        }

        const status = await resolveStatus(state, county);

        logger.info("[county-coverage] request captured", {
          metadata: {
            organizationId,
            state,
            county,
            alreadyCovered: enqueue.alreadyCovered,
            queueId: enqueue.queueId,
            demandCount: enqueue.demandCount,
          },
        });

        return res.status(enqueue.alreadyCovered ? 200 : 202).json({
          state,
          county,
          requestId,
          ...status,
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  // GET /api/county-coverage/status?state=TX&county=Harris — poll current
  // coverage/discovery status for a (state, county). The maps surface can use
  // this to update the CTA without re-submitting.
  app.get(
    "/api/county-coverage/status",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = requestSchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error);
      }
      try {
        const state = normalizeState(parsed.data.state);
        const county = normalizeCounty(parsed.data.county);
        if (!state || !county) {
          return Errors.badRequest(res, "A valid state and county are required.");
        }
        const status = await resolveStatus(state, county);
        return res.json({ state, county, ...status });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  // GET /api/county-coverage/my-requests — the requesting org's own coverage
  // request history (so the UI can show "you asked for these / here's status").
  app.get(
    "/api/county-coverage/my-requests",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const organizationId = getOrganizationId(req);
        const reader = await dbForReads("county-coverage.my-requests");
        const rows = await reader
          .select({
            id: countyCoverageRequests.id,
            state: countyCoverageRequests.state,
            county: countyCoverageRequests.county,
            status: countyCoverageRequests.status,
            createdAt: countyCoverageRequests.createdAt,
          })
          .from(countyCoverageRequests)
          .where(eq(countyCoverageRequests.organizationId, organizationId))
          .orderBy(desc(countyCoverageRequests.createdAt))
          .limit(100);
        return res.json({ requests: rows });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
