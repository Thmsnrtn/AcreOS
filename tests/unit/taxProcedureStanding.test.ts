/**
 * V-Tax-1 T2a — procedure standing (shared/tax/procedure.ts).
 *   - no procedure, a missing required field, a stale source, no county
 *     verification, or a stale verification each LOCK bidding, with a reason;
 *   - only a complete, fresh, verified version is biddable;
 *   - any source over 12 months old raises the stale-law banner;
 *   - county practice is flagged as such;
 *   - a flat penalty is never described as an annual rate.
 */
import { describe, expect, it } from "vitest";
import { describeReturn, isStale, procedureStanding, type ProcedureVersion } from "@shared/tax/procedure";

const TODAY = "2026-10-29";
const f = (value: unknown, asOf = "2026-06-01", basis: "state_law" | "county_practice" = "state_law") => ({ value, source: "SYNTHETIC Code §1", asOf, basis, verification: "checked_against_statute" as const });
const complete = (over: Partial<ProcedureVersion> = {}): ProcedureVersion => ({
  state: "TX",
  county: "Travis",
  version: 2,
  fields: {
    instrument: f("redeemable_deed") as never,
    bidMethod: f("premium bid, highest wins") as never,
    returnModel: f({ kind: "flat_penalty", penaltyBps: 2500 }) as never,
    redemptionPeriodMonths: f(6) as never,
  },
  countyVerification: { completedOn: "2026-09-15", completedBy: "u1", method: "called the SYNTHETIC county tax office" },
  ...over,
});

describe("procedure standing", () => {
  it("no procedure is locked, and says what to do", () => {
    const s = procedureStanding(null, TODAY);
    expect(s).toMatchObject({ biddable: false, staleLawBanner: false });
    expect(s.lockReasons[0].code).toBe("no_procedure");
  });

  it("a complete, fresh, verified version is biddable", () => {
    expect(procedureStanding(complete(), TODAY)).toMatchObject({ biddable: true, lockReasons: [], staleLawBanner: false });
  });

  it("a missing required field locks bidding; an optional one does not", () => {
    const v = complete();
    delete (v.fields as Record<string, unknown>).bidMethod;
    expect(procedureStanding(v, TODAY).lockReasons).toEqual([expect.objectContaining({ code: "missing_field", field: "bidMethod" })]);
    expect(procedureStanding(complete(), TODAY).lockReasons.some((r) => "field" in r && r.field === "noticeRequirements")).toBe(false);
  });

  it("a source older than 12 months raises the stale-law banner and locks bidding", () => {
    const v = complete();
    (v.fields as Record<string, unknown>).redemptionPeriodMonths = f(6, "2025-10-28");
    const s = procedureStanding(v, TODAY);
    expect(s).toMatchObject({ biddable: false, staleLawBanner: true, staleFields: ["redemptionPeriodMonths"] });
    expect(isStale("2025-10-29", TODAY)).toBe(false);
    expect(isStale("2025-10-28", TODAY)).toBe(true);
  });

  it("no verification, or one older than 12 months, locks bidding", () => {
    expect(procedureStanding(complete({ countyVerification: null }), TODAY).lockReasons.map((r) => r.code)).toEqual(["not_verified"]);
    expect(procedureStanding(complete({ countyVerification: { completedOn: "2025-09-01", completedBy: "u1", method: "x" } }), TODAY).lockReasons.map((r) => r.code)).toEqual(["verification_stale"]);
  });

  it("county practice is flagged", () => {
    const v = complete();
    (v.fields as Record<string, unknown>).bidMethod = f("rotational", "2026-06-01", "county_practice");
    expect(procedureStanding(v, TODAY).countyPracticeFields).toEqual(["bidMethod"]);
  });

  it("a flat penalty is described as one-time, never as a yearly rate", () => {
    expect(describeReturn({ kind: "flat_penalty", penaltyBps: 2500 })).toBe("25.00% flat penalty — one-time, not an annual rate");
    expect(describeReturn({ kind: "flat_penalty", penaltyBps: 2500 })).not.toMatch(/per year/);
    expect(describeReturn({ kind: "annual_rate", rateBps: 1800 })).toBe("18.00% per year");
  });
});
