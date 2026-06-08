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

  it("leaves borrowerId null when the operator does not name a buyer", () => {
    // The deal table has no buyer link — the buyer is confirmed on the note,
    // so an un-overridden carry produces a borrower-less note.
    const note = mapDealToNoteFields(baseDeal(), {});
    expect(note.borrowerId).toBeNull();
  });
});
