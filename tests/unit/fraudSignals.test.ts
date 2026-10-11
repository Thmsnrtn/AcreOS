/**
 * Fraud-check signals (W5a) — signals, never accusations, and REFUSE, NOT
 * DEFAULT: with any input missing a signal is "not_checked" with its reason —
 * never "fired" (an accusation on a guess) and never "clear" (a check that did
 * not happen). Every signal names its source and what to do.
 */
import { describe, expect, it } from "vitest";
import { evaluateFraudSignals, stateFromMailingAddress, type FraudCheckInput } from "../../shared/trust/fraudSignals";

const NOW = "2026-10-11T12:00:00Z";
const EMPTY: FraudCheckInput = {
  now: NOW,
  ownerMailingHistory: null,
  offerAmount: null,
  gatedValue: null,
  ownerSince: null,
  signerName: null,
  ownerOfRecord: null,
  isVacantLand: null,
  parcelState: null,
  ownerMailingState: null,
  freeAndClear: null,
  wireChangeReports: null,
};
const d = <T,>(value: T, source = "County GIS") => ({ value, source, observedAt: "2026-09-30T00:00:00Z" });

describe("no signal fires on missing data", () => {
  it("with nothing known, all five are 'not_checked' with a reason — none fired, none clear", () => {
    const s = evaluateFraudSignals(EMPTY);
    expect(s.map((x) => x.id).sort()).toEqual(["impersonation_profile", "mailing_address_changed", "offer_far_below_value", "signer_owner_mismatch", "wire_account_change"]);
    for (const x of s) {
      expect(x.status, x.id).toBe("not_checked");
      expect(x.detail).toMatch(/^Not checked: /);
      expect(x.source).toBeNull();
      expect(x.whatToDo.length).toBeGreaterThan(20);
    }
  });

  it("each signal stays 'not_checked' when only PART of its inputs is known", () => {
    const partial = evaluateFraudSignals({
      ...EMPTY,
      offerAmount: 1000, // value and ownership date missing
      signerName: "Jane Smith", // owner of record missing
      isVacantLand: d(true),
      parcelState: "TN", // mailing state + free-and-clear missing
    });
    for (const id of ["offer_far_below_value", "signer_owner_mismatch", "impersonation_profile"]) {
      expect(partial.find((x) => x.id === id)!.status, id).toBe("not_checked");
    }
  });

  it("a value that has not passed the accuracy gate is never compared", () => {
    const s = evaluateFraudSignals({ ...EMPTY, offerAmount: 100, ownerSince: d("1990-01-01") });
    expect(s.find((x) => x.id === "offer_far_below_value")!.detail).toMatch(/accuracy check/);
  });
});

