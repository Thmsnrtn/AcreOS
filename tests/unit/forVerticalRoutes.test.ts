/**
 * G1.3 — /for/<vertical> registry pages, pinned against the LIVE registry
 * (mirrors landingVerticalTiers.test.ts — derived, deliberately NOT a
 * snapshot, so a registry change flows through without touching this file).
 *
 * Guarantees pinned:
 *   1. Every BUSINESS_TYPE_IDS member yields exactly one /for/* route in the
 *      public-route enumeration (sitemap + robots derive from PUBLIC_ROUTES,
 *      so a vertical can never silently lack — or lose — its page).
 *   2. Slugs are kebab-case, unique, and round-trip through
 *      slugToBusinessTypeId; the G1 exit line's example URL
 *      (/for/land-flippers) holds.
 *   3. deriveForPage renders PURELY from the registries: label verbatim,
 *      onboarding vocabulary + finish surface, spotlight/integration lists
 *      exactly the registry's.
 *   4. D-4 honesty: no copy the page renders calls a vertical "beta" unless
 *      the registry maturity actually says so (derived — a future maturity
 *      flip changes the assertion, not this file).
 *   5. Wiring: the page component consumes the derivation and carries the
 *      demo CTA (/demo), and /demo itself is a public route.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
} from "../../shared/business-types";
import {
  FOR_VERTICAL_SLUGS,
  PUBLIC_ROUTES,
  forVerticalPath,
  listForVerticalRoutes,
  slugToBusinessTypeId,
} from "../../shared/seo/public-routes";
import { deriveForPage } from "../../client/src/pages/for/derive";

const REPO_ROOT = resolve(__dirname, "..", "..");
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("/for route enumeration derives from the business-type registry", () => {
  it("yields exactly one /for/* public route per registered vertical", () => {
    const forPaths = PUBLIC_ROUTES.filter((r) => r.path.startsWith("/for/")).map(
      (r) => r.path,
    );
    const expected = BUSINESS_TYPE_IDS.map((id) => forVerticalPath(id));

    expect([...forPaths].sort()).toEqual([...expected].sort());
    expect(new Set(forPaths).size).toBe(forPaths.length);
  });

  it("keeps PUBLIC_ROUTES free of duplicate paths overall", () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("uses kebab-case, unique slugs — and the G1 exit line's /for/land-flippers", () => {
    const slugs = BUSINESS_TYPE_IDS.map((id) => FOR_VERTICAL_SLUGS[id]);
    for (const slug of slugs) {
      expect(slug, `slug "${slug}" must be kebab-case`).toMatch(KEBAB);
    }
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(forVerticalPath("land_flipper")).toBe("/for/land-flippers");
  });

  it("round-trips every slug through slugToBusinessTypeId; unknown slugs are null", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      expect(slugToBusinessTypeId(FOR_VERTICAL_SLUGS[id])).toBe(id);
    }
    expect(slugToBusinessTypeId("not-a-vertical")).toBeNull();
    expect(slugToBusinessTypeId("")).toBeNull();
  });

  it("marks the /for routes prerender:false (script/prerender.ts fails the build on meta-less prerender routes)", () => {
    for (const route of listForVerticalRoutes()) {
      expect(route.prerender, `${route.path} must stay prerender:false until script/prerender.ts carries its head meta`).toBe(false);
    }
  });

  it("lists /demo as a public route (the /for pages' CTA destination)", () => {
    expect(PUBLIC_ROUTES.map((r) => r.path)).toContain("/demo");
  });
});

describe("deriveForPage renders purely from the live registries", () => {
  it("derives content for every registered vertical, with the registry label verbatim", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const slug = FOR_VERTICAL_SLUGS[id];
      const content = deriveForPage(slug);
      expect(content, `deriveForPage must resolve slug "${slug}"`).not.toBeNull();
      expect(content!.id).toBe(id);
      expect(content!.path).toBe(forVerticalPath(id));
      expect(content!.label).toBe(BUSINESS_TYPES[id].label);
      expect(content!.shortDescription).toBe(BUSINESS_TYPES[id].shortDescription);
      expect(content!.maturity).toBe(BUSINESS_TYPES[id].maturity);
      expect(content!.headlineAudience).toBe(slug.split("-").join(" "));
      expect(content!.noun.length).toBeGreaterThan(0);
      expect(content!.finishBlurb.length).toBeGreaterThan(0);
      // Spotlights + integrations are exactly the registry's lists, in order.
      expect(content!.spotlights.map((s) => s.id)).toEqual(
        BUSINESS_TYPES[id].spotlightModules,
      );
      expect(content!.integrations.map((i) => i.id)).toEqual(
        BUSINESS_TYPES[id].integrations,
      );
      // Internal links cover every OTHER vertical exactly once.
      expect(content!.others.map((o) => o.id).sort()).toEqual(
        BUSINESS_TYPE_IDS.filter((o) => o !== id).sort(),
      );
    }
  });

  it("returns null for unknown slugs — never a fabricated page", () => {
    expect(deriveForPage("land-flipping")).toBeNull();
    expect(deriveForPage("unknown")).toBeNull();
  });

  it("D-4: no rendered copy calls a vertical 'beta' unless the registry maturity says so", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const content = deriveForPage(FOR_VERTICAL_SLUGS[id])!;
      const renderedCopy = [
        content.label,
        content.shortDescription,
        content.noun,
        content.finishCta,
        content.finishBlurb,
        ...content.spotlights.map((s) => s.label),
        ...content.integrations.map((i) => i.label),
      ].join(" ");
      if (BUSINESS_TYPES[id].maturity !== "beta") {
        expect(
          /\bbeta\b/i.test(renderedCopy),
          `${id} is registry-maturity "${BUSINESS_TYPES[id].maturity}" but its /for copy says "beta"`,
        ).toBe(false);
      }
    }
  });

  it("every spotlight/integration id renders a non-empty display label", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const content = deriveForPage(FOR_VERTICAL_SLUGS[id])!;
      for (const s of content.spotlights) {
        expect(s.label.trim().length, `spotlight ${s.id}`).toBeGreaterThan(0);
      }
      for (const i of content.integrations) {
        expect(i.label.trim().length, `integration ${i.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("page wiring (built AND wired — the wave-discipline check)", () => {
  const pageSrc = readFileSync(
    join(REPO_ROOT, "client", "src", "pages", "for", "vertical.tsx"),
    "utf8",
  );
  const appSrc = readFileSync(
    join(REPO_ROOT, "client", "src", "App.tsx"),
    "utf8",
  );

  it("the page component consumes deriveForPage and links the demo CTA", () => {
    expect(pageSrc).toContain("deriveForPage");
    expect(pageSrc).toContain('href="/demo"');
  });

  it("App.tsx mounts /for/:vertical and /demo in the public section", () => {
    expect(appSrc).toContain('path="/for/:vertical"');
    expect(appSrc).toContain('path="/demo"');
  });

  it("the landing footer links every vertical's /for page (crawl path for prerender:false pages)", () => {
    const footerSrc = readFileSync(
      join(REPO_ROOT, "client", "src", "pages", "landing", "Footer.tsx"),
      "utf8",
    );
    // Derived rendering — the footer maps BUSINESS_TYPE_IDS through
    // forVerticalPath rather than hardcoding 15 links.
    expect(footerSrc).toContain("BUSINESS_TYPE_IDS.map");
    expect(footerSrc).toContain("forVerticalPath");
  });
});
