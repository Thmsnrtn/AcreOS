/**
 * The borrower's Form 1098 copy is the form the lender would file
 * (best-in-class audit 2026-10-20, §3 P0 #4).
 *
 * The portal used to build its own "Form 1098" with Box 2 = the note's
 * CURRENT balance. The IRS instructions require the principal outstanding on
 * January 1 of the tax year, so every borrower who paid during the year got a
 * Box 2 that was too low by that year's principal. The expected values below
 * are computed from the fixture's own numbers, independent of the generator.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import {
  borrowerCopy1098,
  BORROWER_1098_NOT_ISSUABLE,
  type Form1098Candidate,
  type LenderIdentity,
} from "../../server/services/form1098Batch";
import { TaxIdentityError } from "../../server/services/bookkeeping";

const lender: LenderIdentity = {
  name: "Cedar Ridge Land Holdings LLC",
  address: { line1: "900 Congress Ave", city: "Austin", state: "TX", zip: "78701" },
  phone: "5125550100",
  tin: "88-1234567",
  tinType: "EIN",
};

// 2025: twelve payments of $100 interest + $50 principal; one 2024 entry
// proves pre-year coverage; one 2026 entry has posted since.
const ledger = [
  { date: "2024-12-01", principalCents: 5_000, interestCents: 10_000 },
  ...Array.from({ length: 12 }, (_, m) => ({
    date: `2025-${String(m + 1).padStart(2, "0")}-01`,
    principalCents: 5_000,
    interestCents: 10_000,
  })),
  { date: "2026-01-01", principalCents: 5_000, interestCents: 10_000 },
];
const CURRENT_BALANCE = 2_000_000; // $20,000 today, after the 2026-01 payment

const candidate: Form1098Candidate = {
  source: "originated",
  noteRef: "NOTE-7",
  accountNumber: "NOTE-7",
  originationDate: "2020-03-01",
  acquisitionDate: null,
  firstScheduledPaymentDate: "2020-04-01",
  originalPrincipalCents: 3_000_000,
  currentBalanceCents: CURRENT_BALANCE,
  borrowerName: "Ana Ruiz",
  borrowerAddress: { line1: "12 Elm St", city: "Bastrop", state: "TX", zip: "78602" },
  borrowerEncryptedTin: "412-88-7635",
  borrowerTinType: "SSN",
  propertyAddress: { line1: "TR 4 County Road 219", city: "Bastrop", state: "TX", zip: "78602" },
  ledger,
};

describe("borrower portal Form 1098 copy", () => {
  it("Box 2 is the Jan 1 principal, not today's balance", async () => {
    const copy = await borrowerCopy1098(
      { loadCandidate: async () => candidate, loadLender: async () => lender },
      2025,
    );
    expect(copy.kind).toBe("form");
    if (copy.kind !== "form") return;
    // Jan 1 2025 = today's $20,000 + 12 × $50 paid in 2025 + $50 paid in 2026.
    expect(copy.form.box2OutstandingMortgagePrincipalCents).toBe(2_000_000 + 12 * 5_000 + 5_000);
    expect(copy.form.box2OutstandingMortgagePrincipalCents).not.toBe(CURRENT_BALANCE);
    // Box 1 = 12 × $100 interest received in 2025 only.
    expect(copy.form.box1MortgageInterestReceivedCents).toBe(12 * 10_000);
  });

  it("refuses when the lender's tax identity is missing", async () => {
    const copy = await borrowerCopy1098(
      {
        loadCandidate: async () => candidate,
        loadLender: async () => {
          throw new TaxIdentityError("PAYER_EIN_MISSING", "no EIN", { orgId: 1 });
        },
      },
      2025,
    );
    expect(copy).toEqual({ kind: "unavailable", reason: BORROWER_1098_NOT_ISSUABLE });
  });

  it("refuses rather than reports when the ledger cannot prove the Jan 1 principal", async () => {
    const copy = await borrowerCopy1098(
      {
        loadCandidate: async () => ({ ...candidate, ledger: ledger.filter((e) => e.date >= "2025-01-01") }),
        loadLender: async () => lender,
      },
      2025,
    );
    expect(copy.kind).toBe("unavailable");
  });

  it("the portal route derives the copy from the generator and never prints currentBalance as Box 2", () => {
    const src = stripComments(readFileSync("server/routes-borrower.ts", "utf8"));
    const start = src.indexOf("statementType === '1098'");
    const end = src.indexOf("type: 'statement'", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const branch = src.slice(start, end);
    expect(branch).toContain("borrowerCopy1098ForNote(");
    expect(branch).not.toMatch(/currentBalance/);
  });
});