describe("each signal fires on its pattern, with a source and a step", () => {
  it("a mailing-address change in the last 90 days", () => {
    const s = evaluateFraudSignals({
      ...EMPTY,
      ownerMailingHistory: [
        { value: "PO Box 9, Miami, FL 33101", source: "County GIS (assessor record)", observedAt: "2026-09-20T00:00:00Z" },
        { value: "12 Elm St, Chattanooga, TN 37402", source: "County GIS (assessor record)", observedAt: "2020-01-01T00:00:00Z" },
      ],
    }).find((x) => x.id === "mailing_address_changed")!;
    expect(s.status).toBe("fired");
    expect(s.source).toMatch(/County GIS/);
    expect(s.whatToDo).toMatch(/phone number of record/);
  });
  it("an old change is clear, and one address is clear", () => {
    const old = evaluateFraudSignals({
      ...EMPTY,
      ownerMailingHistory: [
        { value: "A", source: "x", observedAt: "2025-01-01T00:00:00Z" },
        { value: "B", source: "x", observedAt: "2020-01-01T00:00:00Z" },
      ],
    }).find((x) => x.id === "mailing_address_changed")!;
    expect(old.status).toBe("clear");
  });
  it("one address first seen within 90 days is NOT clear — a change just before it is invisible", () => {
    const s = evaluateFraudSignals({
      ...EMPTY,
      ownerMailingHistory: [{ value: "PO Box 9, Miami, FL 33101", source: "x", observedAt: new Date(Date.parse(EMPTY.now) - 10 * 86_400_000).toISOString() }],
    }).find((x) => x.id === "mailing_address_changed")!;
    expect(s.status).toBe("not_checked");
    const long = evaluateFraudSignals({
      ...EMPTY,
      ownerMailingHistory: [{ value: "PO Box 9, Miami, FL 33101", source: "x", observedAt: "2019-01-01T00:00:00Z" }],
    }).find((x) => x.id === "mailing_address_changed")!;
    expect(long.status).toBe("clear");
  });
  it("an offer far below a gated value on a long-held parcel", () => {
    const s = evaluateFraudSignals({ ...EMPTY, offerAmount: 5000, gatedValue: d(50000, "gated fact"), ownerSince: d("2001-05-01") }).find((x) => x.id === "offer_far_below_value")!;
    expect(s.status).toBe("fired");
    expect(s.whatToDo).toMatch(/title company/);
  });
  it("a signer who shares no name with the owner of record — and a shared surname is clear", () => {
    const fired = evaluateFraudSignals({ ...EMPTY, signerName: "Robert Jones", ownerOfRecord: d("SMITH MARY A") }).find((x) => x.id === "signer_owner_mismatch")!;
    expect(fired.status).toBe("fired");
    const clear = evaluateFraudSignals({ ...EMPTY, signerName: "Mary Smith", ownerOfRecord: d("SMITH MARY A") }).find((x) => x.id === "signer_owner_mismatch")!;
    expect(clear.status).toBe("clear");
    const trust = evaluateFraudSignals({ ...EMPTY, signerName: "Ann Lee", ownerOfRecord: d("OAKRIDGE FAMILY TRUST") }).find((x) => x.id === "signer_owner_mismatch")!;
    expect(trust.detail).toMatch(/authorized to sign/);
  });
  it("vacant + out-of-state + free and clear, only when all three are known", () => {
    const s = evaluateFraudSignals({ ...EMPTY, isVacantLand: d(true), parcelState: "TN", ownerMailingState: d("CA"), freeAndClear: d(true, "checklist") }).find((x) => x.id === "impersonation_profile")!;
    expect(s.status).toBe("fired");
    const inState = evaluateFraudSignals({ ...EMPTY, isVacantLand: d(true), parcelState: "TN", ownerMailingState: d("TN"), freeAndClear: d(true) }).find((x) => x.id === "impersonation_profile")!;
    expect(inState.status).toBe("clear");
  });
  it("a reported request to wire to a new account", () => {
    const s = evaluateFraudSignals({ ...EMPTY, wireChangeReports: [{ reportedAt: "2026-10-10T00:00:00Z", note: "email from 'title' with new bank" }] }).find((x) => x.id === "wire_account_change")!;
    expect(s.status).toBe("fired");
    expect(s.whatToDo).toMatch(/Call your title company/);
    expect(evaluateFraudSignals({ ...EMPTY, wireChangeReports: [] }).find((x) => x.id === "wire_account_change")!.status).toBe("clear");
  });
  it("never words a signal as an accusation", () => {
    const all = evaluateFraudSignals({
      ...EMPTY,
      ownerMailingHistory: [{ value: "A", source: "x", observedAt: "2026-10-01T00:00:00Z" }, { value: "B", source: "x", observedAt: "2020-01-01T00:00:00Z" }],
      signerName: "Robert Jones",
      ownerOfRecord: d("SMITH MARY"),
      wireChangeReports: [{ reportedAt: NOW, note: null }],
    });
    for (const s of all) expect(`${s.title} ${s.detail}`).not.toMatch(/\b(fraud|fraudster|scam|criminal|liar|fake)\b/i);
  });
});

describe("mailing state parsing", () => {
  it("reads the two-letter state before a ZIP, else refuses", () => {
    expect(stateFromMailingAddress("12 Elm St, Austin, TX 78701")).toBe("TX");
    expect(stateFromMailingAddress("12 Elm St, Austin, tx 78701-1234")).toBe("TX");
    expect(stateFromMailingAddress("12 Elm St")).toBeNull();
  });
});
