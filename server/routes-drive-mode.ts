/**
 * Drive Mode — mobile driving-for-dollars capture + lead photos.
 *
 * Lens 2 + 6 + 15 driver: DealMachine's killer mobile feature is the
 * one-tap "save the address I'm parked in front of" curb capture. This
 * file is the server side of that flow:
 *
 *   POST /api/field-scout/quick-add        — one-tap GPS lead creation
 *
 * The quick-add endpoint reverse-geocodes the (lat, lng) via the Regrid
 * coordinate lookup (same path the parcel pipeline uses) so the lead row
 * lands with a real address + city/state when we can resolve one. When
 * Regrid is missing or returns nothing, we fall back to a "GPS Capture"
 * label so the user still has a row to enrich later — empty screens are
 * a bug.
 *
 * Mounted via registerDriveModeRoutes(app) in routes.ts (2026-06-11). It
 * shipped unwired in W5-10, so the client DriveMode quick-add button 404'd
 * in production until the 3E route-manifest orphan test surfaced it.
 *
 * NOTE: the lead-photo endpoint that used to live here was a 501 stub
 * duplicating fieldScoutRouter's working POST /api/leads/:id/photos (the
 * client DriveMode photo upload already hits that mounted route). It was
 * removed rather than mounted, to avoid a duplicate /api/leads/:id/photos
 * registration.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { leads } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/**
 * Reverse-geocode (lat, lng) via Regrid when configured. Returns null if
 * Regrid is unconfigured or the lookup misses — callers must fall back to
 * the "GPS Capture" label so the lead row still lands.
 */
async function reverseGeocodeViaRegrid(
  lat: number,
  lng: number,
): Promise<
  { address: string | null; city: string | null; state: string | null }
  | null
> {
  try {
    const { lookupParcelByCoordinates } = await import("./services/parcel");
    const result = await lookupParcelByCoordinates(lat, lng);
    if (!result.found || !result.parcel) return null;
    const p = result.parcel;
    return {
      // Regrid returns owner mailing address — the parcel itself doesn't
      // ship a street address in the v2 endpoint, but APN + county + state
      // are enough for the lead row's geographic identity.
      address: p.apn ? `APN ${p.apn}` : null,
      city: p.data?.county ?? null, // Regrid v2 ships county; city resolution is downstream.
      state: p.data?.state ?? null,
    };
  } catch (err) {
    logger.warn("[drive-mode] regrid reverse-geocode failed", {
      metadata: { error: (err as Error).message },
    });
    return null;
  }
}

export function registerDriveModeRoutes(app: Express): void {
  // ── POST /api/field-scout/quick-add ──────────────────────────────────────
  // One-tap curb capture. Body: { lat, lng, accuracy?, photo_s3_key?, notes? }.
  // Creates a `lead` row with source='driving_for_dollars' + the GPS point,
  // and reverse-geocodes the address when Regrid is configured.
  app.post(
    "/api/field-scout/quick-add",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const { lat, lng, accuracy, photo_s3_key, notes } = req.body ?? {};

        const latNum = typeof lat === "number" ? lat : parseFloat(lat);
        const lngNum = typeof lng === "number" ? lng : parseFloat(lng);
        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
          return Errors.badRequest(res, "lat and lng are required numeric fields");
        }
        if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
          return Errors.badRequest(res, "lat/lng out of range");
        }

        // Reverse-geocode best-effort. If Regrid is missing or returns no
        // parcel, we fall back to a "GPS Capture: <lat>, <lng>" label so the
        // row still lands and the investor can enrich on desktop.
        const geo = await reverseGeocodeViaRegrid(latNum, lngNum);
        const fallbackLabel = `GPS Capture: ${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;

        // Lead row anchored by the GPS point. firstName + lastName are NOT
        // NULL on the leads table (see shared/schema.ts §646), so we synth
        // identity placeholders the investor will replace on enrichment.
        // Notes encode the GPS accuracy + raw point + photo key for the
        // audit trail (the lead row itself has no lat/lng columns today).
        const noteParts: string[] = [
          `Drive Mode capture @ ${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`,
        ];
        if (Number.isFinite(accuracy)) {
          noteParts.push(`accuracy: ±${Number(accuracy).toFixed(0)}m`);
        }
        if (typeof photo_s3_key === "string" && photo_s3_key) {
          noteParts.push(`photo: ${photo_s3_key}`);
        }
        if (typeof notes === "string" && notes.trim()) {
          noteParts.push(notes.trim());
        }

        const [row] = await db.insert(leads).values({
          organizationId: orgId,
          type: "seller",
          firstName: geo?.address ?? fallbackLabel,
          lastName: "",
          address: geo?.address ?? null,
          city: geo?.city ?? null,
          state: geo?.state ?? null,
          status: "new",
          source: "driving_for_dollars",
          notes: noteParts.join(" — "),
        }).returning();

        logger.info("[drive-mode] quick-add lead created", {
          orgId,
          userId,
          metadata: { leadId: row.id, geocoded: geo !== null },
        });

        return res.status(201).json({
          leadId: row.id,
          lead: row,
          geocoded: geo !== null,
        });
      } catch (err) {
        logger.error("[drive-mode] quick-add error", err as Error);
        return Errors.internal(res, err);
      }
    },
  );
}
