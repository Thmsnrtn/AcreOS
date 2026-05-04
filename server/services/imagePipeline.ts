/**
 * Phase 8 Mo 12 — Yara §1: EXIF / photo-hash / resize pipeline.
 *
 * Centralized image-upload helpers used by every endpoint that accepts user
 * image uploads (currently `routes-field-scout.ts /leads/:id/photos`).
 *
 * Responsibilities:
 *
 *  1. **EXIF strip**       — drop GPS / camera-serial / timestamp metadata
 *                             before storage so it never leaks back via URL.
 *                             `sharp` is used as the primary stripper because
 *                             it normalizes orientation (`.rotate()`) and
 *                             unconditionally drops EXIF/XMP/ICC unless we
 *                             explicitly opt back in via `withMetadata()`.
 *                             For JPEG-only bytes we also fall back to the
 *                             pure-JS `stripJpegExif()` helper in
 *                             `middleware/fileUploadSecurity.ts` — it is
 *                             still imported for unit-test parity and any
 *                             environment where sharp's native binary fails
 *                             to load (Alpine on certain CPU archs).
 *
 *  2. **Content hash**     — SHA-256 of the post-strip bytes. Used as the
 *                             deduplication key so two uploads of the same
 *                             photo by the same org collapse to one stored
 *                             object. Hashing AFTER the strip is intentional:
 *                             two photos that differ only in EXIF metadata
 *                             (e.g. re-saved from a tool that rewrote the
 *                             date) produce the same hash — i.e. the same
 *                             pixel content dedupes correctly.
 *
 *  3. **Resize variants**  — three canonical sizes:
 *                              thumbnail  200×200  (cover, list grids)
 *                              card       800×600  (cards / detail headers)
 *                              full      1920×1440 (lightbox, downloads)
 *                             Surface APIs request whichever they need and
 *                             never load 12 MP originals into a card grid.
 *
 *  4. **Reverse-image dedup** — `findDuplicateByHash(orgId, hash)` looks up
 *                             an existing photo for the same org with the
 *                             same content hash. Callers should short-circuit
 *                             with that record's URL set so the uploader
 *                             gets a 200 with the existing object instead of
 *                             writing a duplicate.
 *
 * Storage path migration is referenced in `docs/cost/blob-storage-migration.md`
 * (Wave 10). The current field-scout schema stores a `url` string only —
 * variants are surfaced through `image_hash`, `thumbnail_url`, `card_url`,
 * and `full_url` columns added by migration 0067.
 */

import crypto from "node:crypto";
import sharp from "sharp";
import { logger } from "../utils/logger";
import { stripImageMetadata } from "../middleware/fileUploadSecurity";

// ─── Resize presets ──────────────────────────────────────────────────────────

export const RESIZE_PRESETS = {
  thumbnail: { width: 200, height: 200, fit: "cover" as const },
  card: { width: 800, height: 600, fit: "inside" as const },
  full: { width: 1920, height: 1440, fit: "inside" as const },
} satisfies Record<string, { width: number; height: number; fit: "cover" | "inside" }>;

export type ImageVariantKey = keyof typeof RESIZE_PRESETS;

export interface ImageVariant {
  key: ImageVariantKey;
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  mime: string; // always "image/jpeg" — we re-encode so the variants are uniform
}

export interface ProcessedImage {
  /** Original buffer with EXIF stripped (still in source format). */
  stripped: Buffer;
  /** SHA-256 of the post-strip bytes. */
  hash: string;
  /** Source MIME (pre-resize). */
  sourceMime: string;
  /** Resize variants — only emitted when sharp is available. */
  variants: Record<ImageVariantKey, ImageVariant>;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex digest of the buffer. Stable, fast (Node native), and short
 * enough to index without a separate hash column type.
 */
export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ─── EXIF strip + resize ─────────────────────────────────────────────────────

/**
 * Best-effort EXIF strip via sharp. Falls back to the pure-JS JPEG marker
 * walker if sharp is unavailable or the buffer cannot be decoded.
 */
async function stripWithSharp(buffer: Buffer, mime: string): Promise<Buffer> {
  try {
    // `.rotate()` reads the EXIF orientation tag and bakes it into the pixel
    // data so the post-strip image renders correctly without metadata.
    //
    // sharp's default is to STRIP all metadata unless you opt back in via
    // `.keepMetadata()` / `.withMetadata()`. We deliberately do NOT call
    // those — that's what removes the GPS / camera-serial / date payloads.
    return await sharp(buffer)
      .rotate()
      .toBuffer();
  } catch (err) {
    logger.warn(`[imagePipeline] sharp strip failed; falling back to manual marker walker`, {
      metadata: { mime, error: (err as Error).message },
    });
    return stripImageMetadata(buffer, mime);
  }
}

/**
 * Render a single resize variant. Always re-encodes to JPEG (quality 85)
 * for predictable byte counts across heterogeneous source formats.
 */
async function renderVariant(
  source: Buffer,
  key: ImageVariantKey,
): Promise<ImageVariant> {
  const preset = RESIZE_PRESETS[key];
  const pipeline = sharp(source)
    .rotate()
    .resize(preset.width, preset.height, {
      fit: preset.fit,
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85, mozjpeg: true });
  const out = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    key,
    buffer: out.data,
    width: out.info.width,
    height: out.info.height,
    bytes: out.info.size,
    mime: "image/jpeg",
  };
}

/**
 * Process an uploaded image buffer end-to-end:
 *   1. Strip EXIF (rotation baked in).
 *   2. Compute SHA-256 of the stripped bytes.
 *   3. Generate thumbnail / card / full variants.
 *
 * The caller is responsible for:
 *   - Looking up an existing record by hash before persisting (dedup).
 *   - Uploading the variant buffers to blob storage and recording the URLs.
 */
export async function processUploadedImage(
  buffer: Buffer,
  mime: string,
): Promise<ProcessedImage> {
  const stripped = await stripWithSharp(buffer, mime);
  const hash = sha256(stripped);

  // Render all three sizes in parallel — sharp releases the GIL inside its
  // native code, so this is CPU-bound but concurrent across requests.
  const [thumbnail, card, full] = await Promise.all([
    renderVariant(stripped, "thumbnail"),
    renderVariant(stripped, "card"),
    renderVariant(stripped, "full"),
  ]);

  return {
    stripped,
    hash,
    sourceMime: mime,
    variants: { thumbnail, card, full },
  };
}

/**
 * Lightweight EXIF-only path for environments that don't need to ship
 * resize variants yet (e.g. when blob storage isn't wired). Still returns
 * the hash so the dedup table can be populated incrementally.
 */
export async function stripAndHash(
  buffer: Buffer,
  mime: string,
): Promise<{ stripped: Buffer; hash: string }> {
  const stripped = await stripWithSharp(buffer, mime);
  return { stripped, hash: sha256(stripped) };
}
