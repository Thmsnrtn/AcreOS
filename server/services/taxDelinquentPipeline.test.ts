/**
 * Tax-delinquent pipeline — refuse-not-fabricate tests.
 *
 * The pre-fix mapper invented propertyValueCents = taxOwedCents × 8 when no
 * assessed value was on file and served the derived equity% as if real.
 * These tests pin the honest behavior: unknown values are null with
 * valueProvenance "none", assessed values pass through with provenance
 * "assessed", and unknowns never escalate derived risk.
 *
 * No DATABASE_URL needed: the db module is mocked and the mapper under test
 * is pure.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));

import {
  mapLeadToDelinquentRow,
  deriveRisk,
  type LeadRowInput,
} from "./taxDelinquentPipeline";

import fs from "fs";
import path from "path";

function leadRow(overrides: Partial<LeadRowInput> = {}, payload?: object): LeadRowInput {
  return {
    id: 1,
    firstName: "Jo",
    lastName: "Farmer",
    email: null,
    address: "1 County Rd",
    city: "Llano",
    state: "TX",
    score: 70,
    notes: payload !== undefined ? JSON.stringify(payload) : null,
    ...overrides,
  };
}

describe("mapLeadToDelinquentRow — value provenance", () => {
  it("no property value on file → provenance 'none', null value/equity, NO fabricated ×8 cents", () => {
    const row = mapLeadToDelinquentRow(
      leadRow({}, {
        apn: "001-0001-001",
        county: "Llano",
        delinquentAmount: "5000", // $5,000 owed
        delinquentYears: 2,
      }),
    );
    expect(row.valueProvenance).toBe("none");
    expect(row.propertyValueCents).toBeNull();
    expect(row.equityPercent).toBeNull();
    // The old fabrication would have produced 5000 * 100 * 8 = 4,000,000 cents.
    expect(row.propertyValueCents).not.toBe(4_000_000);
    // Tax owed is real and passes through.
    expect(row.taxOwedCents).toBe(500_000);
  });

  it("assessed value on file → provenance 'assessed', value passes through, equity derived from real inputs", () => {
    const row = mapLeadToDelinquentRow(
      leadRow({}, {
        delinquentAmount: "5000",
        propertyValueCents: 10_000_000, // $100,000 assessed
        delinquentYears: 2,
      }),
    );
    expect(row.valueProvenance).toBe("assessed");
    expect(row.propertyValueCents).toBe(10_000_000);
    // (10,000,000 - 500,000) / 10,000,000 = 95%
    expect(row.equityPercent).toBe(95);
  });

  it("assessed value but no delinquent amount → equity stays null (never computed from a fake $0)", () => {
    const row = mapLeadToDelinquentRow(
      leadRow({}, { propertyValueCents: 10_000_000 }),
    );
    expect(row.valueProvenance).toBe("assessed");
    expect(row.propertyValueCents).toBe(10_000_000);
    expect(row.taxOwedCents).toBeNull();
    expect(row.equityPercent).toBeNull();
  });

  it("no delinquent amount → taxOwedCents null, not 0; no years → yearsDelinquent null, not 0", () => {
    const row = mapLeadToDelinquentRow(leadRow({}, { apn: "x" }));
    expect(row.taxOwedCents).toBeNull();
    expect(row.yearsDelinquent).toBeNull();
  });

  it("unparseable delinquent amount → taxOwedCents null", () => {
    const row = mapLeadToDelinquentRow(leadRow({}, { delinquentAmount: "N/A" }));
    expect(row.taxOwedCents).toBeNull();
  });

  it("non-positive / non-numeric propertyValueCents in payload → treated as no value on file", () => {
    for (const bad of [0, -5, NaN, "100000" as unknown as number]) {
      const row = mapLeadToDelinquentRow(leadRow({}, { propertyValueCents: bad }));
      expect(row.valueProvenance).toBe("none");
      expect(row.propertyValueCents).toBeNull();
      expect(row.equityPercent).toBeNull();
    }
  });

  it("malformed notes JSON → all unknown fields null, provenance 'none'", () => {
    const row = mapLeadToDelinquentRow(leadRow({ notes: "not json {{" }));
    expect(row.valueProvenance).toBe("none");
    expect(row.propertyValueCents).toBeNull();
    expect(row.equityPercent).toBeNull();
    expect(row.taxOwedCents).toBeNull();
    expect(row.yearsDelinquent).toBeNull();
  });

  it("equity clamps to 0 when real tax owed exceeds real assessed value", () => {
    const row = mapLeadToDelinquentRow(
      leadRow({}, { delinquentAmount: "2000", propertyValueCents: 100_000 }), // $2k owed, $1k value
    );
    expect(row.valueProvenance).toBe("assessed");
    expect(row.equityPercent).toBe(0);
  });
});

describe("deriveRisk — unknowns never escalate", () => {
  it("all-unknown inputs → low (no invented escalation)", () => {
    expect(deriveRisk({ yearsDelinquent: null, equityPercent: null })).toBe("low");
  });

  it("2yr delinquent with UNKNOWN equity does not get the equity-based high bump", () => {
    expect(deriveRisk({ yearsDelinquent: 2, equityPercent: null })).toBe("medium");
    expect(deriveRisk({ yearsDelinquent: 2, equityPercent: 40 })).toBe("high");
  });

  it("real signals still escalate: imminent tax sale dominates, 3+ years is critical", () => {
    expect(deriveRisk({ yearsDelinquent: null, equityPercent: null, daysUntilTaxSale: 11 })).toBe("critical");
    expect(deriveRisk({ yearsDelinquent: 3, equityPercent: null })).toBe("critical");
    expect(deriveRisk({ yearsDelinquent: null, equityPercent: null, daysUntilTaxSale: 60 })).toBe("high");
  });
});

describe("source pins — fabrication stays dead", () => {
  const pipelineSrc = fs.readFileSync(
    path.resolve(__dirname, "./taxDelinquentPipeline.ts"),
    "utf-8",
  );
  const pageSrc = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/pages/tax-delinquent.tsx"),
    "utf-8",
  );

  it("pipeline no longer contains the taxOwed × 8 fabrication expression", () => {
    expect(pipelineSrc).not.toMatch(/taxOwedCents\s*\*\s*8/);
  });

  it("UI renders the honest no-value state when provenance is not 'assessed'", () => {
    // Per-lead marker + Avg-equity tile fallback.
    expect(pageSrc).toContain("no assessed value on file");
    expect(pageSrc).toContain("no assessed values on file");
    // Nullable equity is handled explicitly, not rendered as a bare number.
    expect(pageSrc).toMatch(/equityPercent !== null/);
    // Payload carries provenance so the UI can distinguish real from absent.
    expect(pageSrc).toContain('valueProvenance: "assessed" | "none"');
  });

  it("UI never averages null equity into the Avg-equity stat", () => {
    expect(pageSrc).toContain("leadsWithEquity");
  });
});
