/**
 * /api/land-data — the W2 land-data foundation, behind the Map door.
 *
 *   GET  /api/land-data/coverage                 free county-source census + statewide programs
 *   POST /api/land-data/counties/process         a customer search in a county → pipeline job (or refusal)
 *   GET  /api/land-data/counties/:state/:county  that county's pipeline status
 *   GET  /api/land-data/parcels/:parcelKey       an owned parcel's GATED facts + data-truth warnings
 *   GET  /api/land-data/parcel-lookup            the same, found by state + county + county parcel id
 *                                                (through the crosswalk, so a renumbered id still resolves)
 *   GET  /api/land-data/national/:category       one small national dataset at a point (provider registry)
 *
 * Facts reach the customer ONLY through projectFactsForCustomer() (via
 * serializeOwnedParcelForCustomer in services/landData/ownedParcelView.ts) — the
 * accuracy gate. A fact whose sample has not passed is withheld with its
 * reason (tests/unit/landDataAccuracyGate.test.ts pins this route's use).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { COUNTY_SOURCE_CENSUS } from "@shared/landData/countySourceCensus";
import { STATEWIDE_PARCEL_ENDPOINTS } from "./services/statewideParcelEndpoints";
import { enqueueCountyProcessing, getCountyJob } from "./services/landData/countyPipeline";
import { normalizeCountyName, ownedApn } from "./services/landData/ownedParcelStore";
import { findOwnedParcelByKey, findOwnedParcelRow, ownedViewOf, serializeOwnedParcelForCustomer } from "./services/landData/ownedParcelView";
import {
  NATIONAL_DATASET_CATEGORIES,
  nationalDatasetReadiness,
  type NationalDatasetCategory,
} from "./services/providers/national-datasets-provider";
import { providerRegistry } from "./services/providers/provider-registry";

const countySchema = z.object({
  state: z.string().trim().length(2),
  county: z.string().trim().min(1).max(120),
});

const pointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  state: z.string().trim().length(2).optional(),
});

// The customer projection lives in the land-data service so the public report,
// the landlocked checker and the county guides render exactly what this door
// renders (one gate, one serializer). Re-exported for existing importers.
export { ownedViewOf, serializeOwnedParcelForCustomer, type OwnedParcelView } from "./services/landData/ownedParcelView";

export function registerLandDataRoutes(app: Express) {
  app.get("/api/land-data/coverage", isAuthenticated, getOrCreateOrg, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({
        counties: COUNTY_SOURCE_CENSUS,
        statewidePrograms: STATEWIDE_PARCEL_ENDPOINTS.map((e) => ({
          state: e.state,
          attribution: e.attribution,
          sourceUrl: e.sourceUrl,
          termsUrl: e.termsUrl ?? null,
          note: e.notes,
        })),
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/land-data/counties/process", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = countySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    try {
      getOrganizationId(req);
      const outcome = await enqueueCountyProcessing(parsed.data.state, parsed.data.county);
      res.json(outcome);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/counties/:state/:county", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = countySchema.safeParse(req.params);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    try {
      const job = await getCountyJob(parsed.data.state, parsed.data.county);
      if (!job || !job.ownedStatus) return res.json({ status: "not_requested", refusalReason: null, parcelsStored: 0 });
      res.json({
        status: job.ownedStatus,
        refusalReason: job.ownedRefusalReason,
        parcelsStored: job.ownedParcelsStored,
        demandCount: job.ownedDemand,
        completedAt: job.ownedCompletedAt,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/parcels/:parcelKey", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const key = String(req.params.parcelKey ?? "").slice(0, 200);
    if (!key) return Errors.badRequest(res, "A parcel key is required.");
    try {
      // Owned parcels are GLOBAL public-record rows (organization_id NULL):
      // never another tenant's data.
      const row = await findOwnedParcelByKey(key);
      if (!row) return Errors.notFound(res, "Parcel");
      res.json(serializeOwnedParcelForCustomer(ownedViewOf(row)));
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/parcel-lookup", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = countySchema.extend({ apn: z.string().trim().min(1).max(120) }).safeParse(req.query);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    try {
      const county = normalizeCountyName(parsed.data.county);
      // The same canonical APN form the pipeline stored (parcelRef.ts).
      if (!ownedApn(parsed.data.state, county, parsed.data.apn)) return Errors.badRequest(res, "That parcel id is not usable.");
      // Current id OR any id this parcel carried before (the crosswalk), so a
      // renumbered parcel still resolves to the same land.
      const row = await findOwnedParcelRow(parsed.data.state, county, parsed.data.apn);
      if (!row) {
        const job = await getCountyJob(parsed.data.state, county);
        return res.json({
          found: false,
          county: job?.ownedStatus
            ? { status: job.ownedStatus, refusalReason: job.ownedRefusalReason, parcelsStored: job.ownedParcelsStored }
            : { status: "not_requested", refusalReason: null, parcelsStored: 0 },
        });
      }
      res.json({ found: true, parcel: serializeOwnedParcelForCustomer(ownedViewOf(row)) });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/national/:category", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const category = String(req.params.category) as NationalDatasetCategory;
    if (!(NATIONAL_DATASET_CATEGORIES as readonly string[]).includes(category)) {
      return Errors.badRequest(res, "Unknown dataset.", { allowed: NATIONAL_DATASET_CATEGORIES });
    }
    const parsed = pointSchema.safeParse(req.query);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    try {
      const refusal = nationalDatasetReadiness(category);
      if (refusal) return res.json({ available: false, reason: refusal });
      const organizationId = getOrganizationId(req);
      const result = await providerRegistry.lookup(
        category,
        { type: "coordinates", latitude: parsed.data.lat, longitude: parsed.data.lng, state: parsed.data.state?.toUpperCase() },
        "free",
        0,
        organizationId,
      );
      if (!result) return res.json({ available: false, reason: "The source did not answer for this location." });
      res.json({ available: true, source: result.source, fetchedAt: result.fetchedAt, cached: result.cached, data: result.data });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
