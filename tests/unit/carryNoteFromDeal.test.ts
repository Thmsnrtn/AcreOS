/**
 * Close & Carry — deal → note field-mapping tests (Maren CPO #1).
 *
 * The lifecycle bridge's contract is the pure mapper `mapDealToNoteFields`:
 * given a closed seller-finance deal (+ operator confirm-screen edits), it
 * produces the seller-finance `notes` insert payload with NO re-keying. These
 * tests lock in the field mapping a first customer notices in week one and the
 * deal.id ↔ note.originatingDealId link integrity.
 */
import { describe, it, expect } from "vitest";
import {
  mapDealToNoteFields,
  missingCarryTerms,
  type CarryableDeal,
  type CarryOverrides,
} from "../../server/routes-notes";

function baseDeal(overrides: Partial<CarryableDeal> = {}): CarryableDeal {
  return {
    id: 42,
    organizationId: 7,
    propertyId: 99,
    status: "closed",
    type: "disposition",
    offerAmount: "20000",
    acceptedAmount: "25000",
    closingDate: "2026-01-15T00:00:00.000Z",
    analysisResults: {
      downPayment: 5000,
      interestRate: 9,
      holdingPeriodMonths: 60,
    },
    ...overrides,
  };
}

describe("mapDealToNoteFields — deal → note correctness", () => {
  it("maps a closed seller-finance deal to a serviced note with no re-keying", () => {
    const note = mapDealToNoteFields(baseDeal(), {});

    // Sale price prefers acceptedAmount; financed = sale - down.
    expect(note.originalPrincipal).toBe("20000"); // 25000 - 5000
    expect(note.currentBalance).toBe("20000"); // starts equal to principal
    expect(note.downPayment).toBe("5000");
    expect(note.interestRate).toBe("9");
    expect(note.termMonths).toBe(60);
    // Link integrity — the note carries its originating deal.
    expect(note.originatingDealId).toBe(42);
    expect(note.organizationId).toBe(7);
    expect(note.propertyId).toBe(99);
    // Origination always lands pending — runs through the Reg-Z chokepoint.
    expect(note.status).toBe("pending");
  });

  it("computes a positive monthly payment from (principal, rate, term)", () => {
    const note = mapDealToNoteFields(baseDeal(), {});
    expect(Number(note.monthlyPayment)).toBeGreaterThan(0);
    // 20000 over 60mo @ 9% ≈ $415/mo — sanity band, not exact.
    expect(Number(note.monthlyPayment)).toBeGreaterThan(300);
    expect(Number(note.monthlyPayment)).toBeLessThan(600);
  });

  it("derives first payment one month after closing when not overridden", () => {
    const note = mapDealToNoteFields(baseDeal(), {});
    expect(note.startDate.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(note.firstPaymentDate.toISOString().slice(0, 10)).toBe("2026-02-15");
  });

  it("clamps first-payment day for short months (Jan 31 → Feb 28)", () => {
    const note = mapDealToNoteFields(
      baseDeal({ closingDate: "2026-01-31T00:00:00.000Z" }),
      {},
    );
    expect(note.firstPaymentDate.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("operator overrides win over deal-derived defaults", () => {
    const overrides: CarryOverrides = {
      salePrice: 30000,
      downPayment: 3000,
      interestRate: 7.5,
      termMonths: 120,
      firstPaymentDate: "2026-03-01",
      borrowerId: 555,
    };
    const note = mapDealToNoteFields(baseDeal(), overrides);
    expect(note.originalPrincipal).toBe("27000"); // 30000 - 3000
    expect(note.downPayment).toBe("3000");
    expect(note.interestRate).toBe("7.5");
    expect(note.termMonths).toBe(120);
    expect(note.firstPaymentDate.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(note.borrowerId).toBe(555);
  });

  it("falls back to offerAmount when acceptedAmount is null", () => {
    const note = mapDealToNoteFields(
      baseDeal({ acceptedAmount: null }),
      {},
    );
    expect(note.originalPrincipal).toBe("15000"); // 20000 offer - 5000 down
  });

  it("never produces a negative principal when down exceeds sale", () => {
    const note = mapDealToNoteFields(
      baseDeal({ acceptedAmount: "1000" }),
      { downPayment: 5000 },
    );
    expect(note.originalPrincipal).toBe("0");
    expect(note.currentBalance).toBe("0");
  });

  it("uses sensible defaults when the deal has no analysis results", () => {
    const note = mapDealToNoteFields(
      baseDeal({ analysisResults: null, acceptedAmount: "10000" }),
      {},
    );
    expect(note.downPayment).toBe("0");
    expect(note.interestRate).toBe("0"); // operator must set a real rate
    expect(note.termMonths).toBe(120); // 10yr land-contract default
    expect(note.originalPrincipal).toBe("10000");
  });

  it("defaults start date to now when the deal has no closing date", () => {
    const fixedNow = new Date("2026-06-07T12:00:00.000Z");
    const note = mapDealToNoteFields(
      baseDeal({ closingDate: null }),
      {},
      fixedNow,
    );
    expect(note.startDate.toISOString().slice(0, 10)).toBe("2026-06-07");
    expect(note.firstPaymentDate.toISOString().slice(0, 10)).toBe("2026-07-07");
  });

  it("rounds the monthly payment to cents on the walk's no-terms shape (H-DEF-2)", () => {
    // Hybrid walk reproduction: a $40,000 disposition carrying NO terms at
    // all stored monthlyPayment "333.3333333333333" — the zero-rate branch
    // of calculateMonthlyPayment returned the raw quotient. The stored
    // payment is money: it is rounded to cents at write.
    const note = mapDealToNoteFields(
      baseDeal({ analysisResults: null, acceptedAmount: "40000", offerAmount: "40000" }),
      {},
    );
    expect(note.monthlyPayment).toBe("333.33");
  });

  it("leaves borrowerId null when the operator does not name a buyer", () => {
    // The deal table has no buyer link — the buyer is confirmed on the note,
    // so an un-overridden carry produces a borrower-less note.
    const note = mapDealToNoteFields(baseDeal(), {});
    expect(note.borrowerId).toBeNull();
  });
});

describe("missingCarryTerms — H-DEF-2: defaults never written as facts", () => {
  it("flags both terms when the deal records none and the operator supplies none", () => {
    // The hybrid walk's defaults probe: price-only deal, borrowerId-only
    // carry body. The route refuses on exactly this result — no note is
    // created on the 0% / 120-month platform defaults.
    const deal = baseDeal({ analysisResults: null });
    expect(missingCarryTerms(deal, {})).toEqual(["interestRate", "termMonths"]);
    expect(missingCarryTerms(deal, { borrowerId: 118 })).toEqual([
      "interestRate",
      "termMonths",
    ]);
  });

  it("flags nothing when the deal's saved analysis carries both terms", () => {
    expect(missingCarryTerms(baseDeal(), {})).toEqual([]);
  });

  it("flags nothing when the operator supplies both terms explicitly", () => {
    const deal = baseDeal({ analysisResults: null });
    expect(missingCarryTerms(deal, { interestRate: 9.5, termMonths: 120 })).toEqual([]);
  });

  it("treats an explicitly supplied 0% rate as a fact, not a default", () => {
    const deal = baseDeal({ analysisResults: null });
    expect(missingCarryTerms(deal, { interestRate: 0, termMonths: 120 })).toEqual([]);
    const dealWithZeroRate = baseDeal({
      analysisResults: { interestRate: 0, holdingPeriodMonths: 60 },
    });
    expect(missingCarryTerms(dealWithZeroRate, {})).toEqual([]);
  });

  it("the carry route refuses on missing terms before any note is created", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../../server/routes-notes.ts"),
      "utf8",
    );
    const start = src.indexOf('"/api/notes/from-deal/:dealId"');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(
      start,
      src.indexOf('"/api/notes/from-deal/:dealId"', start + 10),
    );
    const guard = body.indexOf("missingCarryTerms(carryableDeal, overrides)");
    const created = body.indexOf("storage.createNote(");
    expect(guard).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(guard);
  });

  it("flags each term independently", () => {
    const rateOnly = baseDeal({
      analysisResults: { interestRate: 9 },
    });
    expect(missingCarryTerms(rateOnly, {})).toEqual(["termMonths"]);
    const termOnly = baseDeal({
      analysisResults: { holdingPeriodMonths: 60 },
    });
    expect(missingCarryTerms(termOnly, {})).toEqual(["interestRate"]);
    // An override can cure one side while the other still defaults.
    expect(missingCarryTerms(rateOnly, { termMonths: 180 })).toEqual([]);
    expect(missingCarryTerms(termOnly, { interestRate: 7.5 })).toEqual([]);
  });
});
