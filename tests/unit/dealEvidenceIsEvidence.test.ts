/**
 * Quality directive 2026-09-29 (deal evidence) — a stage change is not
 * evidence, a close is not automatically a comparable sale, and a comp whose
 * distance nobody measured is not "0 miles away".
 *
 *  - Every close fed the valuation training corpus as "high" quality and the
 *    cross-customer market network: acquisitions (what the investor paid),
 *    seller-financed contract totals and sample fixtures included, with no
 *    dedupe and no way to retract.
 *  - Valuation comps read the whole STATE, every comp had distance 0 (under
 *    a 50-mile filter), two empty ZIPs "matched" for +30 similarity, and
 *    "nearest < 5 mi" added +15 confidence to every valuation.
 *  - The AVM compared the broker's "Zone AE" label with bare "AE": no flood
 *    adjustment ever applied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deals, notes, transactionTraining } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/sophiePrivacyGuard", () => ({
  consentingOrgIds: async () => new Set<number>(),
  sophiePrivacyGuard: { hasConsent: async () => true },
}));
vi.mock("../../server/services/gradientBoosting", () => ({
  GradientBoostingRegressor: { fromJSON: () => null },
  extractLandFeatures: (x: unknown) => x,
}));

const S = vi.hoisted(() => ({
  dealRow: null as null | Record<string, unknown>,
  noteRows: [] as unknown[],
  compCalls: [] as unknown[],
  compRows: [] as unknown[],
  inserted: [] as Array<{ values: Record<string, unknown>; conflict: unknown }>,
}));

vi.mock("../../server/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["innerJoin", "where", "limit", "orderBy"]) c[m] = () => c;
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
    return c;
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) =>
          chain(() => (t === deals ? (S.dealRow ? [S.dealRow] : []) : t === notes ? S.noteRows : [])),
      }),
      query: {
        transactionTraining: {
          findMany: async (opts: unknown) => {
            S.compCalls.push(opts);
            return S.compRows.shift() ?? [];
          },
        },
      },
      insert: (t: unknown) => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoNothing: (conflict: unknown) => ({
            returning: async () => {
              if (t === transactionTraining) S.inserted.push({ values: v, conflict });
              return [{ id: 9 }];
            },
          }),
        }),
      }),
    },
  };
});

beforeEach(() => {
  S.dealRow = {
    type: "disposition",
    status: "closed",
    dealValue: "60000",
    closingDate: new Date("2026-09-01T00:00:00Z"),
    propertyId: 11,
    apn: "123-456",
    county: "Llano",
    state: "TX",
    sizeAcres: "20",
    zoning: null,
  };
  S.noteRows = [];
  S.compCalls = [];
  S.compRows = [];
  S.inserted = [];
});

describe("only a real cash sale is market evidence", () => {
  it("a clean closed disposition qualifies, with a stable anonymous key", async () => {
    const { closedSaleEvidence, closedSaleDealKey } = await import("../../server/services/marketNetworkContributor");
    const r = await closedSaleEvidence(3, 5);
    expect(r).toMatchObject({ ok: true, price: 60000, acres: 20, dealKey: closedSaleDealKey(5, 3) });
    expect(closedSaleDealKey(5, 3)).not.toContain("5");
  });

  it("an acquisition is what the investor paid — not a sale comp", async () => {
    S.dealRow = { ...S.dealRow!, type: "acquisition" };
    const { closedSaleEvidence } = await import("../../server/services/marketNetworkContributor");
    expect(await closedSaleEvidence(3, 5)).toMatchObject({ ok: false });
  });

  it("a seller-financed sale's contract total is not a cash price", async () => {
    S.noteRows = [{ id: 1 }];
    const { closedSaleEvidence } = await import("../../server/services/marketNetworkContributor");
    expect(await closedSaleEvidence(3, 5)).toMatchObject({ ok: false, reason: expect.stringMatching(/Seller-financed/) });
  });

  it("a sample fixture is not a sale", async () => {
    S.dealRow = { ...S.dealRow!, apn: "SAMPLE-0001" };
    const { closedSaleEvidence } = await import("../../server/services/marketNetworkContributor");
    expect(await closedSaleEvidence(3, 5)).toMatchObject({ ok: false });
  });
});

describe("a closed sale is recorded once, and can be retracted", () => {
  it("the dedupe key is the training row's identity, and a repeat is a no-op insert", async () => {
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    await acreOSValuation.recordTransactionForTraining(
      "5",
      {
        propertyId: "11",
        salePrice: 60000,
        saleDate: new Date(),
        acres: 20,
        pricePerAcre: 3000,
        location: { state: "TX", county: "Llano", zipCode: "", latitude: 0, longitude: 0 },
        characteristics: {},
        marketConditions: { quarterlyInterestRate: 0, localUnemploymentRate: 0, populationGrowth: 0, nearbyDevelopment: false },
      },
      "medium",
      { dedupeKey: "deal:abc" },
    );
    expect(S.inserted[0].values).toMatchObject({ transactionHash: "deal:abc", dataQuality: "medium", contributorOrgId: 5 });
    expect(S.inserted[0].conflict).toMatchObject({ target: transactionTraining.transactionHash });
  });
});

describe("valuation comps say what they know", () => {
  it("same-county sales first; the state is read only when the county has fewer than three", async () => {
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    const svc = acreOSValuation as unknown as {
      findComparables: (o: string, l: Record<string, unknown>, a: number) => Promise<Array<{ distance: number | null; similarity: number }>>;
    };
    const comp = (county: string) => ({ transactionHash: county, salePrice: "30000", pricePerAcre: "3000", sizeAcres: "10", state: "TX", county });
    S.compRows = [[comp("Llano"), comp("Llano"), comp("Llano")]];
    const out = await svc.findComparables("5", { state: "TX", county: "Llano", zipCode: "" }, 10);
    expect(S.compCalls).toHaveLength(1); // enough in-county — no state-wide read
    expect(out.every((c) => c.distance === null)).toBe(true); // not measured ≠ 0 miles
    // Two EMPTY zips are not a zip match: 40 (acreage) + 30 (county) only.
    expect(out[0].similarity).toBe(70);

    S.compCalls = [];
    S.compRows = [[comp("Llano")], [comp("Llano"), comp("Burnet"), comp("Mason")]];
    await svc.findComparables("5", { state: "TX", county: "Llano", zipCode: "" }, 10);
    expect(S.compCalls).toHaveLength(2); // fell back to the state
  });

  it("an unmeasured distance earns no proximity confidence", async () => {
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    const svc = acreOSValuation as unknown as { calculateConfidence: (n: number, d: number | null, v: number) => number };
    expect(svc.calculateConfidence(5, null, 0.5)).toBe(svc.calculateConfidence(5, 1000, 0.5));
    expect(svc.calculateConfidence(5, 1, 0.5)).toBeGreaterThan(svc.calculateConfidence(5, null, 0.5));
  });

  it("the AVM's flood adjustment reads the broker's 'Zone AE' label", async () => {
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    const svc = acreOSValuation as unknown as {
      calculateMarketAdjustments: (req: Record<string, unknown>) => Promise<Array<{ factor: string; adjustment: number }>> | Array<{ factor: string; adjustment: number }>;
    };
    if (typeof svc.calculateMarketAdjustments !== "function") throw new Error("adjustment method not found — update the test to its name");
    const ae = await svc.calculateMarketAdjustments({ acres: 10, location: { state: "TX", county: "Llano" }, characteristics: { floodZone: "Zone AE" } });
    expect(ae).toContainEqual(expect.objectContaining({ factor: "Flood Zone", adjustment: -15 }));
    const x = await svc.calculateMarketAdjustments({ acres: 10, location: { state: "TX", county: "Llano" }, characteristics: { floodZone: "Zone X" } });
    expect(x).toContainEqual(expect.objectContaining({ adjustment: 5 }));
  });
});

describe("the deal routes emit on evidence, not on a stage", () => {
  it("first_offer_made is recorded only for a deal at offer_sent — never for any created deal", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-deals.ts"), "utf8"));
    const sites = [...src.matchAll(/eventName:\s*"first_offer_made"/g)].map((m) => m.index ?? 0);
    expect(sites.length).toBe(2); // vacuity: both sites still exist
    for (const at of sites) {
      // The nearest guard above each site names the offer_sent state.
      const before = src.slice(Math.max(0, at - 900), at);
      expect(before).toMatch(/status\s*===\s*"offer_sent"/);
    }
  });

  it("entering escrow asks for evidence before emitting contract_signed", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-deals.ts"), "utf8"));
    const call = src.indexOf("emitContractSigned(existingDeal.status");
    expect(call).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, call - 600), call)).toMatch(/await contractSignedEvidence\(/);
    expect(src.slice(call, call + 300)).toMatch(/evidence,/);
  });
});
