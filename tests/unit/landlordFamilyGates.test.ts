/**
 * Landlord-family stranding fix (wave V1, founder ruling #11).
 *
 * short_term_rental, multifamily, and mobile_home all collapse to the
 * landlord persona (persona-mapping.ts) and receive rental seed data at
 * onboarding — yet the Rentals nav module, the /today "Your surfaces"
 * landlord cluster, and the dashboard widget resolver all gated on
 * buy_and_hold alone, leaving the three siblings stranded: seeded
 * leases/tenants with no surface to use them. This suite pins the cure
 * across all three resolution layers, plus the tax-delinquent widget gap
 * (tax_lien_deed fell through to the fabricated land mock).
 *
 * Component files (.tsx) are asserted via source-shape contracts — the
 * same pattern as mobileNavFixedDoors.test.ts — because these tests run
 * in the node env with no DOM.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { resolveVerticalSurfaces } from "../../client/src/lib/today-vertical-surfaces";
import { BUSINESS_TYPE_TO_PERSONA } from "../../shared/models/persona-mapping";

const CLIENT = path.resolve(__dirname, "../../client/src");
const LANDLORD_FAMILY = ["buy_and_hold", "short_term_rental", "multifamily", "mobile_home"] as const;

describe("landlord family — persona model (the premise of the fix)", () => {
  it("all four businessTypes collapse to the landlord persona", () => {
    for (const bt of LANDLORD_FAMILY) {
      expect(BUSINESS_TYPE_TO_PERSONA[bt], bt).toBe("landlord");
    }
  });
});

describe("Rentals nav module reaches the whole landlord family", () => {
  const src = fs.readFileSync(path.join(CLIENT, "components/layout-sidebar.tsx"), "utf-8");

  it("the landlord module's businessTypeOnly gate lists all four family businessTypes", () => {
    const match = src.match(/id:\s*"landlord"[\s\S]*?businessTypeOnly:\s*\[([^\]]*)\]/);
    expect(match, "landlord module with a businessTypeOnly gate must exist").toBeTruthy();
    const gate = match![1];
    for (const bt of LANDLORD_FAMILY) {
      expect(gate, `Rentals gate must include ${bt}`).toContain(`"${bt}"`);
    }
  });
});

describe("/today landlord surfaces cluster reaches the whole family", () => {
  it("resolves the landlord cluster for all four businessTypes", () => {
    for (const bt of LANDLORD_FAMILY) {
      const clusters = resolveVerticalSurfaces({ businessType: bt, investorType: "land" });
      expect(
        clusters.map((c) => c.id),
        `${bt} should get the landlord surfaces cluster`,
      ).toContain("landlord");
    }
  });

  it("does not leak the landlord cluster to non-family businessTypes", () => {
    for (const bt of ["residential_wholesaler", "fix_and_flip", "subdivider", "tax_lien_deed", "land_flipper"]) {
      const clusters = resolveVerticalSurfaces({ businessType: bt, investorType: "land" });
      expect(clusters.map((c) => c.id), bt).not.toContain("landlord");
    }
  });
});

describe("dashboard widget routing (type-specific-widgets resolveCategory)", () => {
  const src = fs.readFileSync(
    path.join(CLIENT, "components/dashboard/type-specific-widgets.tsx"),
    "utf-8",
  );

  it("routes the three siblings to the buy_and_hold widgets, not the land fall-through", () => {
    const match = src.match(/case "buy_and_hold":[\s\S]*?return "buy_and_hold";/);
    expect(match, "buy_and_hold case group must exist in resolveCategory").toBeTruthy();
    for (const bt of ["short_term_rental", "multifamily", "mobile_home"]) {
      expect(match![0], `${bt} must share the buy_and_hold widget category`).toContain(`case "${bt}":`);
    }
  });

  it("routes tax_lien_deed to its own tax_delinquent category (no more land mock)", () => {
    expect(src).toMatch(/case "tax_lien_deed":\s*\n\s*return "tax_delinquent";/);
    expect(src).toContain('{category === "tax_delinquent" && <TaxDelinquentWidgets />}');
  });

  it("the tax widget reads the real redemption-clock summary endpoint and never fabricates", () => {
    expect(src).toContain('"/api/tax-certificates/dashboard/summary"');
    // Suppress-on-failure (403/error → no block) + honest EmptyState when
    // the org holds zero certificates.
    expect(src).toContain("if (!live) return null;");
    expect(src).toMatch(/activeCount === 0[\s\S]*?EmptyState/);
  });
});
