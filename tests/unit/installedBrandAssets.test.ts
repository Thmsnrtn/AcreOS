/**
 * One AcreOS mark, and every installed-app image actually carries it.
 *
 * Before the Fieldstone redesign the app had three marks — the in-app logo
 * (a fixed brown→sage gradient parcel), a letter "A" tile on the landing nav
 * and footer, and a terracotta four-parcel grid on the installed icons — and
 * the icon generator's hand-typed list missed pwa-maskable-192x192.png while
 * the eight iOS launch images had no generator at all.
 *
 *   - mark: the logo component's two paths appear verbatim in favicon.svg,
 *     favicon-maskable.svg, the marketing mark and the generator's splash;
 *     the landing nav and footer render the shared component, not a letter.
 *   - assets: EVERY PNG the manifest or index.html references exists at its
 *     declared size and is painted in the current identity (corner pixel =
 *     Fieldstone forest for icons, limestone for launch images) — so an icon
 *     refresh that leaves an orange PNG behind fails here.
 *
 * Mutation probes: restore the terracotta pwa-maskable-192x192.png from git
 * history; change one coordinate in favicon.svg; put the "A" tile back in
 * LandingNav.tsx.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ACREOS_MARK_PATHS } from "../../client/src/components/acreos-logo";
import { COLORWAYS } from "../../shared/appearance";

const ROOT = path.resolve(__dirname, "../..");
const PUB = path.join(ROOT, "client/public");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const fieldstone = COLORWAYS.find((c) => c.id === "fieldstone")!;

describe("one mark", () => {
  const carriers = [
    "client/public/favicon.svg",
    "client/public/favicon-maskable.svg",
    "client/public/images/acreos-mark.svg",
    "scripts/generate-icons.mjs",
  ];
  for (const file of carriers) {
    it(`${file} draws the shared geometry`, () => {
      const src = read(file);
      expect(src).toContain(`d="${ACREOS_MARK_PATHS.boundary}"`);
      expect(src).toContain(`d="${ACREOS_MARK_PATHS.chevron}"`);
    });
  }

  it("the landing nav and footer render the shared mark, not a letter tile", () => {
    for (const file of ["client/src/pages/landing/LandingNav.tsx", "client/src/pages/landing/Footer.tsx"]) {
      const src = read(file);
      expect(src, file).toContain("<AcreosMark");
      expect(src, file).not.toMatch(/logo-mark[^>]*>\s*A\s*</);
    }
  });

  it("the old marks are gone", () => {
    expect(read("client/src/components/acreos-logo.tsx")).not.toContain("hsl(25 70% 35%)");
    expect(read("client/public/favicon.svg")).not.toMatch(/#C45C3E/i);
  });
});

describe("every referenced installed image exists, at size, in the current identity", () => {
  const manifest = JSON.parse(read("client/public/manifest.json"));
  const html = read("client/index.html");
  const refs = new Map<string, { w: number; h: number; kind: "icon" | "splash" }>();
  for (const icon of manifest.icons) {
    if (!icon.src.endsWith(".png")) continue;
    const [w, h] = icon.sizes.split("x").map(Number);
    refs.set(icon.src.replace(/^\//, ""), { w, h, kind: "icon" });
  }
  for (const m of html.matchAll(/<link\s+rel="apple-touch-icon"[^>]*href="\/([^"]+\.png)"/g)) refs.set(m[1], { w: 180, h: 180, kind: "icon" });
  for (const m of html.matchAll(/rel="apple-touch-startup-image"[^>]*href="\/([^"]+?(\d+)x(\d+)\.png)"/g)) {
    refs.set(m[1], { w: Number(m[2]), h: Number(m[3]), kind: "splash" });
  }

  it("found the population (manifest icons + touch icon + launch images)", () => {
    expect([...refs.values()].filter((r) => r.kind === "splash").length).toBeGreaterThanOrEqual(8);
    expect([...refs.values()].filter((r) => r.kind === "icon").length).toBeGreaterThanOrEqual(5);
  });

  const hex = (rgb: number[]) => "#" + rgb.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
  for (const [file, ref] of refs) {
    it(`${file} is ${ref.w}×${ref.h} and current`, async () => {
      const full = path.join(PUB, file);
      expect(fs.existsSync(full), `${file} is referenced but missing — run node scripts/generate-icons.mjs`).toBe(true);
      const meta = await sharp(full).metadata();
      expect([meta.width, meta.height]).toEqual([ref.w, ref.h]);
      const { data } = await sharp(full).extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      const expected = ref.kind === "splash" ? fieldstone.light.page : fieldstone.light.rail;
      expect(hex([...data]), `${file} corner is not the Fieldstone ${ref.kind === "splash" ? "limestone" : "forest"} — stale image`).toBe(expected.toUpperCase());
    });
  }

  it("manifest colours are the Fieldstone identity", () => {
    expect(manifest.theme_color).toBe(fieldstone.light.rail);
    expect(manifest.background_color).toBe(fieldstone.light.page);
  });
});
