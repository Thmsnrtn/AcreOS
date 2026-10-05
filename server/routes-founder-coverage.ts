/**
 * /api/founder/coverage — county-GIS coverage ledger (FOUNDER-ONLY).
 *
 * Answers the question the open-data strategy hinges on: "what fraction of the
 * counties our customers actually touch have a working free parcel endpoint?"
 * — and surfaces the demand-ranked discovery queue (the crawl order) so the
 * founder can see coverage growing along real demand instead of alphabetically.
 *
 * Reads the ledger from getCoverageLedger() (left-joins distinct (state,county)
 * from properties + parcel_snapshots against active county_gis_endpoints) and a
 * snapshot of the live discovery queue.
 *
 * Also the founder's COUNTY LICENCE REVIEW (W10.3): whether an org may save a
 * county's parcel records into its own CRM is a founder licensing decision
 * (Beatrice rule — every endpoint ships 'review-required', and the list
 * builder saves only from 'yes' / 'attribution'). Code never decides it:
 *   GET   /api/founder/county-endpoints?status=<posture>  the review queue;
 *   PATCH /api/founder/county-endpoints/:id/licence       the decision, with
 *         a note (and, for 'attribution', the credit line — refused without
 *         one). WHO and WHEN land on the row (reviewed_by / reviewed_at); the
 *         note, the old and the new posture land in the hash-chained
 *         audit_events trail in the SAME transaction as the change — both or
 *         neither.
 *
 * Pattern: isAuthenticated + getOrCreateOrg + requireFounder — same gate as
 * routes-founder-pulse.ts.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import { dbForReads } from "./db-replica";
import { countyDiscoveryQueue, countyGisEndpoints } from "@shared/schema";
import { count, desc, eq, sql } from "drizzle-orm";
import { getCoverageLedger } from "./services/coverageLedger";
import { chainAndInsertAuditEvent } from "./utils/auditEventsChain";
import { actorFromRequest } from "./utils/auditLog";
import type { RedistributePosture } from "./services/providers/types";

/** Every licence posture a county endpoint can hold (providers/types.ts RedistributePosture). */
const LICENCE_POSTURES = ["yes", "attribution", "no", "review-required"] as const satisfies readonly RedistributePosture[];

/** The most endpoints one review-queue read returns; `total` says how many there are. */
const ENDPOINTS_PAGE = 200;

