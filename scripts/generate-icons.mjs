#!/usr/bin/env node
/**
 * Rasterize the AcreOS mark into EVERY installed-app image the app references.
 * Run after editing client/public/favicon.svg or favicon-maskable.svg:
 *
 *   node scripts/generate-icons.mjs
 *
 * The target list is DERIVED, not typed: every PNG the web manifest lists
 * (by purpose), every `<link rel="icon" | "apple-touch-icon">` and every
 * `apple-touch-startup-image` in client/index.html. Before the Fieldstone
 * redesign the list was hand-written, missed pwa-maskable-192x192.png, and
 * the eight iOS splash images had no generator at all — so an icon refresh
 * left orange PNGs behind. tests/unit/installedBrandAssets.test.ts checks
 * that every referenced file exists at its declared size in the current
 * identity.
 *
 * Static installed assets always carry the default Fieldstone identity.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PUB = resolve(ROOT, "client/public");
const MASTER = readFileSync(resolve(PUB, "favicon.svg"));
const MASKABLE = readFileSync(resolve(PUB, "favicon-maskable.svg"));
const manifest = JSON.parse(readFileSync(resolve(PUB, "manifest.json"), "utf8"));
const html = readFileSync(resolve(ROOT, "client/index.html"), "utf8");

/** Fieldstone launch surface: limestone page, forest + brass mark. */
export const SPLASH_BACKGROUND = "#F8F8F3";
const SPLASH_MARK = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M3.5 27 L13.4 5 L18.6 5 L28.5 27" fill="none" stroke="#123B32" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="square"/>
  <path d="M10.6 27 L17.3 12.6 L24 27" fill="none" stroke="#B79A5B" stroke-width="2.2" stroke-linejoin="miter" stroke-linecap="square"/>
</svg>`;

const targets = new Map(); // out -> { kind, w, h }
const add = (out, kind, w, h) => targets.set(out.replace(/^\//, ""), { kind, w, h });

// 1. Manifest icons (PNG only; the SVG entry is the master itself).
for (const icon of manifest.icons ?? []) {
  if (!icon.src.endsWith(".png")) continue;
  const [w, h] = icon.sizes.split("x").map(Number);
  add(icon.src, icon.purpose === "maskable" ? "maskable" : "icon", w, h);
}
// Shortcut icons reuse manifest PNGs; include any new one they name.
for (const sc of manifest.shortcuts ?? []) {
  for (const icon of sc.icons ?? []) {
    if (!icon.src.endsWith(".png") || targets.has(icon.src.replace(/^\//, ""))) continue;
    const [w, h] = icon.sizes.split("x").map(Number);
    add(icon.src, "icon", w, h);
  }
}
// 2. <link rel="icon"> / apple-touch-icon PNGs in index.html.
for (const m of html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"[^>]*href="([^"]+\.png)"/g)) {
  const href = m[2];
  if (targets.has(href.replace(/^\//, ""))) continue;
  const size = href.includes("apple-touch-icon") ? 180 : /(\d+)/.exec(href)?.[1] ? Number(/(\d+)/.exec(href)[1]) : 16;
  add(href, "icon", size, size);
}
// Small favicon sizes some browsers request directly.
if (!targets.has("favicon-32.png")) add("/favicon-32.png", "icon", 32, 32);
// 3. iOS launch images — size from the file name (…-WxH.png).
for (const m of html.matchAll(/rel="apple-touch-startup-image"[^>]*href="([^"]+)"/g)) {
  const [, w, h] = /(\d+)x(\d+)\.png$/.exec(m[1]) ?? [];
  if (w) add(m[1], "splash", Number(w), Number(h));
}

for (const [out, { kind, w, h }] of targets) {
  const file = resolve(PUB, out);
  if (kind === "splash") {
    const markSize = Math.round(Math.min(w, h) * 0.28);
    const mark = await sharp(Buffer.from(SPLASH_MARK), { density: 1200 }).resize(markSize, markSize).png().toBuffer();
    await sharp({ create: { width: w, height: h, channels: 4, background: SPLASH_BACKGROUND } })
      .composite([{ input: mark, left: Math.round((w - markSize) / 2), top: Math.round((h - markSize) / 2 - h * 0.04) }])
      .png({ compressionLevel: 9 })
      .toFile(file);
  } else {
    await sharp(kind === "maskable" ? MASKABLE : MASTER, { density: 384 })
      .resize(w, h, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
  console.log(`✓ ${out} (${w}×${h}, ${kind})`);
}
console.log(`${targets.size} images written.`);
