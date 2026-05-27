/**
 * Glenn Okonkwo audit — landlord-tenant compliance tests.
 *
 * These tests pin the statutory-deadline math + retaliation logic so that a
 * future schema/data drift can't silently lengthen a security-deposit window
 * past what the state allows.
 */

import { describe, it, expect } from "vitest";
import {
  computeSecurityDepositDeadline,
  getNoticeRule,
  computeRetaliationWindow,
  requiresLeadPaintDisclosure,
  scanFairHousingText,
  computeHapRecertReminder,
  SECURITY_DEPOSIT_RULES,
} from "../../server/services/landlordCompliance";

describe("computeSecurityDepositDeadline", () => {
  const moveOut = new Date("2026-05-01T00:00:00Z");

  it("Texas — 30 days post move-out", () => {
    const r = computeSecurityDepositDeadline("TX", moveOut, new Date("2026-05-02T00:00:00Z"));
    expect(r.deadlineDate).toBe("2026-05-31");
    expect(r.daysRemaining).toBe(29);
    expect(r.severity).toBe("ok");
    expect(r.rule?.citation).toMatch(/§ 92\.103/);
  });

  it("California — 21 days", () => {
    const r = computeSecurityDepositDeadline("CA", moveOut, new Date("2026-05-02T00:00:00Z"));
    expect(r.deadlineDate).toBe("2026-05-22");
    expect(r.daysRemaining).toBe(20);
  });

  it("New York — 14 days post HSTPA", () => {
    const r = computeSecurityDepositDeadline("NY", moveOut, new Date("2026-05-02T00:00:00Z"));
    expect(r.deadlineDate).toBe("2026-05-15");
    expect(r.daysRemaining).toBe(13);
  });

  it("Florida — 15 days (worst case for landlord)", () => {
    const r = computeSecurityDepositDeadline("FL", moveOut, new Date("2026-05-02T00:00:00Z"));
    expect(r.deadlineDate).toBe("2026-05-16");
  });

  it("approaching severity inside 7 days", () => {
    // TX 30d; ask on 2026-05-25 → 6 days to go.
    const r = computeSecurityDepositDeadline("TX", moveOut, new Date("2026-05-25T00:00:00Z"));
    expect(r.daysRemaining).toBe(6);
    expect(r.severity).toBe("approaching");
  });

  it("red severity at <=2 days or past deadline", () => {
    // TX 30d; ask on 2026-05-30 → 1 day. red.
    const past = computeSecurityDepositDeadline("TX", moveOut, new Date("2026-05-30T00:00:00Z"));
    expect(past.severity).toBe("red");
    // Past deadline:
    const after = computeSecurityDepositDeadline("TX", moveOut, new Date("2026-06-10T00:00:00Z"));
    expect(after.daysRemaining).toBeLessThan(0);
    expect(after.severity).toBe("red");
  });

  it("returns ok severity / null deadline for missing inputs", () => {
    expect(computeSecurityDepositDeadline(null, null).deadlineDate).toBeNull();
    expect(computeSecurityDepositDeadline("XX", moveOut).rule).toBeNull();
  });

  it("covers all 50 states + DC", () => {
    const keys = Object.keys(SECURITY_DEPOSIT_RULES);
    expect(keys.length).toBeGreaterThanOrEqual(51);
    // Spot-check a sampling of states we don't otherwise test:
    expect(SECURITY_DEPOSIT_RULES.WA.daysAfterMoveOut).toBe(30);
    expect(SECURITY_DEPOSIT_RULES.MN.daysAfterMoveOut).toBe(21);
    expect(SECURITY_DEPOSIT_RULES.AK.daysAfterMoveOut).toBe(14);
  });
});

describe("getNoticeRule", () => {
  it("California 3-day pay-or-quit", () => {
    const r = getNoticeRule("CA", "pay_or_quit");
    expect(r?.minDays).toBe(3);
    expect(r?.citation).toMatch(/§ 1161/);
  });

  it("New York 14-day non-payment under RPAPL §711(2)", () => {
    const r = getNoticeRule("NY", "pay_or_quit");
    expect(r?.minDays).toBe(14);
    expect(r?.citation).toMatch(/RPAPL § 711/);
  });

  it("Texas 3-day notice to vacate", () => {
    const r = getNoticeRule("TX", "pay_or_quit");
    expect(r?.minDays).toBe(3);
  });

  it("Florida 7-day cure-or-quit (NOT 3-day for curable violations)", () => {
    const r = getNoticeRule("FL", "cure_or_quit");
    expect(r?.minDays).toBe(7);
  });

  it("returns null for unmodeled state/kind combinations", () => {
    expect(getNoticeRule("WY", "pay_or_quit")).toBeNull();
  });
});

