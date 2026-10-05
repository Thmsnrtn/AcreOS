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
  countyLiveSourceCopy,
  countyQueueStatusCopy,
  type CountyListStatus,
} from "@shared/geo/countyStatus";
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
 * Resolve the live coverage/discovery status for a normalized (state, county),
 * in the one county vocabulary (shared/geo/countyStatus.ts) the list builder
 * also speaks. Shared by POST (the response) and GET (status polling).
 *
 * An active endpoint is `covered` only when its licence permits saving
 * records ('yes' / 'attribution'); an unreviewed one is `view_only` — still a
 * live source (`covered: true` below means "parcel lookups answer here"), but
 * not one whose records may be saved. The old union also named a `pending`
 * status that no branch ever returned; it is gone.
 */
async function resolveStatus(
  state: string,
  county: string,
): Promise<{
  covered: boolean;
  status: CountyListStatus;
  label: string;
  queueId: number | null;
  demandCount: number | null;
  message: string;
}> {
  const reader = await dbForReads("county-coverage.status");

  const active = await reader
    .select({ id: countyGisEndpoints.id, redistributable: countyGisEndpoints.redistributable })
    .from(countyGisEndpoints)
    .where(
      and(
        eq(countyGisEndpoints.state, state),
        sql`lower(regexp_replace(${countyGisEndpoints.county}, ' county$', '', 'i')) = ${county}`,
        eq(countyGisEndpoints.isActive, true),
      ),
    );

  if (active.length > 0) {
    // Any saveable row makes the county covered; otherwise it is view-only —
    // "terms not reviewed yet", or, when every source was reviewed and
    // declined ('no'), saying so (countyLiveSourceCopy).
    return {
      covered: true,
      ...countyLiveSourceCopy(active.map((e) => e.redistributable)),
      queueId: null,
      demandCount: null,
    };
  }

  const queued = await reader
    .select({
      id: countyDiscoveryQueue.id,
      status: countyDiscoveryQueue.status,
      attempts: countyDiscoveryQueue.attempts,
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

  const q = queued[0] ?? null;
  // Reached only when NO endpoint is active, so a `resolved` queue row is
  // coverage that went dark — not coverage (DEFECT-0113). The shared copy says
  // so, and that re-requesting re-opens discovery — the same words the list
  // builder shows.
  const { status, label, message } = countyQueueStatusCopy(q);
  return {
    covered: false,
    status,
    label,
    queueId: q?.id ?? null,
    demandCount: q?.demandCount ?? null,
    message,
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
