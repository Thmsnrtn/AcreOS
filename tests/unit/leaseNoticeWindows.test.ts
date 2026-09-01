/**
 * Lease non-renewal notice windows — the encoded rules and the window math.
 *
 * statuteRegister `state.lease-nonrenewal-notice` was `prose-only`: "NO
 * TEST... the encoded windows themselves are unchecked." This file is the
 * gate (the deposit registry's exact sibling —
 * tests/unit/depositReturnDeadlines.test.ts is the model); the register
 * entry was reclassified unit-test and PROSE_ONLY_BASELINE lowered in the
 * same commit.
 *
 * It also pins the 2026-09-01 parser fix: computeNoticeWindow used a bare
 * `new Date()` + finite check, so "2026-02-30" parsed as March 2 and the
 * notice window opened off a rolled-over date — character-for-character the
 * defect that retired the duplicate deposit registry. Now parseCalendarDate
 * refuses it.
 *
 * NOT PINNED: that the encoded day counts are the correct reading of each
 * statute — that is attorney review (the module's own header says so), and
 * reviewStatus stays UNREVIEWED.
 */

import { describe, it, expect } from "vitest";
import {
  getLeaseNoticeRule,
  computeNoticeWindow,
} from "@shared/regulatory/leaseNoticeRules";

describe("registry hygiene", () => {
  // The registry is a private map; enumerate through the public getter over
  // the two-letter space so the population is the REAL exported behavior.
  const STATES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const encoded: string[] = [];
  for (const a of STATES) for (const b of STATES) {
    if (getLeaseNoticeRule(a + b)) encoded.push(a + b);
  }

  it("is populated and internally consistent", () => {
    expect(encoded.length).toBeGreaterThanOrEqual(20);
    for (const s of encoded) {
      const r = getLeaseNoticeRule(s)!;
      expect(r.state).toBe(s);
      expect(r.citation, `${s} has no citation`).toBeTruthy();
      // Sanity bounds, not legal truth: notice windows in this registry run
      // 15 to 90 days.
      expect(r.noticeDays).toBeGreaterThanOrEqual(15);
      expect(r.noticeDays).toBeLessThanOrEqual(90);
    }
  });

  it("unknown jurisdictions refuse — null rule, never a guessed default", () => {
    expect(getLeaseNoticeRule("ZZ")).toBeNull();
    expect(getLeaseNoticeRule(null)).toBeNull();
    expect(getLeaseNoticeRule(undefined)).toBeNull();
    const w = computeNoticeWindow("2026-06-30", "ZZ");
    expect(w.noticeDays).toBeNull();
    expect(w.noticeWindowOpensAt).toBeNull();
    expect(w.noticeWindowOpen).toBe(false);
  });
});

describe("window arithmetic", () => {
  it("opensAt = endDate - noticeDays, in UTC calendar days", () => {
    // TX 30 days: lease ends 2026-06-30 → notice window opens 2026-05-31.
    const tx = computeNoticeWindow("2026-06-30", "TX", new Date("2026-05-01T12:00:00Z"));
    expect(tx.noticeDays).toBe(30);
    expect(tx.noticeWindowOpensAt).toBe("2026-05-31");
    expect(tx.noticeWindowOpen).toBe(false); // May 1 is before the window
    // OR 90 days across a month boundary: ends 2026-03-31 → opens 2025-12-31.
    const or = computeNoticeWindow("2026-03-31", "OR", new Date("2026-01-15T00:00:00Z"));
    expect(or.noticeWindowOpensAt).toBe("2025-12-31");
    expect(or.noticeWindowOpen).toBe(true); // Jan 15 is inside the window
  });

  it("the window closes after the lease end date", () => {
    const w = computeNoticeWindow("2026-06-30", "TX", new Date("2026-07-02T00:00:00Z"));
    expect(w.noticeWindowOpen).toBe(false);
  });

  it("a calendar-impossible end date is refused, never rolled over (2026-09-01 fix)", () => {
    // "2026-02-30" used to become March 2 and open a window off a date that
    // does not exist. The rule's noticeDays is still reported (it is real);
    // the window is not.
    const w = computeNoticeWindow("2026-02-30", "TX", new Date("2026-02-01T00:00:00Z"));
    expect(w.noticeDays).toBe(30);
    expect(w.noticeWindowOpensAt).toBeNull();
    expect(w.noticeWindowOpen).toBe(false);
  });

  it("a missing end date yields the all-null shape — no rule days without a lease to apply them to", () => {
    const w = computeNoticeWindow(null, "TX");
    expect(w.noticeDays).toBeNull();
    expect(w.noticeWindowOpensAt).toBeNull();
    expect(w.noticeWindowOpen).toBe(false);
  });
});
