/**
 * V-Tax-1 T3b — the position record (certificate ledger). Pure. SYNTHETIC.
 *
 *   - the golden case (shared/tax/golden/ledger-golden.json), field by field;
 *   - with no county subsequent-tax rule, AcreOS says nothing about
 *     reimbursement — it never assumes the taxes come back;
 *   - interest is shown only when computed, and never includes subsequent
 *     taxes; with no foreclosure deadline on record, it says so — no default.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { certificateLedger, type LedgerInput } from "@shared/tax/ledger";

const golden = JSON.parse(readFileSync(path.join(__dirname, "../../shared/tax/golden/ledger-golden.json"), "utf8")) as { input: LedgerInput; expected: unknown };

describe("position record", () => {
  it("reproduces the golden case exactly", () => {
    expect(certificateLedger(golden.input)).toEqual(golden.expected);
  });

  it("no county subsequent-tax rule: reimbursement is not stated, not assumed", () => {
    const l = certificateLedger({ ...golden.input, subsequentTaxRule: null });
    expect(l.subsequentTaxes.reimbursement).toEqual({ status: "not_stated", why: "the county procedure does not state its subsequent-tax rule, so AcreOS says nothing about whether these are reimbursed" });
    expect(l.subsequentTaxes.totalCents).toBe(100_000);
  });

  it("computed interest says what it covers; no foreclosure deadline is said plainly", () => {
    const l = certificateLedger({ ...golden.input, bidDownRateBps: 1425, interest: { interestCents: 68_581, asOfDate: "2026-10-29", refusalReason: null, preliminary: true }, events: [] });
    expect(l.interest).toEqual({ status: "computed", cents: 68_581, text: "$685.81 accrued on the certificate amount as of 2026-10-29 — preliminary; verify with the county. Subsequent taxes are not included." });
    expect(l.rate.text).toBe("14.25% — the rate you won at, per year");
    expect(l.foreclosureFilingDeadline).toMatchObject({ status: "not_stated" });
    expect(l.subsequentTaxes.payments).toEqual([]);
    expect(l.notices).toEqual([]);
  });
});
