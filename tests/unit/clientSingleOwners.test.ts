/**
 * Two client-side duplicates, both with a live consequence. Unit 121.
 *
 * Found by the same repo-wide sweep that produced units 113/114/120: which
 * exported function names are defined in more than one production module? Most
 * of the 62 hits were benign coincidence. These two were not.
 *
 * ── `trackEvent` — two sinks, one of which discards in production ──────────
 *
 *   @/lib/analytics  → posthog.capture(...) — recorded, and read by the
 *                      acquisition dashboard.
 *   @/lib/telemetry  → queued, flushed to POST /api/telemetry — which in
 *                      PRODUCTION logged nothing, stored nothing, forwarded
 *                      nothing, and answered `{ success: true }`.
 *
 * Identical name, identical signature, both imported under the bare name
 * `trackEvent` in the same SPA. Whether an event survived depended on which
 * module the author's editor auto-imported — and the discarding path reported
 * success. Four modules were on the discarding side, `today.tsx` among them.
 * `@/lib/telemetry` is now a thin alias over the live sink, and the endpoint
 * refuses with 410 instead of issuing a receipt for work it never did.
 *
 * ── `useIsMobile` — same breakpoint, opposite answer ──────────────────────
 *
 *   @/hooks/use-mobile          → { isMobile, isTablet, isKeyboardOpen, isDesktop }
 *   components/MobileCardList   → bare boolean  (DELETED)
 *
 * Both used a 768px breakpoint, so they agreed on the VALUE and disagreed on
 * the SHAPE — and an object is always truthy. Anyone who auto-imported the
 * wrong one and wrote `if (useIsMobile())` got the mobile branch on a 1440px
 * desktop. The boolean copy had zero importers and was unused even inside its
 * own file: a dead export whose only effect was to be an ambiguous
 * auto-import target with an incompatible contract.
 *
 * This file pins both as single-owner, and (the load-bearing part) that a
 * SECOND definition of either name cannot reappear.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir)) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
      const full = path.join(dir, e);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e) || /\.(test|spec)\.tsx?$/.test(e)) continue;
      out.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, "client/src"));
  return out.sort();
}

/** Comments blanked, not removed — offsets stay honest and prose cannot trip a code check. */
function stripComments(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_a, p: string, c: string) => p + blank(c));
}

function definersOf(name: string): string[] {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\s*[:=]`);
  return clientFiles().filter((rel) =>
    re.test(stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"))),
  );
}

describe("the scan sees the client tree (vacuity guard, first)", () => {
  it("finds client files", () => {
    expect(clientFiles().length).toBeGreaterThan(300);
  });

  it("and the definer detector works on a name it should find", () => {
    // If this stops matching, every assertion below passes for the wrong reason.
    expect(definersOf("useIsMobile").length).toBeGreaterThan(0);
  });
});

describe("useIsMobile has one owner", () => {
  it("exactly one module defines it", () => {
    expect(
      definersOf("useIsMobile"),
      "a second useIsMobile appeared. The canonical hook returns an OBJECT and " +
        "any object is truthy, so a second boolean-returning copy means " +
        "`if (useIsMobile())` takes the mobile branch on a desktop viewport — " +
        "same breakpoint, opposite answer.",
    ).toEqual(["client/src/hooks/use-mobile.ts"]);
  });

  it("and it still returns the object shape its consumers destructure", () => {
    const src = fs.readFileSync(path.join(ROOT, "client/src/hooks/use-mobile.ts"), "utf8");
    for (const field of ["isMobile", "isTablet", "isDesktop"]) {
      expect(src, `use-mobile stopped returning ${field}`).toContain(field);
    }
  });
});

describe("trackEvent has one sink", () => {
  it("telemetry delegates rather than owning a second sink", () => {
    const src = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/lib/telemetry.ts"), "utf8"),
    );
    expect(src, "telemetry.ts imports the canonical sink").toMatch(
      /from\s+["']@\/lib\/analytics["']/,
    );
    expect(
      src,
      "telemetry.ts is POSTing its own event batch again. That endpoint stored " +
        "nothing in production and answered success — a receipt for work not done.",
    ).not.toContain("/api/telemetry");
    expect(src, "a second event queue is back").not.toMatch(/const\s+eventQueue/);
  });

  it("the retired endpoint refuses instead of issuing a false receipt", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/routes-dashboard.ts"), "utf8");
    const at = src.indexOf('api.post("/api/telemetry"');
    expect(at, "the telemetry endpoint is gone entirely — a cached bundle would 404").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(
      handler,
      "POST /api/telemetry answers success again for events it does not store.",
    ).not.toMatch(/success:\s*true/);
    expect(handler).toContain("410");
  });

  it("the analytics sink still actually captures (vacuity guard)", () => {
    // A consolidation onto a sink that no longer records would be worse than the
    // split it replaced.
    const src = fs.readFileSync(path.join(ROOT, "client/src/lib/analytics.ts"), "utf8");
    expect(src).toContain("posthog.capture(");
  });
});
