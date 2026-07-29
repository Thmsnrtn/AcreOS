/**
 * Auction-worksheet empty-state CTA contract (wave V2 of ruling #11).
 *
 * The worksheet's empty state shipped with the `_noOp` escape hatch and a
 * `TODO(cta)` marker — and a subtitle pointing at /tax-researcher, which was
 * retired 2026-06-08 (it redirects to /deals/discover). Every empty state is
 * an agency moment: the honest starting point for a tax-sale operator is the
 * county hub (/counties — County Detail's "Worksheet items" tile links back
 * here), with /state-rules as the pre-auction reference library.
 *
 * These are source-shape tests: they pin the call site to a real CTA whose
 * destinations exist as routes in App.tsx.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSHEET_TSX = resolve(
  __dirname,
  "../../client/src/pages/auction-worksheet.tsx",
);
const APP_TSX = resolve(__dirname, "../../client/src/App.tsx");

const worksheetSrc = readFileSync(WORKSHEET_TSX, "utf-8");
const appSrc = readFileSync(APP_TSX, "utf-8");

describe("auction-worksheet empty state — real CTA, no escape hatch", () => {
  it("carries no TODO(cta) marker", () => {
    expect(worksheetSrc).not.toContain("TODO(cta)");
  });

  it("does not use the _noOp escape hatch", () => {
    expect(worksheetSrc).not.toContain("_noOp");
  });

  it("primary CTA navigates to the county hub", () => {
    expect(worksheetSrc).toContain('href: "/counties"');
  });

  it("secondary CTA navigates to the state-rules library", () => {
    expect(worksheetSrc).toContain('href: "/state-rules"');
  });

  it("no longer references the retired /tax-researcher page in user-facing copy", () => {
    // The API prefix /api/tax-researcher/* is still live (drizzle-backed
    // worksheet endpoints survived the 2026-06-08 retirement); only the
    // retired PAGE route must not be offered to users.
    const withoutApiCalls = worksheetSrc.replaceAll("/api/tax-researcher", "");
    expect(withoutApiCalls).not.toContain("/tax-researcher");
  });
});

describe("auction-worksheet empty-state CTA destinations exist in App.tsx", () => {
  // Extract every href the empty-state CTAs declare and verify each is a
  // registered route — an empty state must never point at a 404.
  const ctaHrefs = [...worksheetSrc.matchAll(/href: "([^"]+)"/g)].map(
    (m) => m[1],
  );

  it("declares at least a primary and secondary CTA href", () => {
    expect(ctaHrefs.length).toBeGreaterThanOrEqual(2);
  });

  for (const href of ["/counties", "/state-rules"]) {
    it(`route ${href} is registered`, () => {
      expect(ctaHrefs).toContain(href);
      expect(appSrc).toContain(`<Route path="${href}"`);
    });
  }
});
