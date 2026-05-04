/**
 * Phase 8 Mo 12 — Yara §1 image-pipeline unit tests.
 *
 * Verifies acceptance criterion #15: an uploaded image with EXIF metadata
 * round-trips through `processUploadedImage` without preserving the EXIF
 * payload, and the post-strip bytes always hash to the same SHA-256 value.
 */

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processUploadedImage, sha256, stripAndHash } from "../../server/services/imagePipeline";

/**
 * Build a 200×200 JPEG with embedded EXIF metadata. We bake in:
 *   - GPS coordinates (the leak we care most about)
 *   - Camera serial number
 *   - Original-date timestamp
 *
 * sharp's `withMetadata({ exif: ... })` writes a real APP1 segment so the
 * resulting bytes are byte-for-byte equivalent to a phone-shot photo.
 */
async function makeJpegWithExif(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 200,
      height: 200,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .withMetadata({
      exif: {
        IFD0: {
          Make: "TestPhone",
          Model: "TestModel-9",
          Software: "AcreOSEXIFTest/1.0",
        },
        GPSIFD: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1, 46/1, 30/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "122/1, 25/1, 0/1",
        },
        ExifIFD: {
          DateTimeOriginal: "2025:01:01 12:00:00",
          BodySerialNumber: "SN-DEADBEEF-1234",
        },
      } as any,
    })
    .toBuffer();
}

/**
 * Read EXIF off a buffer. Returns the parsed object or `null` if the file
 * has no APP1/EXIF segment.
 */
async function readExif(buffer: Buffer): Promise<sharp.Metadata["exif"] | null> {
  const meta = await sharp(buffer).metadata();
  return meta.exif ?? null;
}

describe("Yara image pipeline — EXIF strip + hash", () => {
  it("strips EXIF (GPS, serial, date) from JPEG uploads", async () => {
    const original = await makeJpegWithExif();

    // Sanity: the source actually has EXIF before we strip.
    const beforeExif = await readExif(original);
    expect(beforeExif, "fixture should contain EXIF").toBeTruthy();

    const { stripped } = await stripAndHash(original, "image/jpeg");
    const afterExif = await readExif(stripped);
    expect(afterExif, "EXIF must be removed after pipeline").toBeFalsy();
  });

  it("computes a stable SHA-256 of the post-strip bytes", async () => {
    const original = await makeJpegWithExif();
    const a = await stripAndHash(original, "image/jpeg");
    const b = await stripAndHash(original, "image/jpeg");
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(sha256(a.stripped));
  });

  it("emits thumbnail / card / full variants with reasonable dimensions", async () => {
    const original = await makeJpegWithExif();
    const out = await processUploadedImage(original, "image/jpeg");

    expect(out.variants.thumbnail.width).toBe(200);
    expect(out.variants.thumbnail.height).toBe(200);
    // card / full clamp using inside-fit so 200×200 sources stay 200×200.
    expect(out.variants.card.width).toBeLessThanOrEqual(800);
    expect(out.variants.card.height).toBeLessThanOrEqual(600);
    expect(out.variants.full.width).toBeLessThanOrEqual(1920);
    expect(out.variants.full.height).toBeLessThanOrEqual(1440);

    // Each variant re-encodes to JPEG.
    for (const v of Object.values(out.variants)) {
      expect(v.mime).toBe("image/jpeg");
      expect(v.bytes).toBeGreaterThan(0);

      // Variants themselves must NOT carry EXIF.
      const exif = await readExif(v.buffer);
      expect(exif, `variant ${v.key} must be EXIF-free`).toBeFalsy();
    }
  });

  it("returns the same hash for two byte-identical sources (dedup proof)", async () => {
    const a = await makeJpegWithExif();
    const b = Buffer.from(a); // deep-copy of the bytes
    const ha = await stripAndHash(a, "image/jpeg");
    const hb = await stripAndHash(b, "image/jpeg");
    expect(ha.hash).toBe(hb.hash);
  });
});
