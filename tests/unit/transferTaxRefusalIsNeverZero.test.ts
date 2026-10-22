/**
 * A refused transfer tax is never "$0", the property class reaches the
 * estimate from the recorded property, and an omitted date is today.
 *
 * ── THE DEFECTS (independent audit of branch claude/p0-transfer-tax-truth) ──
 *  1. closingCostEstimator set transferTax = 0 on a refusal, the breakdown
 *     line's amount 0, and summed the 0 into the total — so New Jersey read
 *     "Transfer tax $0". countyRecordingFees.estimateClosingCosts summed
 *     `tax ?? 0`, and a "varies" payer was counted on neither side.
 *  2. No production caller passed propertyClass, so every graduated state
 *     (WA, CT, DC, HI, RI, ME, VT) and Miami-Dade was ALWAYS refused — even
 *     for a parcel recorded as vacant land.
 *  4. estimateTransferTax skipped its effective-date checks when no date was
 *     passed, which is how most callers called it: a lapsed rate kept
 *     estimating.
 *
 * Everything here drives production code — the estimators, the real
 * /api/recording-fees router and the real contract-preview route.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  property: null as null | Record<string, unknown>,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, name: "Cedar Ridge", legalEntityName: "Cedar Ridge Land Holdings LLC", settings: {} };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    getDeal: async (orgId: number, id: number) =>
      orgId === 7 && id === 1
        ? { id: 1, propertyId: 1, status: "accepted", type: "acquisition", acceptedAmount: "600000", closingDate: "2026-11-15" }
        : undefined,
    getProperty: async () => h.property,
    getOrganization: async () => ({ id: 7, name: "Cedar Ridge", legalEntityName: "Cedar Ridge Land Holdings LLC", settings: {} }),
    getLead: async () => ({ firstName: "Ana", lastName: "Ruiz", email: null, address: null }),
  },
}));

import { estimateClosingCosts as estimateAllIn } from "../../server/services/closingCostEstimator";
import { estimateClosingCosts } from "../../server/services/countyRecordingFees";
import recordingFeesRouter from "../../server/routes-recording-fees";
import { registerContractChainRoutes } from "../../server/routes-contract-chain";
import { estimateTransferTax, propertyClassFromStructureType } from "../../shared/regulatory/transferTax";

afterEach(() => {
  vi.useRealTimers();
});

describe("finding 1 — a refusal is null, excluded from the total, and the total says so", () => {
  it("closingCostEstimator: NJ transfer tax is null, its line is null, the total omits it and names it", () => {
    const e = estimateAllIn("NJ", "Morris", 100_000, undefined, new Date("2026-11-15T12:00:00Z"));
    expect(e.transferTax).toBeNull();
    const line = e.breakdown.find((b) => b.item === "Transfer tax")!;
    expect(line.amount).toBeNull();
    expect(line.source).toMatch(/^Not estimated: New Jersey/);
    expect(e.totalEstimated).toBe(e.recordingFee + e.titleInsuranceEstimate + e.proratedTaxes);
    expect(e.totalExcludes.some((x) => /^Transfer tax — not estimated: New Jersey/.test(x))).toBe(true);
  });

  it("closingCostEstimator: a computed tax IS in the total and the total is not marked as excluding it", () => {
    const e = estimateAllIn("FL", "Leon", 100_000, undefined, new Date("2026-11-15T12:00:00Z"));
    expect(e.transferTax).toBe(700);
    expect(e.totalEstimated).toBe(e.recordingFee + 700 + e.titleInsuranceEstimate);
    expect(e.totalExcludes.filter((x) => x.startsWith("Transfer tax"))).toEqual([]);
  });

  it("closingCostEstimator: the attorney line carries no $0 figure and is named as excluded", () => {
    const e = estimateAllIn("GA", "Fulton", 100_000, undefined, new Date("2026-11-15T12:00:00Z"));
    const attorney = e.breakdown.find((b) => b.item === "Attorney closing requirement")!;
    expect(attorney.amount).toBeNull();
    expect(e.totalExcludes.some((x) => x.startsWith("Attorney closing fee"))).toBe(true);
  });

  it("countyRecordingFees: NJ total is the recording fee alone, shares are null, and it says what it excludes", () => {
    const c = estimateClosingCosts(100_000, "NJ", "Morris");
    expect(c.transferTaxTotal).toBeNull();
    expect(c.totalCost).toBe(c.recordingFee);
    expect(c.buyerResponsibility).toBeNull();
    expect(c.sellerResponsibility).toBeNull();
    expect(c.transferTaxRefusal).toMatch(/New Jersey/);
    expect(c.totalExcludes[0]).toMatch(/^Transfer tax — not estimated/);
  });

  it('countyRecordingFees: a "varies" payer (AL) is in the total and in unallocatedTransferTax, not dropped', () => {
    // AL $0.50 per $500: 200 × $0.50 = $100.
    const c = estimateClosingCosts(100_000, "AL", "Baldwin");
    expect(c.transferTaxTotal).toBe(100);
    expect(c.unallocatedTransferTax).toBe(100);
    expect(c.totalCost).toBe(c.recordingFee + 100);
    expect(c.sellerResponsibility).toBe(0);
    expect(c.buyerResponsibility).toBe(c.recordingFee);
  });

  it("GET /api/recording-fees/closing serves null for a refusal (the real router)", async () => {
    const app = express();
    app.use("/api/recording-fees", recordingFeesRouter);
    const res = await request(app).get("/api/recording-fees/closing?state=NJ&county=Morris&price=100000");
    expect(res.status).toBe(200);
    expect(res.body.transferTaxTotal).toBeNull();
    expect(res.body.totalCost).toBe(res.body.recordingFee);
  });
});

describe("finding 2 — the property class reaches the estimate", () => {
  it("maps only explicit structure types; unknown stays undefined", () => {
    expect(propertyClassFromStructureType("vacant_land")).toBe("vacant_land");
    expect(propertyClassFromStructureType("Vacant Land")).toBe("vacant_land");
    expect(propertyClassFromStructureType("sfr")).toBe("single_family_residence");
    expect(propertyClassFromStructureType("duplex")).toBe("other_residential");
    expect(propertyClassFromStructureType("commercial")).toBe("nonresidential");
    for (const t of [null, undefined, "", "condo", "townhouse", "mixed_use", "barn"]) {
      expect(propertyClassFromStructureType(t)).toBeUndefined();
    }
  });

  it("GET /api/recording-fees/closing with propertyClass=vacant_land estimates WA (marginal $6,735 on $600,000)", async () => {
    const app = express();
    app.use("/api/recording-fees", recordingFeesRouter);
    const ok = await request(app).get("/api/recording-fees/closing?state=WA&county=King&price=600000&propertyClass=vacant_land");
    expect(ok.body.transferTaxTotal).toBe(6735);
    const none = await request(app).get("/api/recording-fees/closing?state=WA&county=King&price=600000");
    expect(none.body.transferTaxTotal).toBeNull();
    const bad = await request(app).get("/api/recording-fees/closing?state=WA&county=King&price=600000&propertyClass=mansion");
    expect(bad.status).toBe(400);
  });

  function contractApp() {
    const app = express();
    app.use(express.json());
    registerContractChainRoutes(app);
    return app;
  }
  const baseProperty = {
    id: 1, apn: "12-34-56", address: "Tract 4, County Road 219", city: null, state: "WA", county: "King",
    zip: null, sizeAcres: "5", legalDescription: null, sellerId: 3,
  };

  it("contract preview: a property recorded as vacant land prints the WA figure ($6,735)", async () => {
    h.property = { ...baseProperty, structureType: "vacant_land" };
    const res = await request(contractApp()).get("/api/deals/1/contract-preview?kind=purchase_agreement");
    expect(res.status).toBe(200);
    const line = String(res.body.content).match(/<li><strong>Transfer tax:<\/strong>[^<]*<\/li>/)?.[0] ?? "";
    expect(line).toContain("Estimated $6,735");
  });

  it("contract preview: an unrecorded structure type keeps the refusal (no guessed bracket)", async () => {
    h.property = { ...baseProperty, structureType: null };
    const res = await request(contractApp()).get("/api/deals/1/contract-preview?kind=purchase_agreement");
    expect(res.status).toBe(200);
    const line = String(res.body.content).match(/<li><strong>Transfer tax:<\/strong>[^<]*<\/li>/)?.[0] ?? "";
    expect(line).toMatch(/No estimate is stated/);
    expect(line).not.toMatch(/Estimated \$/);
  });
});

describe("finding 4 — an omitted date is today, so a lapsed row refuses", () => {
  it("WA (brackets through 2026-12-31) refuses on 2027-02-01 when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    expect(estimateTransferTax("WA", 600_000, { propertyClass: "vacant_land" }).kind).toBe("refused");
  });

  it("…and estimates on 2026-10-20 when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    expect(estimateTransferTax("WA", 600_000, { propertyClass: "vacant_land" }).kind).toBe("estimate");
  });

  it("NE (rate from 2026-07-18) refuses on 2026-03-01 when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    expect(estimateTransferTax("NE", 100_000).kind).toBe("refused");
  });

  it("the server estimators read the server clock when no closing date is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    expect(estimateAllIn("WA", "King", 600_000, undefined, undefined, "vacant_land").transferTax).toBeNull();
    expect(estimateClosingCosts(600_000, "WA", "King", { propertyClass: "vacant_land" }).transferTaxTotal).toBeNull();
  });
});
