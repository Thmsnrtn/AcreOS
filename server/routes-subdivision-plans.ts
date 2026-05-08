/**
 * Subdivider vertical SD-7 — subdivision plans (GeoJSON storage + A/B).
 *
 * Brigid §1: "Multiple plans per parcel ('Plan A — 12 lots,' 'Plan B — 8
 * lots, two estate'), so I can A/B them. Earl will redline whichever I
 * send him; I want the previous plans intact when he comes back two weeks
 * later asking why I changed the cul-de-sac."
 *
 * The polygon-draw UI on the map (mapbox-gl-draw integration) is a
 * separate frontend deliverable; this PR ships the persistence layer and
 * a list/get/save API surface so plans can be created, named, versioned,
 * and switched between status states (draft / engineer_review /
 * county_submitted / recorded / abandoned).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, desc } from "drizzle-orm";
import { db } from "./db";
import {
  subdivisionPlans,
  properties,
  SUBDIVISION_PLAN_STATUSES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const featureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    id: z.string().optional(),
    geometry: z.object({
      type: z.enum(["Polygon", "MultiPolygon", "LineString"]),
      coordinates: z.any(),
    }),
    properties: z.object({
      kind: z.enum(["parent_boundary", "road_centerline", "lot", "setback_overlay"]),
      lotNumber: z.string().optional(),
      frontageFeet: z.number().optional(),
      areaAcres: z.number().optional(),
      notes: z.string().optional(),
    }),
  })),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(SUBDIVISION_PLAN_STATUSES).default("draft"),
  geojson: featureCollectionSchema.optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(SUBDIVISION_PLAN_STATUSES).optional(),
  geojson: featureCollectionSchema.optional(),
  notes: z.string().optional(),
});

function summarizeGeojson(gj: any): { lotCount: number; totalRoadFeet: number; totalAcres: number } {
  let lotCount = 0;
  let totalRoadFeet = 0;
  let totalAcres = 0;
  if (!gj?.features) return { lotCount, totalRoadFeet, totalAcres };
  for (const f of gj.features) {
    const k = f.properties?.kind;
    if (k === "lot") {
      lotCount++;
      const a = f.properties?.areaAcres;
      if (typeof a === "number" && Number.isFinite(a)) totalAcres += a;
    }
    if (k === "road_centerline") {
      const ft = f.properties?.frontageFeet;
      if (typeof ft === "number" && Number.isFinite(ft)) totalRoadFeet += ft;
    }
  }
  return { lotCount, totalRoadFeet, totalAcres };
}

export function registerSubdivisionPlanRoutes(app: Express): void {
  // List plans for a parent.
  app.get(
    "/api/parcels/:id/plans",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const plans = await db
          .select({
            id: subdivisionPlans.id,
            name: subdivisionPlans.name,
            versionNumber: subdivisionPlans.versionNumber,
            status: subdivisionPlans.status,
            lotCount: subdivisionPlans.lotCount,
            totalAcres: subdivisionPlans.totalAcres,
            totalRoadFeet: subdivisionPlans.totalRoadFeet,
            notes: subdivisionPlans.notes,
            createdAt: subdivisionPlans.createdAt,
            updatedAt: subdivisionPlans.updatedAt,
          })
          .from(subdivisionPlans)
          .where(and(
            eq(subdivisionPlans.organizationId, orgId),
            eq(subdivisionPlans.parentParcelId, parentId),
          ))
          .orderBy(desc(subdivisionPlans.updatedAt));

        return res.json({ plans });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Single plan w/ full geojson.
  app.get(
    "/api/plans/:planId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [plan] = await db
          .select()
          .from(subdivisionPlans)
          .where(and(
            eq(subdivisionPlans.id, req.params.planId),
            eq(subdivisionPlans.organizationId, orgId),
          ));
        if (!plan) return Errors.notFound(res, "Subdivision plan");
        return res.json({ plan });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Create.
  app.post(
    "/api/parcels/:id/plans",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

        const [parent] = await db
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");

        const summary = parsed.data.geojson ? summarizeGeojson(parsed.data.geojson) : { lotCount: 0, totalRoadFeet: 0, totalAcres: 0 };

        const [plan] = await db.insert(subdivisionPlans).values({
          organizationId: orgId,
          parentParcelId: parentId,
          name: parsed.data.name,
          status: parsed.data.status,
          geojson: parsed.data.geojson ?? null,
          lotCount: summary.lotCount || null,
          totalRoadFeet: summary.totalRoadFeet || null,
          totalAcres: summary.totalAcres > 0 ? String(summary.totalAcres) : null,
          notes: parsed.data.notes ?? null,
          createdBy: userId,
        }).returning();

        logger.info("[SD-7] subdivision plan created", { orgId, userId, parentId, planId: plan.id });
        return res.status(201).json({ plan });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Update — bumps version_number when geojson changes (Brigid: keep previous
  // plans intact when Earl comes back two weeks later asking why I changed
  // the cul-de-sac).
  app.patch(
    "/api/plans/:planId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

        const [existing] = await db
          .select()
          .from(subdivisionPlans)
          .where(and(
            eq(subdivisionPlans.id, req.params.planId),
            eq(subdivisionPlans.organizationId, orgId),
          ));
        if (!existing) return Errors.notFound(res, "Subdivision plan");

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (parsed.data.name !== undefined) updates.name = parsed.data.name;
        if (parsed.data.status !== undefined) updates.status = parsed.data.status;
        if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
        if (parsed.data.geojson !== undefined) {
          updates.geojson = parsed.data.geojson;
          updates.versionNumber = existing.versionNumber + 1;
          const s = summarizeGeojson(parsed.data.geojson);
          updates.lotCount = s.lotCount || null;
          updates.totalRoadFeet = s.totalRoadFeet || null;
          updates.totalAcres = s.totalAcres > 0 ? String(s.totalAcres) : null;
        }

        const [updated] = await db
          .update(subdivisionPlans)
          .set(updates)
          .where(eq(subdivisionPlans.id, existing.id))
          .returning();

        return res.json({ plan: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Delete (typically status=abandoned is preferable, but allow hard-delete
  // for never-shared drafts).
  app.delete(
    "/api/plans/:planId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [deleted] = await db
          .delete(subdivisionPlans)
          .where(and(
            eq(subdivisionPlans.id, req.params.planId),
            eq(subdivisionPlans.organizationId, orgId),
          ))
          .returning({ id: subdivisionPlans.id });
        if (!deleted) return Errors.notFound(res, "Subdivision plan");
        return res.json({ deleted: true, id: deleted.id });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
