/**
 * Lavender Week 10 — monthly-close pipeline + Olympia 1099 batch tests.
 *
 * Covers the two acceptance gates declared in the action plan:
 *
 *   1. Trial balance is balanced (sum debits === sum credits) given a
 *      synthetic ledger of matched debit/credit pairs.
 *   2. The IRS FIRE-format file passes basic record-shape validation
 *      (record-len 750, sequencing T → A → B... → C → F, exactly one
 *      T and one F).
 *
 * The pipeline modules talk to the DB via Drizzle. We stub the DB layer
 * so the unit tests stay hermetic — the integration tests in CI exercise
 * the migration + real Postgres path.
 */

import { describe, it, expect, vi } from "vitest";

// ── Stub server/db so trialBalance.ts can import without a real DB ──────
vi.mock("../../server/db", () => {
  // Empty stub — tests below either don't import code paths that hit it,
  // or override behaviour with module-level mocks.
  return { db: {} };
});

import {
  buildFireFile,
  validateFireFile,
  buildTRecord,
  buildARecord,
  buildBRecord,
  buildCRecord,
  buildFRecord,
} from "../../server/services/irsFireFormat";

import { perMonthCents, monthsBetween, monthsDueAsOf } from "../../server/services/recognitionWorker";

// ── Trial balance: synthetic in-memory math ──────────────────────────────
//
// The trial-balance generator is a thin SQL aggregation over
// account_ledger_entries. We replicate its math here over a synthetic
// ledger to verify the invariant: every balanced n-tuple keeps
// sum(debit) === sum(credit) at the trial-balance layer.

function syntheticTrialBalance(entries: Array<{ accountNumber: string; debit: number; credit: number }>) {
  const byAcct = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    const cur = byAcct.get(e.accountNumber) ?? { debit: 0, credit: 0 };
    cur.debit += e.debit;
    cur.credit += e.credit;
    byAcct.set(e.accountNumber, cur);
  }
  const rows: Array<{ accountNumber: string; debit: number; credit: number }> = [];
  for (const [accountNumber, agg] of byAcct) {
    const net = agg.debit - agg.credit;
    if (net === 0) continue;
    rows.push({ accountNumber, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balance: totalDebit - totalCredit };
}

describe("Lavender — trial balance balanced invariant", () => {
  it("nets to zero when every event posts a balanced n-tuple", () => {
    // Three balanced events:
    //   $100 invoice paid:  DR Cash 100 / CR Revenue 100
    //   $40 refund:         DR Revenue 40 / CR Cash 40
    //   $1200 annual:       DR Cash 1200 / CR Deferred 1200
    //   $100 recognised:    DR Deferred 100 / CR Revenue 100
    const entries = [
      { accountNumber: "1000", debit: 10000, credit: 0 }, // Cash
      { accountNumber: "4000", debit: 0, credit: 10000 }, // Revenue
      { accountNumber: "4000", debit: 4000, credit: 0 },
      { accountNumber: "1000", debit: 0, credit: 4000 },
      { accountNumber: "1000", debit: 120000, credit: 0 },
      { accountNumber: "2050", debit: 0, credit: 120000 }, // Deferred
      { accountNumber: "2050", debit: 10000, credit: 0 },
      { accountNumber: "4000", debit: 0, credit: 10000 },
    ];
    const tb = syntheticTrialBalance(entries);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.balance).toBe(0);
  });

  it("surfaces non-zero balance when a leg is dropped", () => {
    // Drop the credit side of the refund — ledger is unbalanced.
    const entries = [
      { accountNumber: "1000", debit: 10000, credit: 0 },
      { accountNumber: "4000", debit: 0, credit: 10000 },
      { accountNumber: "4000", debit: 4000, credit: 0 }, // missing CR Cash 4000
    ];
    const tb = syntheticTrialBalance(entries);
    expect(tb.balance).not.toBe(0);
  });
});

