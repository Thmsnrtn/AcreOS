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
 *   GET  /api/land-data/list-builder/geographies the county list builder's status per seeded state (W10.3 v0)
 *   POST /api/land-data/list-builder/quote       count + cost for a county list, or the refusal and why
 *   POST /api/land-data/list-builder/pull        the pull — needs the quote's digest; re-checks everything
 *
 * The list builder is DARK: it admits no geography today (services/landData/
 * listBuilder.ts says why). Every refusal is decided before any source is asked.
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
import { getOrganizationId, getUserId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { requirePermission } from "./utils/permissions";
import { createListBuilder, listQuerySchema, type ListBuilder, type QuoteOutcome } from "./services/landData/listBuilder";
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
import { routeParam } from "./utils/routeParams";

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

/** The HTTP answer to a quote refusal: a well-formed request the current state cannot carry out. */
function sendQuoteRefusal(res: Response, refusal: Exclude<QuoteOutcome, { ok: true }>): void {
  switch (refusal.code) {
    case "not_cleared":
      return Errors.unprocessable(res, "A list can't be built for this county yet. Nothing was counted or charged.", refusal);
    case "filter_unsupported":
      return Errors.unprocessable(res, "This county's source can't answer every filter you chose, so nothing was counted.", refusal);
    case "list_too_large":
      return Errors.unprocessable(
        res,
        `${refusal.count} parcels match, and one pull takes at most ${refusal.ceiling}. Narrow the filters — nothing was cut off or charged.`,
        refusal,
      );
    case "count_unavailable":
      return Errors.badGateway(res, "The county's parcel source did not give a count, so none is shown and nothing was charged.");
  }
}

export function registerLandDataRoutes(app: Express, listBuilder: ListBuilder = createListBuilder()) {
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
    const key = String(routeParam(req.params.parcelKey) ?? "").slice(0, 200);
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
    const category = String(routeParam(req.params.category)) as NationalDatasetCategory;
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

  // ── County list builder v0 (W10.3, draft W4.10) ─────────────────────────
  app.get("/api/land-data/list-builder/geographies", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      getOrganizationId(req);
      res.json(listBuilder.geographies());
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/land-data/list-builder/quote", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error);
    try {
      const outcome = await listBuilder.quote(getOrganizationId(req), parsed.data);
      if (!outcome.ok) return sendQuoteRefusal(res, outcome);
      const { ok: _ok, ...quote } = outcome;
      res.json(quote);
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post(
    "/api/land-data/list-builder/pull",
    isAuthenticated,
    getOrCreateOrg,
    requirePermission("canImportData"),
    async (req: AuthenticatedRequest, res: Response) => {
      const rawKey = req.headers["idempotency-key"];
      const operationKey = typeof rawKey === "string" ? rawKey.trim() : "";
      if (!operationKey || operationKey.length > 200) {
        return Errors.badRequest(res, "An Idempotency-Key header identifying this pull is required");
      }
      const parsed = listQuerySchema.extend({ expectedQuoteDigest: z.string().trim().min(1).max(128).optional() }).safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error);
      const { expectedQuoteDigest, ...query } = parsed.data;
      try {
        const outcome = await listBuilder.pull({
          organizationId: getOrganizationId(req),
          actorUserId: getUserId(req),
          operationKey,
          query,
          expectedQuoteDigest,
        });
        if (outcome.ok) return res.json({ quote: outcome.quote, charged: outcome.charged, result: outcome.result });
        switch (outcome.code) {
          case "quote_required":
            return Errors.badRequest(res, "Get a quote for this list first, then pull with its quoteDigest.", { code: "quote_required" });
          case "quote_changed":
            return sendError(res, 409, "QUOTE_CHANGED", "The count or cost changed since your quote. Review the new quote, then pull. Nothing was pulled or charged.", {
              quote: outcome.quote,
            });
          case "nothing_to_pull":
            return Errors.unprocessable(res, "No parcels match this list, so there is nothing to pull.", { code: "nothing_to_pull" });
          default:
            return sendQuoteRefusal(res, outcome);
        }
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
