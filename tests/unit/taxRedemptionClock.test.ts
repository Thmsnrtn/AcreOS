/**
 * V-Tax-1 T2b — the redemption clock (shared/tax/clock.ts).
 *   - the countdown, the 90/30/7-day alert dates and which have been reached;
 *   - a redeemable deed in its period is LOCKED (do not improve, do not
 *     market) with what clears it; a lien says it is a lien, not the land;
 *   - marketable in AcreOS only with the deed held AND the quiet-title
 *     petition filed or an attorney-reviewed exception recorded;
 *   - the county procedure's stated period is checked against the deadline
 *     and a mismatch is flagged, never resolved;
 *   - redeemed or cancelled ties up no capital.
 */
import { describe, expect, it } from "vitest";
import { redemptionClock, type ClockInput } from "@shared/tax/clock";

const base: ClockInput = {
  saleType: "redeemable_deed",
  status: "active",
  saleDate: "2026-04-01",
  redemptionDeadline: "2027-04-01",
  deadlineSource: "computed_preliminary",
  deadlineBasis: "computed by AcreOS from its encoded GA rule — preliminary",
  purchaseAmountCents: 1_250_000,
  today: "2026-12-31",
  procedurePeriod: null,
  quietTitle: null,
};

describe("redemption clock", () => {
  it("counts down, dates the 90/30/7 alerts, and locks a redeemable deed with what clears it", () => {
    const c = redemptionClock(base);
    expect(c).toMatchObject({ phase: "redeemable", daysToDeadline: 91, capitalTiedUpCents: 1_250_000 });
    expect(c.alerts).toEqual([
      { daysBefore: 90, date: "2027-01-01", reached: false },
      { daysBefore: 30, date: "2027-03-02", reached: false },
      { daysBefore: 7, date: "2027-03-25", reached: false },
    ]);
    expect(c.lock).toEqual({ what: "do not improve, do not market", until: "2027-04-01", clears: ["redemption expires 2027-04-01", "the quiet-title petition is filed, or an attorney-reviewed exception is recorded"] });
    expect(c.marketable).toEqual({ eligible: false, reason: "still redeemable until 2027-04-01" });
    expect(c.nextAction).toMatch(/Next alert 2027-01-01/);
    expect(redemptionClock({ ...base, today: "2027-03-28" }).nextAction).toMatch(/expires in 4 days: confirm with the county/);
    expect(redemptionClock({ ...base, today: "2027-03-28" }).alerts.map((a) => a.reached)).toEqual([true, true, true]);
  });

  it("a lien says it is a lien, not the land", () => {
    expect(redemptionClock({ ...base, saleType: "lien" }).lock!.what).toMatch(/you hold a lien, not the land/);
  });

  it("marketable only with the deed held and the petition filed, or an attorney-reviewed exception", () => {
    const held = { ...base, status: "deed_obtained" as const, today: "2027-06-01" };
    expect(redemptionClock(held)).toMatchObject({ phase: "deed_held", marketable: { eligible: false }, lock: { what: "do not improve, do not market", until: "the quiet-title filing" } });
    expect(redemptionClock({ ...held, quietTitle: { petitionFiledOn: "2027-05-20", marketException: null } })).toMatchObject({ marketable: { eligible: true, reason: "quiet-title petition filed 2027-05-20" }, lock: null });
    expect(redemptionClock({ ...held, quietTitle: { petitionFiledOn: null, marketException: { attorneyName: "SYNTHETIC Esq.", reason: "title insurer will insure without the filing" } } }).marketable).toMatchObject({ eligible: true, reason: expect.stringMatching(/attorney-reviewed exception \(SYNTHETIC Esq\.\)/) });
    expect(redemptionClock({ ...base, today: "2027-04-02" })).toMatchObject({ phase: "redemption_expired", marketable: { eligible: false } });
  });

  it("checks the deadline against the county procedure and flags a mismatch without resolving it", () => {
    const agree = redemptionClock({ ...base, procedurePeriod: { months: 12, source: "SYNTHETIC Code §48-4-40", asOf: "2026-06-01", version: 2 } });
    expect(agree.procedureCheck).toMatchObject({ agrees: true, impliedDeadlineFromSale: "2027-04-01" });
    const differ = redemptionClock({ ...base, procedurePeriod: { months: 6, source: "SYNTHETIC Code §48-4-40", asOf: "2026-06-01", version: 2 } });
    expect(differ.procedureCheck).toMatchObject({ agrees: false, statedMonths: 6, impliedDeadlineFromSale: "2026-10-01" });
    expect(differ.deadline).toBe("2027-04-01");
  });

  it("redeemed or cancelled ties up no capital and carries no lock", () => {
    for (const status of ["redeemed", "cancelled"] as const) expect(redemptionClock({ ...base, status })).toMatchObject({ capitalTiedUpCents: 0, lock: null });
  });
});
