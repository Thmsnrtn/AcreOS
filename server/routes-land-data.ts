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
 * Facts reach the customer ONLY through projectFactsForCustomer() — the
 * accuracy gate. A fact whose sample has not passed is withheld with its
 * reason (tests/unit/landDataAccuracyGate.test.ts pins this route's use).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { parcelSnapshots, type ParcelSnapshot } from "@shared/schema";
import { COUNTY_SOURCE_CENSUS, censusRowFor } from "@shared/landData/countySourceCensus";
import { FACT_ACCURACY, projectFactsForCustomer } from "@shared/landData/factAccuracyGate";
import { parcelTruths } from "@shared/landData/parcelTruths";
import { taxSaleSourcesFor } from "@shared/landData/taxSaleSources";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";
import { STATEWIDE_PARCEL_ENDPOINTS } from "./services/statewideParcelEndpoints";
import {
  enqueueCountyProcessing,
  getCountyJob,
  normalizeCountyName,
  ownedApn,
  OWNED_SNAPSHOT_SOURCE,
} from "./services/landData/countyPipeline";
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

/** The owned-parcel fields a customer view needs, from a parcel_snapshots row. */
export interface OwnedParcelView {
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
  sourceName: string;
  retrievedAt: Date | null;
  gisAcres: number;
  deededAcres: number | null;
  facts: unknown;
  attributes: unknown;
}

export function ownedViewOf(row: ParcelSnapshot): OwnedParcelView {
  const raw = (row.rawData ?? {}) as Record<string, unknown>;
  return {
    parcelKey: row.parcelKey ?? "",
    state: row.state,
    county: row.county,
    sourceParcelId: row.apn,
    sourceName: typeof raw.sourceName === "string" ? raw.sourceName : "unknown",
    retrievedAt: row.fetchedAt ?? null,
    gisAcres: Number(row.acres ?? 0),
    deededAcres: typeof raw.deededAcres === "number" ? raw.deededAcres : null,
    facts: row.facts,
    attributes: raw.attributes ?? {},
  };
}

/** Serialize an owned parcel for a customer: gated facts + truths. Exported for the gate test. */
export function serializeOwnedParcelForCustomer(row: OwnedParcelView) {
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
    // Each shown fact carries the accuracy sample that let it through.
    facts: projection.shown.map((f) => {
      const a = FACT_ACCURACY[f.key];
      return { ...f, accuracy: { check: a.check, sampleSize: a.sampleSize ?? 0, agreed: a.agreed ?? 0, verifiedOn: a.verifiedOn ?? null } };
    }),
    withheldFacts: projection.withheld,
    countyCoverage: censusRowFor(row.state, row.county)?.coverage ?? null,
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
      const [row] = await db
        .select()
        .from(parcelSnapshots)
        // Owned parcels are GLOBAL public-record rows (organization_id NULL):
        // never another tenant's data.
        .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), eq(parcelSnapshots.parcelKey, key)))
        .limit(1);
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
      const apn = ownedApn(parsed.data.state, county, parsed.data.apn);
      if (!apn) return Errors.badRequest(res, "That parcel id is not usable.");
      // Current id OR any id this parcel carried before (the crosswalk), so a
      // renumbered parcel still resolves to the same land.
      const [row] = await db
        .select()
        .from(parcelSnapshots)
        .where(
          and(
            isNull(parcelSnapshots.organizationId),
            eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE),
            eq(parcelSnapshots.state, parsed.data.state.toUpperCase()),
            eq(parcelSnapshots.county, county),
            sql`(${parcelSnapshots.apn} = ${apn} OR jsonb_exists(${parcelSnapshots.rawData}->'sourceIdHistory', ${apn}))`,
          ),
        )
        .limit(1);
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
