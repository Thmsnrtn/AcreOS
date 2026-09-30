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
import type { SQL } from "drizzle-orm";

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
  noteWhere: null as unknown,
}));

vi.mock("../../server/db", () => {
  const chain = (rows: () => unknown[], onWhere?: (w: unknown) => void) => {
    const c: Record<string, unknown> = {};
    for (const m of ["innerJoin", "limit", "orderBy"]) c[m] = () => c;
    c.where = (w: unknown) => {
      onWhere?.(w);
      return c;
    };
    c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
    return c;
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) =>
          chain(
            () => (t === deals ? (S.dealRow ? [S.dealRow] : []) : t === notes ? S.noteRows : []),
            t === notes ? (w) => (S.noteWhere = w) : undefined,
          ),
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
          onConflictDoUpdate: (conflict: unknown) => ({
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
  S.noteWhere = null;
});

/** Render a captured drizzle predicate to SQL text + params (what Postgres would run). */
async function renderWhere(w: unknown): Promise<{ sql: string; params: unknown[] }> {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  return new PgDialect().sqlToQuery(w as SQL);
}

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

  it("the financing check reads the note carried FROM THIS DEAL, not any note ever written on the parcel (audit of e3debe0)", async () => {
    const { closedSaleEvidence } = await import("../../server/services/marketNetworkContributor");
    await closedSaleEvidence(3, 5);
    expect(S.noteWhere).not.toBeNull();
    const q = await renderWhere(S.noteWhere);
    // A note originated by this deal (dealId 3) excludes the sale…
    expect(q.sql).toMatch(/"originating_deal_id" = \$(\d+)/);
    const idx = Number(q.sql.match(/"originating_deal_id" = \$(\d+)/)![1]) - 1;
    expect(q.params[idx]).toBe(3);
    // …and a property-level match only counts for a hand-entered note with no
    // originating deal (the investor's own seller-financed PURCHASE of the
    // parcel, carried from another deal, says nothing about this sale).
    expect(q.sql).toMatch(/"property_id" = \$\d+ and "notes"\."originating_deal_id" is null/);
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

  it("a re-close after a reopen restores the retracted row with its corrected figures (audit of e3debe0)", async () => {
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    await acreOSValuation.recordTransactionForTraining(
      "5",
      {
        propertyId: "11",
        salePrice: 64000,
        saleDate: new Date("2026-09-20T00:00:00Z"),
        acres: 20,
        pricePerAcre: 3200,
        location: { state: "TX", county: "Llano", zipCode: "", latitude: 0, longitude: 0 },
        characteristics: {},
        marketConditions: { quarterlyInterestRate: 0, localUnemploymentRate: 0, populationGrowth: 0, nearbyDevelopment: false },
      },
      "medium",
      { dedupeKey: "deal:abc" },
    );
    const conflict = S.inserted[0].conflict as { set?: Record<string, unknown>; setWhere?: unknown };
    expect(conflict.set).toMatchObject({ isOutlier: false, salePrice: "64000", pricePerAcre: "3200", dataQuality: "medium" });
    // Only the contributing org's own keyed row is ever rewritten.
    const q = await renderWhere(conflict.setWhere);
    expect(q.sql).toMatch(/"contributor_org_id" = \$1/);
    expect(q.params).toEqual([5]);
  });
});

describe("a close that is not a sale does not stay a sale", () => {
  it("Close & Carry retracts the cash-sale label the close recorded before the note existed", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-notes.ts"), "utf8"));
    const start = src.indexOf('"/api/notes/from-deal/:dealId"');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('"/api/notes/from-deal/:dealId"', start + 10));
    const created = body.indexOf("storage.createNote(");
    expect(created).toBeGreaterThan(0);
    expect(body.slice(created)).toMatch(/await retractCarriedDealSale\(orgId, dealId\)/);
    // …and on the already-carried path, so a failed first retraction is retried (audit of 224a5c0).
    const existing = body.indexOf("if (existing)");
    expect(existing).toBeGreaterThan(0);
    expect(body.slice(existing, existing + 400)).toMatch(/await retractCarriedDealSale\(orgId, dealId\)/);
    const helper = src.slice(src.indexOf("async function retractCarriedDealSale("));
    expect(helper.slice(0, 600)).toMatch(/retractTrainingTransaction\(orgId, `deal:\$\{closedSaleDealKey\(orgId, dealId\)\}`\)/);
  });

  it("only a disposition's accepted amount is paired as the AVM's actual sale price", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-deals.ts"), "utf8"));
    const at = src.indexOf('snapshotType: "avm_vs_actual"');
    expect(at).toBeGreaterThan(0);
    const guard = src.slice(Math.max(0, at - 400), at);
    expect(guard).toMatch(/if \([^)]*deal\.type === "disposition"[^)]*\)\s*\{\s*pairOutcomeAsync\(\{\s*$/);
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
    // Vacuity: the create site. A TRANSITION into offer_sent is recorded by
    // recordDealTransitionEvidence on every stage-change path
    // (dealTransitionEvidenceEverywhere.test.ts), not inline here.
    expect(sites.length).toBe(1);
    for (const at of sites) {
      // The nearest guard above each site names the offer_sent state.
      const before = src.slice(Math.max(0, at - 900), at);
      expect(before).toMatch(/status\s*===\s*"offer_sent"/);
    }
  });

  it("a contract is signed evidence only when it carries a signature — 'final' is not signed (audit of e3debe0)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-deals.ts"), "utf8"));
    const start = src.indexOf("async function contractSignedEvidence(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toMatch(/isNotNull\(generatedDocuments\.signedAt\)/); // vacuity: the predicate is here
    expect(body).not.toMatch(/"final"/);
    expect(body).toMatch(/desc nulls last/);
  });

  it("the deal page can send the operator's attestation — only when the operator checks it (DEFECT-0232)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/components/deal-detail-content.tsx"), "utf8"));
    // A move to in_escrow goes through the dialog, not straight to the write.
    expect(src).toMatch(/if \(newStatus === "in_escrow"\) \{[\s\S]{0,120}setEscrowPending\(true\);[\s\S]{0,20}return;/);
    // The attestation is sent only when checked.
    expect(src).toMatch(/\.\.\.\(escrowAttested \? \{ contractSignedAttested: true \} : \{\}\)/);
    // Unchecked by default, and reset each time the dialog opens.
    expect(src).toMatch(/const \[escrowAttested, setEscrowAttested\] = useState\(false\)/);
    expect(src).toMatch(/setEscrowAttested\(false\);\s*setEscrowPending\(true\);/);
  });

  it("the escrow dialog is mounted outside the tabs — an inactive tab's content is unmounted (audit of the H6 change)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/components/deal-detail-content.tsx"), "utf8"));
    // The status select (Details tab) opens the dialog; placed inside another
    // tab's content it never rendered where the move was made, and the move
    // silently did nothing.
    const at = src.indexOf("<Dialog open={escrowPending}");
    expect(at, "the escrow dialog is gone").toBeGreaterThan(-1);
    const before = src.slice(0, at);
    const unclosed = (open: RegExp, close: RegExp) => (before.match(open) ?? []).length - (before.match(close) ?? []).length;
    // Vacuity: the file still has tabs, and the select that opens the dialog.
    expect((src.match(/<TabsContent\b/g) ?? []).length).toBeGreaterThan(2);
    expect(src).toMatch(/onValueChange=\{handleStatusChange\}/);
    expect(unclosed(/<TabsContent\b/g, /<\/TabsContent>/g), "the dialog sits inside a TabsContent").toBe(0);
    expect(unclosed(/<Tabs\b/g, /<\/Tabs>/g), "the dialog sits inside the Tabs").toBe(0);
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
