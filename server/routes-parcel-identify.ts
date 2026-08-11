/**
 * /api/parcel-identify + /api/tracked-parcels — Wave 2.3.
 *
 * Click-to-identify on the Map door, and the parcels an org watches.
 *
 * Deliberately its OWN path namespace rather than `/api/parcels/*`: that space
 * already holds `/api/parcels/:id/...` sub-resources, and a new static segment
 * beside a param route is exactly the ordering hazard `lint:route-order`
 * exists to catch. Nothing here duplicates `/api/parcels/lookup` — that route
 * calls providers and spends credits; this one reads only the cache we already
 * hold, so a map tap costs no credits and makes no vendor round-trip. It is
 * two or three reads, not one, and the point path's centroid filter is not
 * index-backed — stated plainly here because the earlier "one indexed read"
 * wording promised something the implementation does not do.
 *
 * Pattern: isAuthenticated + getOrCreateOrg, AuthenticatedRequest, Errors.*,
 * structured logger. Customer surface behind the Map door — no founder gate,
 * and no new top-level nav entry.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  identifyParcel,
  trackParcel,
  untrackParcel,
} from "./services/parcelIdentify";

const identifyQuerySchema = z
  .object({
    state: z.string().trim().min(2).max(2).optional(),
    county: z.string().trim().min(1).max(120).optional(),
    apn: z.string().trim().min(1).max(120).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (v) => Boolean(v.apn) || (v.lat !== undefined && v.lng !== undefined),
    { message: "Provide an apn, or lat and lng." },
  );

const trackBodySchema = z.object({
  state: z.string().trim().min(2).max(2),
  county: z.string().trim().min(1).max(120),
  apn: z.string().trim().min(1).max(120),
  parcelSnapshotId: z.number().int().positive().optional(),
  note: z.string().trim().max(2000).optional(),
});

const untrackBodySchema = z.object({
  state: z.string().trim().min(2).max(2),
  county: z.string().trim().min(1).max(120),
  apn: z.string().trim().min(1).max(120),
});

export function registerParcelIdentifyRoutes(app: Express) {
  /**
   * GET /api/parcel-identify — what do we already hold for this parcel?
   *
   * Always 200 on a well-formed request, including every kind of miss. A 404
   * would flatten four genuinely different situations ("we don't cover this
   * county", "we cover it but haven't pulled this parcel", "we couldn't tell
   * where you tapped", "the read failed") into one blank, and the inspector
   * needs to say WHICH of them happened.
   */
  app.get(
    "/api/parcel-identify",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = identifyQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const organizationId = getOrganizationId(req);
        const result = await identifyParcel({
          organizationId,
          state: parsed.data.state ?? null,
          county: parsed.data.county ?? null,
          apn: parsed.data.apn ?? null,
          lat: parsed.data.lat ?? null,
          lng: parsed.data.lng ?? null,
        });
        return res.json(result);
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  /** GET /api/tracked-parcels — the org's watch list. */
  /*
   * There is deliberately no `GET /api/tracked-parcels` yet. One was written
   * in this wave and removed during integration: nothing in the client ever
   * fetched it, and there is no tracked-parcels surface anywhere in the
   * product, so it was a reader with no reader — the "built but unwired"
   * shape this repo keeps paying for. The moment a watch-list surface exists
   * behind the Map door, the route and `listTrackedParcels` come back with it,
   * in the same change.
   */

  /**
   * POST /api/tracked-parcels — track a parcel.
   *
   * Idempotent by the unique index; a second tap returns 200 with
   * alreadyTracked:true rather than a conflict, because the customer's intent
   * ("I want to be watching this") is satisfied either way.
   */
  app.post(
    "/api/tracked-parcels",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = trackBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const organizationId = getOrganizationId(req);
        const result = await trackParcel({
          organizationId,
          state: parsed.data.state,
          county: parsed.data.county,
          apn: parsed.data.apn,
          parcelSnapshotId: parsed.data.parcelSnapshotId ?? null,
          trackedByUserId: getUserId(req),
          note: parsed.data.note ?? null,
        });
        logger.info("parcel tracked", {
          organizationId,
          state: parsed.data.state,
          county: parsed.data.county,
          alreadyTracked: result.alreadyTracked,
        });
        return res.json(result);
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );

  /** POST /api/tracked-parcels/untrack — stop watching. Org-scoped delete. */
  app.post(
    "/api/tracked-parcels/untrack",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = untrackBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const organizationId = getOrganizationId(req);
        const result = await untrackParcel({
          organizationId,
          state: parsed.data.state,
          county: parsed.data.county,
          apn: parsed.data.apn,
        });
        return res.json(result);
      } catch (error) {
        return Errors.internal(res, error);
      }
    },
  );
}
