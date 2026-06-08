/**
 * Parcel Biography API — Iyari #1 (mine the longitudinal log, not the delta).
 *
 * Customer-facing READ surface for the parcel's full observation series +
 * derived metrics (server/services/parcel-biography.ts). The biography engine is
 * SELECT-only against parcel_observations; this router is read-only. The
 * observation-log writer + the delta detector stay the sole writers.
 *
 *   GET /api/parcel-biography/:propertyId — the biography for a property the
 *       caller's org owns. Resolves apn/state/county from the property
 *       (org-scoped via getOrganization), then assembles the biography over this
 *       org's + globally-shared observations.
 *
 * Mounted on the parcel-detail overview (client/src/components/parcels/
 * parcel-biography.tsx). Returns an honest empty biography (never 404 on
 * "no history yet") so the card can render its own first-seen/empty state.
 */

import { Router, type Response } from "express";
import { storage } from "./storage";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { getParcelBiography } from "./services/parcel-biography";

const router = Router();

router.get("/:propertyId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const propertyId = Number(req.params.propertyId);
    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      return Errors.badRequest(res, "Invalid property id");
    }

    // Org-scoped resolution: a caller can only read the biography of a parcel
    // their own organization owns.
    const property = await storage.getProperty(org.id, propertyId);
    if (!property) return Errors.notFound(res, "Property");

    if (!property.apn || !property.state) {
      // The parcel has no APN/state identity yet — nothing to key the log on.
      // Return a well-formed empty biography rather than an error.
      return res.json({
        apn: property.apn || "",
        state: (property.state || "").toUpperCase(),
        county: property.county || "",
        fields: {},
        assessedValue: null,
        taxStatus: null,
        owner: null,
        ownerTenure: null,
        taxRecurrence: null,
        observationCount: 0,
        hasAnySeries: false,
      });
    }

    const biography = await getParcelBiography({
      apn: property.apn,
      state: property.state,
      county: property.county,
      organizationId: org.id,
    });

    return res.json(biography);
  } catch (error) {
    return Errors.internal(res, error);
  }
});

export default router;
