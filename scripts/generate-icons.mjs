#!/usr/bin/env node
/**
 * Rasterize the master favicon.svg (and favicon-maskable.svg) into
 * every PNG size the manifest, Apple touch icon, and favicon link
 * tags consume. Run after editing either SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs (all under client/public):
 *   favicon.png             16x16   (browser tab fallback)
 *   favicon-32.png          32x32
 *   apple-touch-icon.png    180x180 (iOS home screen)
 *   pwa-192x192.png         192x192
 *   pwa-512x512.png         512x512
 *   pwa-maskable-512x512.png 512x512 (from favicon-maskable.svg)
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PUB = resolve(ROOT, "client/public");
const MASTER = readFileSync(resolve(PUB, "favicon.svg"));
const MASKABLE = readFileSync(resolve(PUB, "favicon-maskable.svg"));

const TARGETS = [
  { src: MASTER, size: 16, out: "favicon.png" },
  { src: MASTER, size: 32, out: "favicon-32.png" },
  { src: MASTER, size: 180, out: "apple-touch-icon.png" },
  { src: MASTER, size: 192, out: "pwa-192x192.png" },
  { src: MASTER, size: 512, out: "pwa-512x512.png" },
  { src: MASKABLE, size: 512, out: "pwa-maskable-512x512.png" },
];

for (const { src, size, out } of TARGETS) {
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(PUB, out));
  console.log(`✓ ${out} (${size}×${size})`);
}
