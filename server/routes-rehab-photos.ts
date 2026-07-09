/**
 * Fix-and-flip vertical — rehab photo evidence (FF-7).
 *
 * Devon §5.1: line items already track "category, scope, vendor, budgeted,
 * committed, spent, variance, photos." Everything but photos. This is the
 * write + read surface that fills that last gap. Photos back four flows:
 *
 *   1. before / during / after — jobsite proof per line item
 *   2. defect                  — warranty + dispute evidence
 *   3. lender_draw             — required photo bundle for construction draws
 *   4. tax                     — basis evidence for §1.263A capitalization
 *
 * Routes:
 *   POST /api/rehabs/:rehabId/photos    — multipart upload (max 10 / req)
 *   GET  /api/rehabs/:rehabId/photos    — list photos grouped server-side
 *
 * Storage: today we stub the blob store with a deterministic key path
 * (`rehabs/<rehabId>/<photoId>.<ext>`) and persist that key. When the
 * shared S3/R2 driver lands (per docs/cost/blob-storage-migration.md
 * — the same TODO that gates routes-field-scout.ts §217), the upload
 * here pivots to driver.write(key, buffer) and read signs at fetch time.
 */

import type { Express, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  rehabs,
  rehabPhotos,
  REHAB_PHOTO_TAGS,
  type RehabPhotoTag,
} from "@shared/schema";
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
    case "image/bmp":  return "bmp";
    default:           return "bin";
  }
}

/**
 * TODO(blob-storage): when the shared S3/R2 driver lands (Wave 10 per
 * docs/cost/blob-storage-migration.md), replace this stub with
 * driver.write(key, buffer). For now the key is computed deterministically
 * so the DB row already points at the future canonical location.
 */
async function persistToBlob(_buffer: Buffer, key: string): Promise<void> {
  logger.info("[FF-7] rehab photo blob persist (stub)", {
    metadata: { key, bytes: _buffer.length },
  });
  // No-op until the driver is wired. The DB row points at the eventual key.
}

function isValidTag(t: unknown): t is RehabPhotoTag {
  return typeof t === "string" && (REHAB_PHOTO_TAGS as readonly string[]).includes(t);
}

export function registerRehabPhotoRoutes(app: Express): void {
  // ── POST /api/rehabs/:rehabId/photos ─────────────────────────────────────
  // Auth-gated. Multipart. Field name: "photos" (array). Optional metadata
  // alongside: `tag`, `caption`, `lineItemId`, `lat`, `lng`, plus a JSON
  // `metadata` array indexed by file position (mirrors routes-field-scout).
  app.post(
    "/api/rehabs/:rehabId/photos",
    isAuthenticated,
    getOrCreateOrg,
    photoUpload.array("photos", 10),
    validatePhotos,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const rehabId = req.params.rehabId;
        if (!rehabId) return Errors.badRequest(res, "Missing rehabId");

        // Confirm the rehab belongs to this org. Without this check, a
        // /api/rehabs/:rehabId/photos with someone else's rehabId would
        // attach a photo to another org's project — same shape as the
        // lead-scoping check in routes-field-scout.
        const [rehab] = await db
          .select({ id: rehabs.id })
          .from(rehabs)
          .where(and(eq(rehabs.id, rehabId), eq(rehabs.organizationId, orgId)));
        if (!rehab) return Errors.notFound(res, "Rehab");

        // multer's `.array()` yields an array, but the Request type unions it
        // with the field-map form { field: File[] } — narrow explicitly so a
        // tampered shape can't be indexed as an array (type confusion).
        const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
          return Errors.badRequest(
            res,
            'No photo files provided. Upload as multipart field "photos".',
          );
        }

        // Optional per-file metadata array.
        // Multipart fields arrive as string OR string[] when repeated —
        // accept only a single JSON string that parses to an array.
        let perFileMeta: unknown[] = [];
        if (typeof req.body?.metadata === "string") {
          try {
            const parsed = JSON.parse(req.body.metadata);
            if (Array.isArray(parsed)) perFileMeta = parsed;
          } catch {
            // ignore — metadata is optional
          }
        }

        // Single-shot fields apply to every file unless the per-file meta
        // overrides. This matches how the camera roll on iOS sends a batch
        // of "before" or "after" photos with one tag.
        const sharedTag = isValidTag(req.body?.tag) ? (req.body.tag as RehabPhotoTag) : null;
        const sharedLineItemId = typeof req.body?.lineItemId === "string" && req.body.lineItemId
          ? req.body.lineItemId
          : null;

        const inserted: typeof rehabPhotos.$inferSelect[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const rawMeta = perFileMeta[i];
          const meta: Record<string, unknown> =
            rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
              ? (rawMeta as Record<string, unknown>)
              : {};

          const tag = isValidTag(meta.tag) ? meta.tag : sharedTag;
          const lineItemId = (typeof meta.lineItemId === "string" && meta.lineItemId)
            ? meta.lineItemId
            : sharedLineItemId;
          const caption = typeof meta.caption === "string" ? meta.caption : null;
          const lat = meta.lat != null ? String(meta.lat) : (req.body?.lat ?? null);
          const lng = meta.lng != null ? String(meta.lng) : (req.body?.lng ?? null);

          const ext = extensionFromMime(file.mimetype);
          // Insert first to get the photo UUID, then derive the blob key.
          // We do the DB write before the blob write so a blob write that
          // fails leaves a row we can retry against — and a failed DB write
          // never leaks a blob we can't reach.
          const [row] = await db.insert(rehabPhotos).values({
            organizationId: orgId,
            rehabId,
            lineItemId: lineItemId ?? null,
            s3Key: "pending",  // placeholder, updated below
            caption,
            tag,
            capturedBy: userId,
            lat: lat != null ? String(lat) : null,
            lng: lng != null ? String(lng) : null,
            metadata: {
              originalName: file.originalname,
              mime: file.mimetype,
              bytes: file.size,
            },
          }).returning();

          const key = `rehabs/${rehabId}/${row.id}.${ext}`;
          await persistToBlob(file.buffer, key);

          const [updated] = await db.update(rehabPhotos)
            .set({ s3Key: key })
            .where(eq(rehabPhotos.id, row.id))
            .returning();

          inserted.push(updated ?? row);
        }

        logger.info("[FF-7] rehab photos uploaded", {
          orgId, userId, metadata: { rehabId, count: inserted.length },
        });
        return res.status(201).json({ photos: inserted });
      } catch (err) {
        logger.error("[FF-7] rehab photo upload error", err as Error);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/rehabs/:rehabId/photos ──────────────────────────────────────
  // Returns photos grouped by tag for the gallery. Untagged photos land in
  // a synthetic "untagged" bucket so they're surfaced rather than hidden.
  app.get(
    "/api/rehabs/:rehabId/photos",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rehabId = req.params.rehabId;
        if (!rehabId) return Errors.badRequest(res, "Missing rehabId");

        const rows = await db.select().from(rehabPhotos)
          .where(and(
            eq(rehabPhotos.organizationId, orgId),
            eq(rehabPhotos.rehabId, rehabId),
          ))
          .orderBy(desc(rehabPhotos.capturedAt));

        // Group server-side so the client renders a stable bucket order.
        const groups: Record<string, typeof rows> = {};
        for (const tag of REHAB_PHOTO_TAGS) groups[tag] = [];
        groups.untagged = [];
        for (const r of rows) {
          const k = r.tag && (REHAB_PHOTO_TAGS as readonly string[]).includes(r.tag)
            ? r.tag
            : "untagged";
          groups[k].push(r);
        }

        return res.json({
          rehabId,
          total: rows.length,
          groups,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
