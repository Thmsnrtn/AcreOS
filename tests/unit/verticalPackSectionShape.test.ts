/**
 * Vertical-pack pricing surface — client source-shape contract (wave V1,
 * founder ruling #11 2026-07-28).
 *
 * The section must render REAL catalog data from GET /api/billing/packs
 * (which reads VERTICAL_PACKS in shared/billing/tier-pricing.ts). These
 * checks pin the honesty properties that a rendered-DOM test can't cheaply
 * cover across all five packs × four states:
 *
 *   - no hardcoded pack prices in the component (the 2026-05 "seven
 *     pricing tables" drift episode must not restart here);
 *   - waitlisted packs RENDER with honest framing rather than being
 *     filtered out (the landing promises these verticals);
 *   - the checkout mutation invalidates the packs query (eslint
 *     use-mutation-must-invalidate contract, asserted at source level);
 *   - the designed loading/error/empty states use the canonical primitives
 *     (Skeleton / QueryErrorState / EmptyState);
 *   - an unconfigured Stripe price renders "Purchase not yet enabled"
 *     instead of a live button that 503s.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { VERTICAL_PACKS } from "../../shared/billing/tier-pricing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECTION_TSX = resolve(
  __dirname,
  "../../client/src/components/billing/VerticalPackSection.tsx",
);
const PRICING_TSX = resolve(__dirname, "../../client/src/pages/pricing.tsx");

const section = readFileSync(SECTION_TSX, "utf8");
const pricing = readFileSync(PRICING_TSX, "utf8");

describe("VerticalPackSection — data comes from the API, not literals", () => {
  it("fetches the catalog from /api/billing/packs", () => {
    expect(section).toMatch(/\/api\/billing\/packs/);
  });

  it("contains NO hardcoded pack price — every real pack dollar/cent figure is absent", () => {
    const forbidden = new Set<number>();
    for (const pack of Object.values(VERTICAL_PACKS)) {
      forbidden.add(pack.priceMonthlyCents); // e.g. 10000
      forbidden.add(pack.priceYearlyCents); // e.g. 100000
      forbidden.add(pack.priceMonthlyCents / 100); // e.g. 100
      forbidden.add(pack.priceYearlyCents / 100); // e.g. 1000
    }
    for (const value of forbidden) {
      const literal = new RegExp(`[^\\d.]\\$?${value}(?![\\d])`);
      expect(section, `pack price literal ${value} must not be hardcoded`).not.toMatch(literal);
    }
  });

  it("renders prices via the shared usd() formatter from API fields", () => {
    expect(section).toMatch(/usd\(/);
    expect(section).toMatch(/priceMonthly/);
    expect(section).toMatch(/priceYearly/);
  });

  it("renders pack copy (name/tagline) from the API payload, not literals", () => {
    for (const pack of Object.values(VERTICAL_PACKS)) {
      expect(section).not.toContain(pack.displayName);
      expect(section).not.toContain(pack.tagline);
    }
    expect(section).toMatch(/pack\.name/);
    expect(section).toMatch(/pack\.tagline/);
  });
});

describe("VerticalPackSection — waitlisted packs render, never hidden", () => {
  it("maps over ALL packs and never filters by purchasability", () => {
    expect(section).toMatch(/data\.packs\.map\(/);
    expect(section).not.toMatch(/packs\s*\.\s*filter/);
    expect(section).not.toMatch(/filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.purchasable/);
  });

  it("shows the honest waitlist state with the server's reason", () => {
    expect(section).toMatch(/waitlistReason/);
    expect(section).toContain("On the waitlist");
  });

  it("unconfigured Stripe price renders a disabled honest state, not a live 503 button", () => {
    expect(section).toMatch(/stripeConfigured/);
    expect(section).toContain("Purchase not yet enabled");
  });

  it("owned packs render an Active state", () => {
    expect(section).toMatch(/pack\.owned/);
    expect(section).toContain("Active");
  });
});

describe("VerticalPackSection — checkout flow and designed states", () => {
  it("purchases through the existing pack checkout endpoint and redirects to Stripe", () => {
    expect(section).toMatch(/\/api\/billing\/packs\/checkout/);
    expect(section).toMatch(/window\.location\.href\s*=/);
  });

  it("the checkout mutation invalidates the packs query (use-mutation-must-invalidate)", () => {
    expect(section).toMatch(/invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*\.\.\.PACKS_QUERY_KEY/);
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
  it("pricing.tsx renders VerticalPackSection with the annual toggle wired through", () => {
    expect(pricing).toMatch(/import\s*\{\s*VerticalPackSection\s*\}/);
    expect(pricing).toMatch(/<VerticalPackSection\s+annual=\{annual\}/);
  });
});
