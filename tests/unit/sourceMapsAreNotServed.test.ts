/**
 * The client's original TypeScript is not a public asset.
 *
 * ── THE DEFECT, OBSERVED ON PRODUCTION ──────────────────────────────────────
 * `vite.config.ts` sets `sourcemap: "hidden"` for production. "hidden"
 * suppresses the `//# sourceMappingURL` COMMENT — it still WRITES the .map
 * files. `server/static.ts` then mounts `express.static(distPath)` with no
 * extension filter, and the map's URL is derivable from the script tag in the
 * HTML, so every one of them was publicly fetchable.
 *
 * Measured 2026-09-04 against the live site, not inferred:
 *
 *     GET https://acreos.io/assets/index-BHxNHrKf.js.map  ->  200, 5,239,629 bytes
 *
 * 474 maps, 55 MB, containing the original TypeScript with the comments that
 * name the security gates, the founder-only surfaces and the tenant-isolation
 * reasoning. It de-minifies JavaScript the browser already receives — no
 * server code, no credentials, no tenant data — so this is a readability
 * exposure rather than a breach. It is still ours to close.
 *
 * ── WHAT THIS PINS, AND WHY BOTH HALVES ─────────────────────────────────────
 *   1. The BUILD deletes every map from the served directory after the Sentry
 *      upload, and ASSERTS none survived — a silent no-op there restores the
 *      exposure while the log line still reads like a success.
 *   2. The SERVER refuses `.map` requests regardless, above both static
 *      mounts. That is what survives a partial build, a stale dist, a
 *      hand-copied artifact, or someone reverting the delete.
 *
 * Neither alone is enough: the delete can be skipped, and a guard alone leaves
 * 55 MB of source sitting in the image for anything else that serves it.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

describe("the build removes the maps it just uploaded", () => {
  const build = read("script/build.ts");

  it("has a strip step, and it runs after the Sentry upload", () => {
    const strip = build.indexOf("async function stripSourceMapsFromDist");
    expect(strip, "the strip step is gone — the maps go back into the image").toBeGreaterThan(-1);
    const call = build.lastIndexOf("await stripSourceMapsFromDist()");
    const upload = build.lastIndexOf("await uploadSourceMapsToSentry(release)");
    expect(call, "nothing calls the strip step").toBeGreaterThan(-1);
    expect(
      call,
      "the strip runs BEFORE the upload, so Sentry would receive nothing and " +
        "every stack trace would arrive unsymbolicated",
    ).toBeGreaterThan(upload);
  });

  it("runs unconditionally, not only for production builds", () => {
    // A preview or dev build that serves dist/public exposes the same files,
    // and "we only ship maps by accident on non-production hosts" is not a
    // property anyone can check.
    const call = build.lastIndexOf("await stripSourceMapsFromDist()");
    const guard = build.lastIndexOf('process.env.NODE_ENV === "production"', call);
    const closeOfGuard = build.indexOf("}", guard);
    expect(
      call,
      "the strip is inside the production-only branch",
    ).toBeGreaterThan(closeOfGuard);
  });

  it("covers the compressed twins, not just .map", () => {
    // The compression plugin emits .map.gz and .map.br beside each .map, and
    // those are exactly as readable.
    const fn = build.slice(build.indexOf("async function stripSourceMapsFromDist"));
    expect(fn).toMatch(/\\\.map\(\\\.gz\|\\\.br\)\?\$/);
  });

  it("verifies rather than assumes — a no-op delete must fail the build", () => {
    // Bounded by the NEXT TOP-LEVEL declaration, not the next `async function`
    // — this one nests two helpers, so the naive slice stopped inside it and
    // the assertion below passed over the wrong text.
    const start = build.indexOf("async function stripSourceMapsFromDist");
    const end = build.indexOf("\nasync function buildAll", start);
    const fn = build.slice(start, end === -1 ? build.length : end);
    expect(fn, "the strip step reports success without checking").toContain("survivors");
    expect(fn).toMatch(/throw new Error/);
  });
});

describe("the server refuses a .map even if one is present", () => {
  const statics = read("server/static.ts");

  it("guards before every static mount", () => {
    const guard = statics.indexOf(".map(\\.gz|\\.br)?(\\?|$)");
    expect(guard, "the .map guard is gone from server/static.ts").toBeGreaterThan(-1);
    for (const mount of ["preCompressedAssets(distPath)", "express.static(distPath"]) {
      const at = statics.indexOf(mount);
      expect(at, `${mount} is gone — re-point this test`).toBeGreaterThan(-1);
      expect(
        guard,
        `the .map guard is registered AFTER ${mount}. Express evaluates ` +
          "middleware in registration order, so the mount answers first and the " +
          "guard never runs — the same ordering bug the /api/admin MFA gate had.",
      ).toBeLessThan(at);
    }
  });

  it("answers 404, not 403 — a 403 confirms the file is there", () => {
    const at = statics.indexOf(".map(\\.gz|\\.br)?(\\?|$)");
    const block = statics.slice(at, at + 300);
    expect(block).toMatch(/status\(404\)/);
    expect(block).not.toMatch(/status\(403\)/);
  });

  it("the guard's own regex matches what it must and nothing it must not", () => {
    // Behavioural, not textual: the pattern is extracted from the source and
    // exercised. A regex that silently stops matching reads exactly like a
    // directory with no maps in it.
    const m = /if \(\/(.+?)\/\.test\(req\.path\)\)/.exec(statics);
    expect(m, "the guard's condition changed shape — re-point this test").not.toBeNull();
    const re = new RegExp(m![1]);
    for (const blocked of [
      "/assets/index-BHxNHrKf.js.map",
      "/assets/vendor-charts.js.map.gz",
      "/assets/vendor-map.js.map.br",
      "/assets/index.css.map?v=2",
    ]) {
      expect(re.test(blocked), `${blocked} should be refused`).toBe(true);
    }
    for (const allowed of [
      "/assets/index-BHxNHrKf.js",
      "/assets/index.css",
      "/maps",              // the Map door
      "/api/maps/search",
      "/assets/sitemap.xml",
    ]) {
      expect(re.test(allowed), `${allowed} must still be served`).toBe(false);
    }
  });
});

describe("the emit setting is still the one that makes this necessary", () => {
  it("vite writes maps in production, which is why they must be deleted", () => {
    // If this ever becomes `false`, the strip step is harmless but the Sentry
    // upload has nothing to send — so a reader who changes it should find out
    // here that the two are linked.
    const vite = read("vite.config.ts");
    expect(vite).toMatch(/sourcemap:\s*process\.env\.NODE_ENV === "production"\s*\?\s*"hidden"/);
  });
});
