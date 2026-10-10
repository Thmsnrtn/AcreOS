/**
 * /api/land-data — the W2 land-data foundation, behind the Map door.
 *
 *   GET  /api/land-data/coverage                 free county-source census + statewide programs
 *   POST /api/land-data/counties/process         a customer search in a county → pipeline job (or refusal)
 *   GET  /api/land-data/counties/:state/:county  that county's pipeline status
 *   GET  /api/land-data/parcels/:parcelKey       an owned parcel's GATED facts + data-truth warnings
 *   GET  /api/land-data/national/:category       one small national dataset at a point (provider registry)
 *
 * Facts reach the customer ONLY through projectFactsForCustomer() — the
 * accuracy gate. A fact whose sample has not passed is withheld with its
 * reason (tests/unit/landDataAccuracyGate.test.ts pins this route's use).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { ownedParcels } from "@shared/schema";
import { COUNTY_SOURCE_CENSUS } from "@shared/landData/countySourceCensus";
import { projectFactsForCustomer } from "@shared/landData/factAccuracyGate";
import { parcelTruths } from "@shared/landData/parcelTruths";
import { taxSaleSourcesFor } from "@shared/landData/taxSaleSources";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";
import { STATEWIDE_PARCEL_ENDPOINTS } from "./services/statewideParcelEndpoints";
import { enqueueCountyProcessing, getCountyJob } from "./services/landData/countyPipeline";
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

/** Serialize an owned parcel for a customer: gated facts + truths. Exported for the gate test. */
export function serializeOwnedParcelForCustomer(row: {
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
  sourceName: string;
  retrievedAt: Date;
  gisAcres: number;
  deededAcres: number | null;
  facts: unknown;
  attributes: unknown;
}) {
  const facts = (row.facts ?? {}) as Partial<ParcelFactSet>;
  const projection = projectFactsForCustomer(facts);
  const attrs = (row.attributes ?? {}) as Record<string, unknown>;
  const access = facts.legal_access_indication?.status === "computed" ? facts.legal_access_indication.value : null;
  return {
    parcelKey: row.parcelKey,
    state: row.state,
    county: row.county,
    sourceParcelId: row.sourceParcelId,
    source: { name: row.sourceName, retrievedAt: row.retrievedAt },
    gisAcres: row.gisAcres,
    deededAcres: row.deededAcres,
    facts: projection.shown,
    withheldFacts: projection.withheld,
    truths: parcelTruths({
      state: row.state,
      county: row.county,
      gisAcres: row.gisAcres,
      deededAcres: row.deededAcres,
      subdivision: typeof attrs.SUBDIV === "string" ? attrs.SUBDIV : null,
      lot: typeof attrs.LOT === "string" ? attrs.LOT : null,
      accessIndication: access,
    }),
    taxSaleSources: taxSaleSourcesFor(row.state, row.county),
  };
}

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
      if (!job) return res.json({ status: "not_requested", refusalReason: null, parcelsStored: 0 });
      res.json({
        status: job.status,
        refusalReason: job.refusalReason,
        parcelsStored: job.parcelsStored,
        demandCount: job.demandCount,
        completedAt: job.completedAt,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/land-data/parcels/:parcelKey", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const key = String(req.params.parcelKey ?? "").slice(0, 200);
    if (!key) return Errors.badRequest(res, "A parcel key is required.");
    try {
      const [row] = await db.select().from(ownedParcels).where(eq(ownedParcels.parcelKey, key)).limit(1);
      if (!row) return Errors.notFound(res, "Parcel");
      res.json(serializeOwnedParcelForCustomer(row));
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
