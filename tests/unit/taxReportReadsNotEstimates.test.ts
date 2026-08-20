/**
 * A tax worksheet may not manufacture the figures a Schedule D line needs.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `generateTaxReport` produced a per-transaction capital-gains worksheet in
 * which four of the five numbers that decide the outcome were invented, and
 * every real column it needed already existed one field away:
 *
 *     salePrice         = properties.list_price          // ASKING price, on a
 *                                                        // CLOSED deal, while
 *                                                        // sold_price existed
 *     adjustedBasis     = purchasePrice * 1.03           // "Rough: ~3% closing"
 *     grossSaleProceeds = salePrice * 0.96               // "Rough: ~4% selling"
 *     improvementsAdded = 0                              // asserted, untracked
 *     acquired          = purchaseDate || offerDate
 *                        || createdAt || yearStart       // ROW CREATION DATE
 *                                                        // deciding the RATE
 *
 * and `parseFloat(x || "0")` turned a property with no recorded purchase price
 * into a cost basis of zero — making the entire sale price a taxable gain,
 * silently. The rounded percentages are the tell: 1.03 and 0.96 are not
 * measurements of anything, and the report presented their output as
 * `closingCostsTotal` and `grossSaleProceeds`, line items a filer would carry
 * onto a return.
 *
 * ── WHY BEHAVIOURAL AND NOT A SOURCE SCAN ───────────────────────────────────
 * A scan asserting the string `listPrice` is absent from this function proves
 * that spelling is gone. It cannot tell the difference between reading
 * `sold_price` and reading any other plausible column, and it goes green the
 * moment someone reintroduces the estimate through a constant, a helper, or a
 * differently-named field. These cases run the function over a fake db and
 * assert the OUTCOME: a deal missing a required figure must land in
 * `unreportableTransactions` and contribute nothing to any total. That property
 * survives renaming, refactoring and reimplementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Deals returned by the `db.select().from(deals).where(...)` chain. */
let dealRows: any[] = [];
/** Properties handed to `db.query.properties.findFirst`, in deal order. */
let propertyQueue: any[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(dealRows) }) }),
    query: {
      properties: {
        findFirst: () => Promise.resolve(propertyQueue.shift() ?? undefined),
      },
    },
  },
}));

import { generateTaxReport } from "../../server/services/financialOSService";

const YEAR = 2025;
const JAN = new Date(YEAR, 0, 15);
const DEC = new Date(YEAR, 11, 15);

function deal(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 7,
    propertyId: 100,
    status: "closed",
    closingDate: DEC,
    closingCosts: "3000",
    offerDate: JAN,
    createdAt: JAN,
    ...over,
  };
}

function property(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    address: "123 Parcel Rd",
    apn: "APN-1",
    county: "Travis",
    state: "TX",
    purchasePrice: "40000",
    purchaseDate: new Date(2023, 0, 10),
    listPrice: "99000", // the asking price — must never reach a total
    soldPrice: "60000",
    soldDate: DEC,
    ...over,
  };
}

beforeEach(() => {
  dealRows = [];
  propertyQueue = [];
});

