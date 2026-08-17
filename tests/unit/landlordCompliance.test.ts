/**
 * Glenn Okonkwo audit — landlord-tenant compliance tests.
 *
 * These tests pin the statutory-deadline math + retaliation logic so that a
 * future schema/data drift can't silently lengthen a security-deposit window
 * past what the state allows.
 */

import { describe, it, expect } from "vitest";
import {
  getNoticeRule,
  computeRetaliationWindow,
  requiresLeadPaintDisclosure,
  scanFairHousingText,
  computeHapRecertReminder,
} from "../../server/services/landlordCompliance";

/*
 * THE SECURITY-DEPOSIT TESTS WERE REMOVED HERE, NOT RELOCATED — 2026-08-14,
 * BLOCKERS B18, founder ruling "retire the dead duplicate".
 *
 * They covered `SECURITY_DEPOSIT_RULES` and `computeSecurityDepositDeadline`,
 * which this module no longer has. CLAUDE.md's rule is to rewrite an assertion to
 * the new truth rather than delete it, and the reason that does not apply here is
 * worth stating, because it is the whole point of B18:
 *
 * **These tests asserted the losing side of a real conflict.** `FL: 15 days` is
 * one of the four states where this table and the LIVE registry
 * (`shared/regulatory/depositReturnRules.ts`) disagreed while citing the same
 * statute — FL 15 vs 30, ME 30 vs 21, MT 10 vs 30, OK 45 vs 30. Porting
 * `expect(...).toBe(15)` onto the live registry would enshrine a reading nobody
 * has reviewed, which is exactly the confident-wrong-deadline outcome B18 exists
 * to avoid.
 *
 * The invariant they were protecting — that a deposit deadline is computed from
 * the statute and not guessed — now has ONE owner, and
 * `tests/unit/depositRegistriesAgree.test.ts` asserts that single ownership
 * directly. The live registry keeps its honest posture: a state it does not encode
 * returns `{ known: false, unknownReason }` rather than a number.
 */

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
