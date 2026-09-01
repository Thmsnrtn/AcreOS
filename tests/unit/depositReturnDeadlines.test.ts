/**
 * Deposit-return deadlines — the encoded values and the clock arithmetic.
 *
 * statuteRegister `state.security-deposit-return` was `prose-only`: the
 * registry's POSTURE was tested (one owner + refusal for unknown states, in
 * depositRegistriesAgree.test.ts) but nothing pinned the deadlines that ARE
 * encoded, the deduction-branch selection, the business-day arithmetic, or
 * the calendar-rollover refusal. This file is that gate; the register entry
 * was reclassified unit-test and PROSE_ONLY_BASELINE lowered in the same
 * commit.
 *
 * SCOPE — what this file does and does not prove:
 *   PINNED:     the note's prose agrees with the encoded number ("Encoded at
 *               N" ⇒ deadlineDays === N); the two-branch states select by
 *               hasDeductions exactly as their notes describe; the computed
 *               date is move-out + N (calendar or business days as flagged);
 *               an invalid calendar date is refused, never rolled over; an
 *               unknown jurisdiction yields { known:false, unknownReason }
 *               and NEVER a date; the countdown never fabricates a zero.
 *   NOT PINNED: that the encoded numbers are the correct reading of each
 *               statute. That is legal judgement — reviewStatus stays
 *               UNREVIEWED until attorney review, and
 *               server/services/rental/depositClock.ts /
 *               depositDisposition.ts built on top remain untested.
 */

import { describe, it, expect } from "vitest";
import {
  computeDepositDeadline,
  depositDeadlineCountdown,
  getDepositReturnRule,
  DEPOSIT_RULE_STATES,
  type DepositReturnRule,
} from "@shared/regulatory/depositReturnRules";

const allRules: DepositReturnRule[] = DEPOSIT_RULE_STATES.map((s) => {
  const r = getDepositReturnRule(s);
  if (!r) throw new Error(`DEPOSIT_RULE_STATES lists ${s} but the registry returns null`);
  return r;
});

describe("registry hygiene", () => {
  it("is populated, sorted, and internally consistent", () => {
    expect(DEPOSIT_RULE_STATES.length).toBeGreaterThanOrEqual(45);
    expect([...DEPOSIT_RULE_STATES].sort()).toEqual([...DEPOSIT_RULE_STATES]);
    for (const r of allRules) {
      expect(DEPOSIT_RULE_STATES).toContain(r.state);
      expect(r.citation.length, `${r.state} has no citation`).toBeGreaterThan(5);
      // Sanity bounds, not legal truth: no US deposit-return statute in this
      // registry is shorter than 10 days or longer than 60.
      expect(r.deadlineDays).toBeGreaterThanOrEqual(10);
      expect(r.deadlineDays).toBeLessThanOrEqual(60);
    }
  });

  it("KY stays deliberately absent (two-stage statute; refuse rather than flatten)", () => {
    // The file header records WHY. If KY gains an entry, that is a legal
    // judgement call to make explicitly — with the citation — not a default.
    expect(getDepositReturnRule("KY")).toBeNull();
  });
});

describe("the note's prose agrees with the encoded number", () => {
  // Several notes say which branch of a multi-branch statute was encoded
  // ("Encoded at 14 — the shorter window"). A drift between that sentence and
  // deadlineDays would show an operator one number while the clock counts
  // another — the exact prose/enforcement split the founder_ask sentence had.
  it('every "Encoded at N" note matches deadlineDays', () => {
    let matched = 0;
    for (const r of allRules) {
      const m = r.note?.match(/Encoded at (?:the )?(\d+)/);
      if (!m) continue;
      matched += 1;
      expect(
        r.deadlineDays,
        `${r.state}: note says "Encoded at ${m[1]}" but deadlineDays is ${r.deadlineDays}`,
      ).toBe(Number(m[1]));
    }
    // Vacuity guard: the phrase exists in the registry today (AK, CO, CT, ID,
    // ME, NC, WV, WY). A rewording that breaks the parser must fail here, not
    // silently stop checking.
    expect(matched, "the 'Encoded at N' parser matched almost nothing").toBeGreaterThanOrEqual(6);
  });

  it("the two-branch states encode both numbers their notes describe", () => {
    const fl = getDepositReturnRule("FL")!;
    expect(fl.deadlineDays).toBe(30);
    expect(fl.deadlineDaysNoDeductions).toBe(15);
    const mt = getDepositReturnRule("MT")!;
    expect(mt.deadlineDays).toBe(30);
    expect(mt.deadlineDaysNoDeductions).toBe(10);
    const il = getDepositReturnRule("IL")!;
    expect(il.deadlineDays).toBe(30);
    expect(il.deadlineDaysNoDeductions).toBe(45);
  });
});

