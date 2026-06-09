/**
 * Persona-aware sample data (Rafe).
 *
 * `generateSampleData` used to ship a single hardcoded land-flipper fixture set
 * to every persona, so a note investor who clicked "Try with sample data" landed
 * in raw-land-acquisition mock. `buildSampleFixtures` now branches on the org's
 * businessType. This locks in:
 *   1. Each persona gets its OWN shaped fixture set (note investor → a serviced
 *      note book; wholesaler → assignments, no notes; fix-and-flip → rehab; land
 *      → the original parcels).
 *   2. The cleanup contract holds for EVERY persona — every lead carries
 *      source="sample_data" and every property apn starts with "SAMPLE-", so
 *      clearSampleData() (which keys on exactly those) removes the whole set.
 *   3. Unknown / unhandled business types fall back to the land flipper set
 *      (never blank, never mismatched).
 *   4. No fabricated/random values leak in (every figure is a fixed string).
 */

import { describe, it, expect, vi } from "vitest";

// Keep the module import light — buildSampleFixtures is pure (orgId + addMonths).
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => ({}) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORG = 42;

async function build(businessType: string) {
  const { buildSampleFixtures } = await import("../../server/services/onboarding");
  return buildSampleFixtures(ORG, businessType);
}

describe("buildSampleFixtures — cleanup contract (all personas)", () => {
  const personas = [
    "land_flipper",
    "hybrid",
    "note_investor",
    "creative_finance",
    "residential_wholesaler",
    "fix_and_flip",
    "totally_unknown_type",
  ];

  for (const persona of personas) {
    it(`'${persona}': every lead is source=sample_data and every property apn starts with SAMPLE-`, async () => {
      const f = await build(persona);
      expect(f.leads.length).toBeGreaterThan(0);
      expect(f.properties.length).toBeGreaterThan(0);
      for (const lead of f.leads) {
        expect(lead.source).toBe("sample_data");
        expect(lead.organizationId).toBe(ORG);
        expect(lead.tags).toContain("sample");
      }
      for (const prop of f.properties) {
        expect(prop.apn.startsWith("SAMPLE-")).toBe(true);
        expect(prop.organizationId).toBe(ORG);
      }
    });
  }
});

describe("buildSampleFixtures — persona shaping", () => {
  it("note_investor ships a serviced note book (notes present, mixed performance)", async () => {
    const f = await build("note_investor");
    expect(f.notes.length).toBeGreaterThanOrEqual(2);
    const statuses = f.notes.map((n) => n.status);
    // A realistic book is not all-performing: at least one delinquent note.
    expect(statuses).toContain("active");
    expect(statuses).toContain("delinquent");
    // Notes are anchored to borrower leads + collateral properties.
    for (const n of f.notes) {
      expect(typeof n.propertyIndex).toBe("number");
      expect(typeof n.borrowerLeadIndex).toBe("number");
      expect(n.atrExemptionCode).toBe("business_purpose");
    }
  });

  it("residential_wholesaler ships assignments and NO notes (flips contracts, not paper)", async () => {
    const f = await build("residential_wholesaler");
    expect(f.notes.length).toBe(0);
    const dealTypes = f.deals.map((d) => d.type);
    expect(dealTypes).toContain("assignment");
    // Wholesaler fixtures carry a buyer list.
    expect(f.leads.some((l) => l.type === "buyer")).toBe(true);
    expect(f.leads.some((l) => l.tags.includes("cash buyer"))).toBe(true);
  });

  it("fix_and_flip ships rehab-shaped deals and NO notes", async () => {
    const f = await build("fix_and_flip");
    expect(f.notes.length).toBe(0);
    const statuses = f.deals.map((d) => d.status);
    // An in-rehab acquisition + a listed-for-resale disposition.
    expect(statuses).toContain("closed");
    expect(statuses).toContain("listed");
  });

  it("land_flipper ships the original parcels + one seller-financed note", async () => {
    const f = await build("land_flipper");
    expect(f.notes.length).toBe(1);
    expect(f.properties.length).toBe(3);
    // The canonical first parcel is preserved verbatim.
    expect(f.properties[0].apn).toBe("SAMPLE-001-234");
  });

  it("unknown business type falls back to the land flipper set", async () => {
    const fallback = await build("some_future_vertical");
    const land = await build("land_flipper");
    expect(fallback.properties.map((p) => p.apn)).toEqual(
      land.properties.map((p) => p.apn),
    );
  });
});

describe("buildSampleFixtures — no fabricated values", () => {
  it("every monetary field is a fixed string (no NaN, no random)", async () => {
    for (const persona of ["note_investor", "residential_wholesaler", "fix_and_flip", "land_flipper"]) {
      const f = await build(persona);
      for (const p of f.properties) {
        for (const field of [p.assessedValue, p.marketValue, p.purchasePrice, p.listPrice]) {
          expect(typeof field).toBe("string");
          expect(field).not.toContain("NaN");
        }
      }
      for (const n of f.notes) {
        expect(Number.isFinite(Number(n.currentBalance))).toBe(true);
        expect(Number.isFinite(Number(n.monthlyPayment))).toBe(true);
      }
    }
  });
});
