/**
 * Drive Mode — mobile driving-for-dollars capture + lead photos.
 *
 * Lens 2 + 6 + 15 driver: DealMachine's killer mobile feature is the
 * one-tap "save the address I'm parked in front of" curb capture. This
 * file is the server side of that flow:
 *
 *   POST /api/field-scout/quick-add        — one-tap GPS lead creation
 *   POST /api/leads/:leadId/photos         — multipart photo evidence
 *
 * The quick-add endpoint reverse-geocodes the (lat, lng) via the Regrid
 * coordinate lookup (same path the parcel pipeline uses) so the lead row
 * lands with a real address + city/state when we can resolve one. When
 * Regrid is missing or returns nothing, we fall back to a "GPS Capture"
 * label so the user still has a row to enrich later — empty screens are
 * a bug.
 *
 * The photo endpoint mirrors routes-rehab-photos.ts: DB-then-blob write
 * order so a blob failure leaves a row we can retry against, and a DB
 * failure never leaks an orphaned blob. Blob driver is still stubbed
 * (Wave 10 — docs/cost/blob-storage-migration.md).
 */

import type { Express, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { leads, leadPhotos } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import {
  createUploadMiddleware,
  validateFileMiddleware,
} from "./middleware/fileUploadSecurity";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const photoUpload = createUploadMiddleware({ maxSizeMB: 10, allowedTypes: ["image"] });
const validatePhotos = validateFileMiddleware(["image"]);

function extensionFromMime(mime: string | undefined): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png":  return "png";
    case "image/webp": return "webp";
    case "image/gif":  return "gif";
    case "image/heic": return "heic";
    default:           return "bin";
  }
}

/**
 * TODO(blob-storage): replace with shared driver.write(key, buffer) once
 * Wave 10 lands per docs/cost/blob-storage-migration.md. Deterministic key
 * means the DB row already points at the future canonical location.
 */
async function persistToBlob(_buffer: Buffer, key: string): Promise<void> {
  logger.info("[drive-mode] lead photo blob persist (stub)", {
    metadata: { key, bytes: _buffer.length },
  });
}

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

  // ── POST /api/leads/:leadId/photos ───────────────────────────────────────
  // Multipart photo upload tied to a lead. Field name: "photos" (array of
  // up to 10). Reuses fileUploadSecurity so the validateFileMiddleware
  // applied here matches the rehab + field-scout paths exactly.
  app.post(
    "/api/leads/:leadId/photos",
    isAuthenticated,
    getOrCreateOrg,
    photoUpload.array("photos", 10),
    validatePhotos,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const leadIdRaw = req.params.leadId;
        const leadId = parseInt(leadIdRaw, 10);
        if (!Number.isFinite(leadId)) {
          return Errors.badRequest(res, "Invalid leadId");
        }

        // Org-scope the lead — protects against attaching to another org's
        // lead the same way the rehab photo route protects rehabId.
        const [lead] = await db
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.id, leadId), eq(leads.organizationId, orgId)));
        if (!lead) return Errors.notFound(res, "Lead");

        const files = (req as any).files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          return Errors.badRequest(
            res,
            'No photo files provided. Upload as multipart field "photos".',
          );
        }

        // Shared fields apply to every file unless per-file metadata
        // overrides. Drive Mode batches are usually one photo so this
        // mostly just carries the GPS point of the capture.
        const sharedLat =
          req.body?.lat != null && Number.isFinite(Number(req.body.lat))
            ? String(Number(req.body.lat))
            : null;
        const sharedLng =
          req.body?.lng != null && Number.isFinite(Number(req.body.lng))
            ? String(Number(req.body.lng))
            : null;
        const sharedCaption =
          typeof req.body?.caption === "string" ? req.body.caption : null;

        const inserted: typeof leadPhotos.$inferSelect[] = [];
        for (const file of files) {
          const ext = extensionFromMime(file.mimetype);
          // DB-then-blob. A blob failure leaves a row we can retry against;
          // a DB failure never leaks an orphaned blob.
          const [row] = await db.insert(leadPhotos).values({
            organizationId: orgId,
            leadId,
            s3Key: "pending",
            caption: sharedCaption,
            capturedBy: userId,
            lat: sharedLat,
            lng: sharedLng,
          }).returning();

          const key = `leads/${leadId}/${row.id}.${ext}`;
          await persistToBlob(file.buffer, key);

          const [updated] = await db
            .update(leadPhotos)
            .set({ s3Key: key })
            .where(eq(leadPhotos.id, row.id))
            .returning();

          inserted.push(updated ?? row);
        }

        logger.info("[drive-mode] lead photos uploaded", {
          orgId,
          userId,
          metadata: { leadId, count: inserted.length },
        });
        return res.status(201).json({ photos: inserted });
      } catch (err) {
        logger.error("[drive-mode] lead photo upload error", err as Error);
        return Errors.internal(res, err);
      }
    },
  );
}
