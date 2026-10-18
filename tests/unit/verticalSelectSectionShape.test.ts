/**
 * Vertical selection surface — client source-shape contract (founder
 * decision 2026-10-18: verticals are included profiles, never priced).
 *
 * The section must render REAL catalog data from GET /api/verticals
 * (which reads VERTICAL_PACKS in shared/billing/tier-pricing.ts). These
 * checks pin the honesty properties that a rendered-DOM test can't cheaply
 * cover across all five verticals × four states:
 *
 *   - no prices anywhere in the component (verticals are never priced);
 *   - no checkout endpoint references (there is no purchase path);
 *   - waitlisted verticals RENDER with honest framing rather than being
 *     filtered out (the landing promises these verticals);
 *   - the select/deselect mutations invalidate the verticals query (eslint
 *     use-mutation-must-invalidate contract, asserted at source level);
 *   - the designed loading/error/empty states use the canonical primitives
 *     (Skeleton / QueryErrorState / EmptyState);
 *   - selected verticals render a Selected state.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { VERTICAL_PACKS } from "../../shared/billing/tier-pricing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECTION_TSX = resolve(
  __dirname,
  "../../client/src/components/billing/VerticalSelectSection.tsx",
);
const PRICING_TSX = resolve(__dirname, "../../client/src/pages/pricing.tsx");

const section = readFileSync(SECTION_TSX, "utf8");
const pricing = readFileSync(PRICING_TSX, "utf8");

describe("VerticalSelectSection — data comes from the API, not literals", () => {
  it("fetches the catalog from /api/verticals", () => {
    expect(section).toMatch(/\/api\/verticals/);
  });

  it("contains NO prices and NO checkout references", () => {
    expect(section).not.toMatch(/\/api\/billing\/packs/);
    expect(section).not.toMatch(/checkout/i);
    expect(section).not.toMatch(/stripeConfigured/);
    expect(section).not.toMatch(/priceMonthly/);
    expect(section).not.toMatch(/priceYearly/);
    expect(section).not.toMatch(/window\.location\.href/);
  });

  it("renders vertical copy (name/tagline/features) from the API payload, not literals", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(section).not.toContain(pack.displayName);
      expect(section).not.toContain(pack.tagline);
    }
    expect(section).toMatch(/vertical\.name/);
    expect(section).toMatch(/vertical\.tagline/);
    expect(section).toMatch(/vertical\.features/);
  });
});

describe("VerticalSelectSection — waitlisted verticals render, never hidden", () => {
  it("maps over ALL verticals and never filters by selectability", () => {
    expect(section).toMatch(/data\.verticals\.map\(/);
    expect(section).not.toMatch(/verticals\s*\.\s*filter/);
    expect(section).not.toMatch(/filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.selectable/);
  });

  it("shows the honest waitlist state with the server's reason", () => {
    expect(section).toMatch(/waitlistReason/);
    expect(section).toContain("On the waitlist");
  });

  it("selected verticals render a Selected state", () => {
    expect(section).toMatch(/vertical\.selected/);
    expect(section).toContain("Selected");
  });

  it("select/deselect go through the selection endpoints", () => {
    expect(section).toMatch(/\/api\/verticals\/select/);
    expect(section).toMatch(/\/api\/verticals\/deselect/);
  });
});

describe("VerticalSelectSection — mutations and designed states", () => {
  it("the select/deselect mutations invalidate the verticals query (use-mutation-must-invalidate)", () => {
    expect(section).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*\.\.\.VERTICALS_QUERY_KEY/);
    expect(section).not.toMatch(/allow-no-invalidation/);
  });

  it("uses the canonical Skeleton / QueryErrorState / EmptyState primitives", () => {
    expect(section).toMatch(/from\s+"@\/components\/ui\/skeleton"/);
    expect(section).toMatch(/from\s+"@\/components\/query-error-state"/);
    expect(section).toMatch(/from\s+"@\/components\/empty-state"/);
    expect(section).toMatch(/<QueryErrorState/);
    expect(section).toMatch(/<EmptyState/);
    expect(section).toMatch(/<Skeleton/);
  });

  it("animates with the shared stagger variants (no ad-hoc animation values)", () => {
    expect(section).toMatch(/staggerContainer/);
    expect(section).toMatch(/staggerItem/);
    expect(section).toMatch(/from\s+"@\/lib\/animations"/);
  });
});

describe("pricing page — the section is actually mounted", () => {
  it("pricing.tsx renders VerticalSelectSection", () => {
    expect(pricing).toMatch(/import\s*\{\s*VerticalSelectSection\s*\}/);
    expect(pricing).toMatch(/<VerticalSelectSection\s*\/>/);
  });

  it("pricing.tsx no longer references the removed pack section", () => {
    expect(pricing).not.toMatch(/VerticalPackSection/);
  });
});