describe("generateTaxReport reports recorded figures only", () => {
  it("vacuity: a fully-recorded deal IS reported, so absence below means something", () => {
    // Without this, every assertion in this file is satisfied by a function
    // that reports nothing at all.
    dealRows = [deal()];
    propertyQueue = [property()];
    return generateTaxReport(7, YEAR).then((r) => {
      expect(r.transactions).toHaveLength(1);
      expect(r.unreportableTransactions).toHaveLength(0);
    });
  });

  it("uses sold_price, never list_price, for the amount realized", async () => {
    dealRows = [deal()];
    propertyQueue = [property()];
    const r = await generateTaxReport(7, YEAR);

    const [t] = r.transactions;
    expect(t.salePrice).toBe(60000); // sold_price
    expect(t.salePrice).not.toBe(99000); // list_price
    // basis = 40000 purchase + 3000 recorded closing costs; gain = 60000 - 43000
    expect(t.adjustedBasis).toBe(43000);
    expect(t.grossSaleProceeds).toBe(60000);
    expect(t.gainOrLoss).toBe(17000);
    expect(r.totalTaxableGain).toBe(17000);
  });

  it("applies no percentage estimate to basis or proceeds", async () => {
    dealRows = [deal()];
    propertyQueue = [property()];
    const [t] = (await generateTaxReport(7, YEAR)).transactions;

    // The two estimates that shipped. Both are absent by VALUE, so restoring
    // them under any name or via any helper still fails here.
    expect(t.adjustedBasis).not.toBeCloseTo(40000 * 1.03, 2);
    expect(t.grossSaleProceeds).not.toBeCloseTo(60000 * 0.96, 2);
    expect(t.closingCostsTotal).toBe(3000); // recorded, not 40000 * 0.03
    expect(t.closingCostsTotal).not.toBeCloseTo(40000 * 0.03, 2);
  });

  it("reports unrecorded closing costs as null and flags the basis, not 0", async () => {
    dealRows = [deal({ closingCosts: null })];
    propertyQueue = [property()];
    const [t] = (await generateTaxReport(7, YEAR)).transactions;

    expect(t.closingCostsTotal).toBeNull();
    expect(t.basisExcludesUnrecordedCosts).toBe(true);
    expect(t.adjustedBasis).toBe(40000);
  });

  it("reports untracked improvements as null, not as an asserted zero", async () => {
    dealRows = [deal()];
    propertyQueue = [property()];
    const [t] = (await generateTaxReport(7, YEAR)).transactions;
    expect(t.improvementsAdded).toBeNull();
  });

  it("EXCLUDES a deal with no recorded sale price instead of using list price", async () => {
    dealRows = [deal()];
    propertyQueue = [property({ soldPrice: null })];
    const r = await generateTaxReport(7, YEAR);

    expect(r.transactions).toHaveLength(0);
    expect(r.unreportableTransactions).toHaveLength(1);
    expect(r.unreportableTransactions[0].missing.join(" ")).toMatch(/soldPrice/);
    // The list price was 99000 and is present on the row. Nothing may reach a
    // total from it.
    expect(r.totalTaxableGain).toBe(0);
    expect(r.shortTermGains).toBe(0);
    expect(r.longTermGains).toBe(0);
  });

  it("EXCLUDES a deal with no cost basis instead of treating basis as zero", async () => {
    // The most expensive wrong answer the old code produced: basis 0 makes the
    // whole sale price a taxable gain.
    dealRows = [deal()];
    propertyQueue = [property({ purchasePrice: null })];
    const r = await generateTaxReport(7, YEAR);

    expect(r.transactions).toHaveLength(0);
    expect(r.totalTaxableGain).not.toBe(60000);
    expect(r.totalTaxableGain).toBe(0);
    expect(r.unreportableTransactions[0].missing.join(" ")).toMatch(/purchasePrice/);
  });

  it("EXCLUDES a deal with no acquisition date rather than dating it from the row", async () => {
    // holding period decides short vs long term, which decides the RATE. The
    // old fallback chain ended at the record's createdAt and then at Jan 1.
    dealRows = [deal()];
    propertyQueue = [property({ purchaseDate: null })];
    const r = await generateTaxReport(7, YEAR);

    expect(r.transactions).toHaveLength(0);
    expect(r.unreportableTransactions[0].missing.join(" ")).toMatch(/purchaseDate/);
  });

  it("keeps complete deals when an incomplete one is present", async () => {
    // Exclusion must be per-transaction, not all-or-nothing: a single unrecorded
    // figure should not suppress a year's reporting, nor silently pollute it.
    dealRows = [deal({ id: 1 }), deal({ id: 2 })];
    propertyQueue = [property({ soldPrice: null }), property()];
    const r = await generateTaxReport(7, YEAR);

    expect(r.transactions.map((t) => t.dealId)).toEqual([2]);
    expect(r.unreportableTransactions.map((t) => t.dealId)).toEqual([1]);
    expect(r.totalTaxableGain).toBe(17000);
  });

  it("says in the narrative that transactions were excluded", async () => {
    // A total printed without its coverage is a different claim from the one
    // the numbers support.
    dealRows = [deal({ id: 1 }), deal({ id: 2 })];
    propertyQueue = [property({ soldPrice: null }), property()];
    const r = await generateTaxReport(7, YEAR);

    expect(r.summaryNarrative).toMatch(/EXCLUDED: 1 of 2/);
    expect(r.summaryNarrative).toMatch(/1 of 2/);
  });

  it("does not classify dealer income", async () => {
    // Dealer-vs-investor is a facts-and-circumstances determination made by the
    // filer's CPA. A hardcoded 0 reads as "we checked and there is none".
    dealRows = [deal()];
    propertyQueue = [property()];
    const r = await generateTaxReport(7, YEAR);
    expect(r.dealerIncome).toBeNull();
    expect(r.summaryNarrative).toMatch(/CPA/);
  });
});