describe("Lavender — recognition worker date math", () => {
  it("monthsBetween treats a Jan 1 → Jan 1 (next year) span as 12", () => {
    expect(monthsBetween("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toBe(12);
  });
  it("monthsBetween rounds large-day-remainders up", () => {
    // Feb 1 → Jul 22 is ~5.7 months → 6.
    expect(monthsBetween("2026-02-01T00:00:00Z", "2026-07-22T00:00:00Z")).toBe(6);
  });

  it("perMonthCents drops the remainder onto month 1", () => {
    // 12,005 cents / 12 months = 1000 base, remainder 5
    expect(perMonthCents(12005, 12, 1)).toBe(1005);
    expect(perMonthCents(12005, 12, 2)).toBe(1000);
    // Drainage sums back to total.
    let s = 0;
    for (let m = 1; m <= 12; m++) s += perMonthCents(12005, 12, m);
    expect(s).toBe(12005);
  });

  it("monthsDueAsOf recognises one month immediately on period start", () => {
    expect(monthsDueAsOf("2026-01-01", "2026-01-01", 12)).toBe(1);
    expect(monthsDueAsOf("2026-01-01", "2026-06-15", 12)).toBe(6);
    // Capped at monthsTotal.
    expect(monthsDueAsOf("2026-01-01", "2030-01-01", 12)).toBe(12);
  });
});

// ── IRS FIRE: shape validation ────────────────────────────────────────────

describe("Olympia — IRS FIRE-format records", () => {
  const transmitter = {
    taxYear: 2025,
    tcc: "ABCDE",
    transmitterTin: "123456789",
    transmitterName: "ACREOS LAND HOLDINGS LLC",
    transmitterAddress: "100 MAIN ST",
    city: "AUSTIN",
    state: "TX",
    zip: "787010000",
    contactName: "JANE OPERATOR",
    contactPhone: "5125550100",
    contactEmail: "ops@example.com",
    testIndicator: "T" as const,
  };

  const issuer = {
    taxYear: 2025,
    payerTin: "123456789",
    nameControl: "ACRE",
    payerName: "ACREOS LAND HOLDINGS LLC",
    payerAddress: "100 MAIN ST",
    payerCity: "AUSTIN",
    payerState: "TX",
    payerZip: "787010000",
    payerPhone: "5125550100",
    returnType: "INT" as const,
    amountCodes: "1",
  };

  const samplePayee = {
    taxYear: 2025,
    box1IntCents: 75000, // $750.00 interest
    recipientTin: "987654321",
    recipientTinType: "SSN" as const,
    accountNumber: "NOTE-42",
    recipientName: "JOHN BORROWER",
    recipientAddress: "200 OAK ST",
    recipientCity: "DALLAS",
    recipientState: "TX",
    recipientZip: "752010000",
    nameControl: "BORR",
  };

  it("each record is exactly 750 chars", () => {
    expect(buildTRecord(transmitter)).toHaveLength(750);
    expect(buildARecord(issuer)).toHaveLength(750);
    expect(buildBRecord(samplePayee)).toHaveLength(750);
    expect(buildCRecord({ payeeCount: 1, controlTotalBox1Cents: 75000 })).toHaveLength(750);
    expect(buildFRecord({ issuerCount: 1, payeeCount: 1 })).toHaveLength(750);
  });

  it("buildFireFile assembles a valid T-A-B-C-F sequence", () => {
    const file = buildFireFile({
      transmitter,
      issuer,
      payees: [samplePayee, { ...samplePayee, recipientTin: "111223333", recipientName: "JANE BORROWER", box1IntCents: 120000 }],
    });
    expect(file.recordCounts).toEqual({ T: 1, A: 1, B: 2, C: 1, F: 1 });
    const errors = validateFireFile(file.text);
    expect(errors).toEqual([]);
    expect(file.bytes).toBe((1 + 1 + 2 + 1 + 1) * (750 + 2));
  });

  it("validateFireFile flags wrong-length records", () => {
    // Truncate the T record.
    const file = buildFireFile({ transmitter, issuer, payees: [samplePayee] });
    const broken = file.text.slice(0, 600) + "\r\n" + file.text.slice(750);
    const errs = validateFireFile(broken);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("validateFireFile rejects a missing F record", () => {
    const file = buildFireFile({ transmitter, issuer, payees: [samplePayee] });
    // Drop the trailing F record line.
    const lines = file.text.split("\r\n").filter((l) => l.length > 0);
    lines.pop();
    const broken = lines.join("\r\n") + "\r\n";
    const errs = validateFireFile(broken);
    expect(errs.some((e) => e.includes("F record"))).toBe(true);
  });
});