describe("computeRetaliationWindow", () => {
  const now = new Date("2026-05-27T00:00:00Z");

  it("Texas 180-day window flags ticket 90d ago", () => {
    const r = computeRetaliationWindow({
      state: "TX",
      maintenanceTicketDates: ["2026-02-26"],
      evictionFilingDate: now,
    });
    expect(r.inRetaliationWindow).toBe(true);
    expect(r.presumptionDays).toBe(180);
    expect(r.triggeringTickets.length).toBe(1);
    expect(r.citation).toMatch(/§ 92\.331/);
  });

  it("New York 365-day window flags older tickets", () => {
    const r = computeRetaliationWindow({
      state: "NY",
      maintenanceTicketDates: ["2025-06-01"],
      evictionFilingDate: now,
    });
    expect(r.inRetaliationWindow).toBe(true);
    expect(r.presumptionDays).toBe(365);
  });

  it("does not flag tickets outside the window", () => {
    const r = computeRetaliationWindow({
      state: "FL",        // 90-day
      maintenanceTicketDates: ["2026-01-01"],
      evictionFilingDate: now,
    });
    expect(r.inRetaliationWindow).toBe(false);
  });

  it("uses 180d default for unknown state", () => {
    const r = computeRetaliationWindow({
      state: "ZZ",
      maintenanceTicketDates: [new Date(now.getTime() - 100 * 86400_000)],
      evictionFilingDate: now,
    });
    expect(r.presumptionDays).toBe(180);
    expect(r.inRetaliationWindow).toBe(true);
  });
});

describe("requiresLeadPaintDisclosure", () => {
  it("flags pre-1978 properties", () => {
    expect(requiresLeadPaintDisclosure(1977)).toBe(true);
    expect(requiresLeadPaintDisclosure(1950)).toBe(true);
  });
  it("does not flag 1978 or later", () => {
    expect(requiresLeadPaintDisclosure(1978)).toBe(false);
    expect(requiresLeadPaintDisclosure(2020)).toBe(false);
  });
  it("does not claim a duty when yearBuilt unknown", () => {
    expect(requiresLeadPaintDisclosure(null)).toBe(false);
    expect(requiresLeadPaintDisclosure(undefined)).toBe(false);
  });
});

describe("scanFairHousingText", () => {
  it("flags 'no kids' as familial-status", () => {
    const r = scanFairHousingText("Beautiful unit, no kids please");
    expect(r.clean).toBe(false);
    expect(r.findings.some(f => f.category === "familial_status")).toBe(true);
  });

  it("flags 'Christian household' as religion", () => {
    const r = scanFairHousingText("Looking for a Christian household to occupy.");
    expect(r.findings.some(f => f.category === "religion")).toBe(true);
  });

  it("flags 'ideal for singles' as familial-status", () => {
    const r = scanFairHousingText("Cozy studio — ideal for singles.");
    expect(r.findings.some(f => f.category === "familial_status")).toBe(true);
  });

  it("flags 'no Section 8' as source-of-income", () => {
    const r = scanFairHousingText("Rent is $1,500. No Section 8.");
    expect(r.findings.some(f => f.category === "source_of_income")).toBe(true);
  });

  it("flags 'no ESA' as disability discrimination", () => {
    const r = scanFairHousingText("No pets, no ESAs.");
    expect(r.findings.some(f => f.category === "disability")).toBe(true);
  });

  it("returns clean for neutral copy", () => {
    const r = scanFairHousingText("3 bed 2 bath, hardwood floors, in-unit laundry. Available June 1.");
    expect(r.clean).toBe(true);
    expect(r.findings.length).toBe(0);
  });
});

describe("computeHapRecertReminder", () => {
  it("fires reminder at <=60 days before anniversary", () => {
    // Lease started 2025-07-15; today is 2026-05-27. Next anniv: 2026-07-15 → 49 days.
    const r = computeHapRecertReminder({
      leaseStartDate: "2025-07-15",
      now: new Date("2026-05-27T00:00:00Z"),
    });
    expect(r.daysUntil).toBe(49);
    expect(r.shouldRemind).toBe(true);
  });

  it("does not fire when anniversary > 60 days away", () => {
    const r = computeHapRecertReminder({
      leaseStartDate: "2025-12-01",
      now: new Date("2026-05-27T00:00:00Z"),
    });
    expect(r.shouldRemind).toBe(false);
  });
});
