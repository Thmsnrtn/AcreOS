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

describe("notice simulation marker (T-DEF-4)", () => {
  const railEvent = (detail: Record<string, unknown>) => ({
    eventType: "redemption_notice_recorded" as const,
    eventDate: "2027-03-02",
    ruleCited: { kind: "procedure_object", source: "SYNTHETIC procedure v1" },
    detail: { method: "certified mail via AcreOS", note: null, sentViaRail: true, ...detail },
    recordedBy: "u",
    recordedAt: "2027-03-02T10:00:00.000Z",
  });
  const noticesFor = (detail: Record<string, unknown>) => certificateLedger({ ...golden.input, events: [railEvent(detail)] }).notices;

  it("a rail notice recorded in test mode is simulated:true", () => {
    expect(noticesFor({ providerId: "lob_real_1", testMode: true })[0]).toMatchObject({ viaRail: true, simulated: true });
  });
  it("a sim_ provider id is simulated:true even without testMode", () => {
    expect(noticesFor({ providerId: "sim_abc" })[0].simulated).toBe(true);
  });
  it("testMode:false on a rail row is simulated:false", () => {
    expect(noticesFor({ providerId: "psc_123", testMode: false })[0].simulated).toBe(false);
  });
  it("an operator-recorded notice is simulated:false (the operator's word)", () => {
    const n = certificateLedger(golden.input).notices[0];
    expect(n).toMatchObject({ viaRail: false, simulated: false });
    // even a stray testMode on a non-rail row cannot mark it
    expect(noticesFor({ sentViaRail: false, testMode: true })[0].simulated).toBe(false);
  });
  it("a rail row with no marker either way is simulated:null — never rounded to a boolean", () => {
    expect(noticesFor({ providerId: "psc_123" })[0].simulated).toBeNull();
    expect(noticesFor({})[0].simulated).toBeNull();
  });
});