const listQuerySchema = z.object({ status: z.enum(LICENCE_POSTURES).optional() }).strict();
const licenceBodySchema = z
  .object({
    redistributable: z.enum(LICENCE_POSTURES),
    note: z.string().trim().min(10).max(1000),
    /** The credit line the source's terms require (county_gis_endpoints.attribution). */
    attribution: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export function registerFounderCoverageRoutes(app: Express) {
  app.get(
    "/api/founder/coverage",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const reader = await dbForReads("founder.coverage.ledger");

        const ledger = await getCoverageLedger();

        // Seeded-endpoint totals (independent of demand) so the founder sees
        // both "of the counties customers touch" AND "total seeded counties".
        const endpointTotals = await reader
          .select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) FILTER (WHERE ${countyGisEndpoints.isActive} = true)::int`,
            reviewRequired: sql<number>`count(*) FILTER (WHERE ${countyGisEndpoints.redistributable} = 'review-required')::int`,
          })
          .from(countyGisEndpoints);

        // Live discovery-queue snapshot (the demand-ranked crawl order).
        const queue = await reader
          .select({
            id: countyDiscoveryQueue.id,
            state: countyDiscoveryQueue.state,
            county: countyDiscoveryQueue.county,
            demandCount: countyDiscoveryQueue.demandCount,
            priority: countyDiscoveryQueue.priority,
            status: countyDiscoveryQueue.status,
            attempts: countyDiscoveryQueue.attempts,
            lastResult: countyDiscoveryQueue.lastResult,
            lastAttemptAt: countyDiscoveryQueue.lastAttemptAt,
          })
          .from(countyDiscoveryQueue)
          .orderBy(
            desc(countyDiscoveryQueue.priority),
            desc(countyDiscoveryQueue.demandCount),
          )
          .limit(100);

        const queueByStatus = queue.reduce<Record<string, number>>((acc, q) => {
          acc[q.status] = (acc[q.status] ?? 0) + 1;
          return acc;
        }, {});

        logger.info("[founder-coverage] served", {
          metadata: {
            coveragePct: ledger.coveragePct,
            demandCounties: ledger.totalCounties,
            queueDepth: queue.length,
          },
        });

        return res.json({
          asOf: new Date().toISOString(),
          // Coverage of the counties customers ACTUALLY touch (the metric that matters).
          demandCoverage: {
            totalCounties: ledger.totalCounties,
            coveredCounties: ledger.coveredCounties,
            coveragePct: ledger.coveragePct,
            counties: ledger.counties,
          },
          // Total seeded endpoints (have-it side, regardless of demand).
          endpoints: {
            total: endpointTotals[0]?.total ?? 0,
            active: endpointTotals[0]?.active ?? 0,
            reviewRequired: endpointTotals[0]?.reviewRequired ?? 0,
          },
          // The demand-ranked discovery queue — the crawl order.
          discoveryQueue: {
            depth: queue.length,
            byStatus: queueByStatus,
            items: queue,
          },
        });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  app.get(
    "/api/founder/county-endpoints",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.badRequest(res, `status must be one of: ${LICENCE_POSTURES.join(", ")}.`, parsed.error.issues);
      }
      try {
        const reader = await dbForReads("founder.county-endpoints.review");
        const where = parsed.data.status ? eq(countyGisEndpoints.redistributable, parsed.data.status) : undefined;
        const [{ n }] = await reader.select({ n: count() }).from(countyGisEndpoints).where(where);
        const endpoints = await reader
          .select({
            id: countyGisEndpoints.id,
            state: countyGisEndpoints.state,
            county: countyGisEndpoints.county,
            baseUrl: countyGisEndpoints.baseUrl,
            redistributable: countyGisEndpoints.redistributable,
            attribution: countyGisEndpoints.attribution,
            isActive: countyGisEndpoints.isActive,
          })
          .from(countyGisEndpoints)
          .where(where)
          .orderBy(desc(countyGisEndpoints.createdAt), desc(countyGisEndpoints.id))
          .limit(ENDPOINTS_PAGE);
        return res.json({ endpoints, total: Number(n) });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  app.patch(
    "/api/founder/county-endpoints/:id/licence",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "The endpoint id must be a positive whole number.");
      const parsed = licenceBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(
          res,
          `Send exactly { redistributable: ${LICENCE_POSTURES.join(" | ")}, note: 10–1000 characters saying what was reviewed, attribution?: the required credit line }.`,
          parsed.error.issues,
        );
      }
      const { redistributable, note, attribution } = parsed.data;
      try {
        const [existing] = await db
          .select({
            id: countyGisEndpoints.id,
            state: countyGisEndpoints.state,
            county: countyGisEndpoints.county,
            redistributable: countyGisEndpoints.redistributable,
            attribution: countyGisEndpoints.attribution,
          })
          .from(countyGisEndpoints)
          .where(eq(countyGisEndpoints.id, id))
          .limit(1);
        if (!existing) return Errors.notFound(res, "County endpoint");

        // 'attribution' means the terms permit reuse ONLY with a credit line.
        // Without one on record, the list builder would save — and public
        // parcel reports would publish — records whose required credit AcreOS
        // cannot show. Refused until the line is on the row or in the request.
        if (redistributable === "attribution" && !attribution && !(existing.attribution ?? "").trim()) {
          return Errors.unprocessable(
            res,
            "An 'attribution' licence needs the credit line the terms require. Send it as `attribution` — this source has none on record.",
            { field: "attribution" },
          );
        }

        const reviewer = getUserId(req);
        const actor = actorFromRequest(req);
        const now = new Date();
        // The record and the change in ONE transaction, the record first: a
        // licence change with no record of who made it and why must not
        // happen, and neither must a record of a change that did not.
        await db.transaction(async (tx) => {
          await chainAndInsertAuditEvent(
            {
              actorUserId: reviewer,
              actorEmail: actor.email ?? null,
              action: "county_endpoint.licence_set",
              targetType: "county_endpoint",
              targetId: String(id),
              justification: note,
              metadata: {
                from: existing.redistributable,
                to: redistributable,
                state: existing.state,
                county: existing.county,
                ...(attribution ? { attribution } : {}),
              },
              ip: actor.ip ?? null,
              userAgent: actor.userAgent ?? null,
            },
            tx,
          );
          await tx
            .update(countyGisEndpoints)
            .set({ redistributable, reviewedAt: now, reviewedBy: reviewer, updatedAt: now, ...(attribution ? { attribution } : {}) })
            .where(eq(countyGisEndpoints.id, id));
        });

        logger.info("[founder-coverage] county licence set", {
          source: "founder-coverage",
          metadata: { endpointId: id, from: existing.redistributable, to: redistributable, reviewer },
        });
        return res.json({ id, redistributable });
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