describe("deadline arithmetic", () => {
  it("calendar days: TX move-out + 30", () => {
    const r = computeDepositDeadline({ moveOutDate: "2026-01-01", state: "TX", hasDeductions: true });
    expect(r.known).toBe(true);
    expect(r.deadlineDate).toBe("2026-01-31");
    expect(r.deadlineDays).toBe(30);
    expect(r.businessDays).toBe(false);
  });

  it("branch selection: FL picks 15 with no deductions, 30 with", () => {
    const withHold = computeDepositDeadline({ moveOutDate: "2026-01-01", state: "FL", hasDeductions: true });
    const noHold = computeDepositDeadline({ moveOutDate: "2026-01-01", state: "FL", hasDeductions: false });
    expect(withHold.deadlineDate).toBe("2026-01-31");
    expect(withHold.deadlineDays).toBe(30);
    expect(noHold.deadlineDate).toBe("2026-01-16");
    expect(noHold.deadlineDays).toBe(15);
  });

  it("business days: AZ counts 14 weekdays, skipping weekends", () => {
    // 2026-01-05 is a Monday. 14 business days forward crosses two weekends
    // and lands on Friday 2026-01-23. If someone flips AZ to calendar days,
    // the date becomes 2026-01-19 and this fails.
    const r = computeDepositDeadline({ moveOutDate: "2026-01-05", state: "AZ", hasDeductions: true });
    expect(r.businessDays).toBe(true);
    expect(r.deadlineDate).toBe("2026-01-23");
  });

  it("a calendar-impossible move-out date is refused, never rolled over", () => {
    // The retired parser turned 2026-02-30 into March 2, making a statutory
    // deadline land two days late. The survivor must refuse it.
    const r = computeDepositDeadline({ moveOutDate: "2026-02-30", state: "TX", hasDeductions: true });
    expect(r.known).toBe(false);
    expect(r.deadlineDate).toBeNull();
    expect(r.unknownReason).toBeTruthy();
  });
});

describe("the honest-unknown contract", () => {
  it("an unencoded jurisdiction gets a reason, never a date", () => {
    const r = computeDepositDeadline({ moveOutDate: "2026-01-01", state: "KY", hasDeductions: true });
    expect(r.known).toBe(false);
    expect(r.deadlineDate).toBeNull();
    expect(r.deadlineDays).toBeNull();
    expect(r.unknownReason).toContain("KY");
    expect(r.unknownReason).toContain("counsel");
  });

  it("a missing state is named as such", () => {
    const r = computeDepositDeadline({ moveOutDate: "2026-01-01", state: null, hasDeductions: false });
    expect(r.known).toBe(false);
    expect(r.unknownReason).toContain("(no state on the lease)");
  });

  it("a known state without a move-out date waits for the date, citing the statute", () => {
    const r = computeDepositDeadline({ moveOutDate: null, state: "TX", hasDeductions: false });
    expect(r.known).toBe(false);
    expect(r.deadlineDate).toBeNull();
    expect(r.unknownReason).toContain("TX");
    expect(r.unknownReason).toContain("Tex. Prop. Code");
  });
});

describe("countdown", () => {
  const today = new Date("2026-01-20T15:30:00Z");

  it("counts down, flags urgency at ≤7 days, and overdue past the deadline", () => {
    expect(depositDeadlineCountdown("2026-01-31", today)).toEqual({
      deadlineDate: "2026-01-31",
      daysRemaining: 11,
      overdue: false,
      urgent: false,
    });
    expect(depositDeadlineCountdown("2026-01-25", today)).toMatchObject({
      daysRemaining: 5,
      overdue: false,
      urgent: true,
    });
    expect(depositDeadlineCountdown("2026-01-19", today)).toMatchObject({
      daysRemaining: -1,
      overdue: true,
      urgent: true,
    });
  });

  it("no deadline ⇒ nulls, never a fabricated zero", () => {
    expect(depositDeadlineCountdown(null, today)).toEqual({
      deadlineDate: null,
      daysRemaining: null,
      overdue: false,
      urgent: false,
    });
  });
});
