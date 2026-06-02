/**
 * Tests for §1026.41 periodic statement field-completeness audit.
 *
 * The generator's DB path is integration-tested elsewhere; this file
 * exercises the auditRequiredFields function that gates whether a
 * generated row contains every §1026.41(d) field the reg mandates.
 *
 * Beatrice would walk the rejection cases at audit time — if a future
 * change drops a field, this test catches it before deploy.
 */

import { describe, expect, it } from "vitest";
import { auditRequiredFields } from "./index";

function validRow() {
  return {
    amountDueCents: 50_000,
    dueDate: "2026-07-01",
    principalBalanceCents: 9_500_000,
    interestRateBps: 850,
    payoffCents: 9_567_708,
    pastPaymentBreakdown: {
      principalCents: 10_000,
      interestCents: 35_000,
      escrowCents: 5_000,
      feesCents: 0,
      unappliedCents: 0,
      totalReceivedCents: 50_000,
    },
    paymentApplicationExplanation: {
      principalCents: 10_500,
      interestCents: 34_500,
      escrowCents: 5_000,
      feesCents: 0,
    },
    ytdPrincipalCents: 60_000,
    ytdInterestCents: 210_000,
    transactions: [
      {
        date: "2026-06-01",
        label: "Payment received",
        amountCents: 50_000,
        appliedTo: "principal/interest",
      },
    ],
  };
}

describe("auditRequiredFields — §1026.41(d) completeness gate", () => {
  it("passes for a fully-populated row", () => {
    const { ok, missingFields } = auditRequiredFields(validRow());
    expect(ok).toBe(true);
    expect(missingFields).toEqual([]);
  });

  it("flags missing amountDueCents", () => {
    const row = validRow() as { amountDueCents?: number; [k: string]: unknown };
    delete row.amountDueCents;
    const { ok, missingFields } = auditRequiredFields(row as Parameters<typeof auditRequiredFields>[0]);
    expect(ok).toBe(false);
    expect(missingFields.some((m) => m.includes("§1026.41(d)(1)"))).toBe(true);
  });

  it("flags missing payoffCents — §1026.41(d)(3)(iii)", () => {
    const row = validRow() as { payoffCents?: number; [k: string]: unknown };
    delete row.payoffCents;
    const { ok, missingFields } = auditRequiredFields(row as Parameters<typeof auditRequiredFields>[0]);
    expect(ok).toBe(false);
    expect(missingFields.some((m) => m.includes("§1026.41(d)(3)(iii)"))).toBe(true);
  });

  it("flags missing pastPaymentBreakdown — §1026.41(d)(4)", () => {
    const row = validRow() as { pastPaymentBreakdown?: unknown; [k: string]: unknown };
    delete row.pastPaymentBreakdown;
    const { ok, missingFields } = auditRequiredFields(row as Parameters<typeof auditRequiredFields>[0]);
    expect(ok).toBe(false);
    expect(missingFields.some((m) => m.includes("§1026.41(d)(4)"))).toBe(true);
  });

  it("flags missing transactions array — §1026.41(d)(5)", () => {
    const row = validRow() as { transactions?: unknown[]; [k: string]: unknown };
    delete row.transactions;
    const { ok, missingFields } = auditRequiredFields(row as Parameters<typeof auditRequiredFields>[0]);
    expect(ok).toBe(false);
    expect(missingFields.some((m) => m.includes("§1026.41(d)(5)"))).toBe(true);
  });

  it("flags multiple missing fields at once", () => {
    const row = validRow() as Record<string, unknown>;
    delete row.amountDueCents;
    delete row.payoffCents;
    delete row.transactions;
    const { ok, missingFields } = auditRequiredFields(row as Parameters<typeof auditRequiredFields>[0]);
    expect(ok).toBe(false);
    expect(missingFields.length).toBeGreaterThanOrEqual(3);
  });
});
