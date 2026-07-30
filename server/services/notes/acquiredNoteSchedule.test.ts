/**
 * Tests for acquiredNoteSchedule — the acquired-note due-date derivation.
 *
 * The cases below are not generic date-math coverage; each one pins a defect
 * that either shipped or was one commit away from shipping:
 *
 *  - the mid-life import (a 2019 note bought in 2026) — the payoff engine
 *    already got bitten by deriving from origination
 *  - the six-months-behind note — notes.tsx rolls it forward and renders it
 *    as if the borrower were current
 *  - February clamping for due days 29/30/31, leap and non-leap
 *  - every incoherent-facts path returning null instead of a plausible date
 *  - the delinquency band boundaries, with and without a grace offset
 *  - the threshold-drift guard, which reads financeAgent.ts as text
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NOTE_DELINQUENCY_THRESHOLDS,
  advancePaidThrough,
  computeNoteDelinquency,
  deriveNextPaymentDate,
  lateFeeAssessable,
  nextPaymentVerdict,
  type AcquiredNoteScheduleFacts,
} from "./acquiredNoteSchedule";

/**
 * Default fixture: a note originated AND acquired the same day, so the
 * `history_predates_acquisition` guard is inert unless a test opts into it.
 * Tests that move `originationDate` move `acquisitionDate` with it unless the
 * gap is the thing under test.
 */
function facts(
  overrides: Partial<AcquiredNoteScheduleFacts> = {},
): AcquiredNoteScheduleFacts {
  return {
    paymentDueDay: 15,
    firstPaymentDate: null,
    originationDate: "2020-01-10",
    maturityDate: "2050-01-15",
    acquisitionDate: "2020-01-10",
    paidThroughDate: null,
    ...overrides,
  };
}

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// ============================================================================
// deriveNextPaymentDate — anchoring
// ============================================================================

describe("deriveNextPaymentDate — anchoring", () => {
  it("anchors on firstPaymentDate when the paperwork records one", () => {
    expect(
      deriveNextPaymentDate(
        facts({ firstPaymentDate: "2020-03-15" }),
        utc("2020-01-20"),
      ),
    ).toBe("2020-03-15");
  });

  it("anchors on the first due day STRICTLY after origination", () => {
    // Originated the 10th, due day 15 → first payment is the 15th of the
    // same month.
    expect(
      deriveNextPaymentDate(
        facts({
          originationDate: "2020-01-10",
          acquisitionDate: "2020-01-10",
          paymentDueDay: 15,
        }),
        utc("2020-01-11"),
      ),
    ).toBe("2020-01-15");
  });

  it("does not schedule a payment on the origination day itself", () => {
    // Signed the 15th with a due day of 15: nothing is owed at signing, so
    // the anchor rolls to the next month.
    expect(
      deriveNextPaymentDate(
        facts({
          originationDate: "2020-01-15",
          acquisitionDate: "2020-01-15",
          paymentDueDay: 15,
        }),
        utc("2020-01-15"),
      ),
    ).toBe("2020-02-15");
  });

  it("rolls the anchor to next month when the due day already passed at origination", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          originationDate: "2020-01-20",
          acquisitionDate: "2020-01-20",
          paymentDueDay: 5,
        }),
        utc("2020-01-21"),
      ),
    ).toBe("2020-02-05");
  });

  it("reports the basis for every date it does return", () => {
    // The discriminant is what lets a screen explain itself; assert each arm
    // is actually reachable.
    expect(
      nextPaymentVerdict(facts({ paidThroughDate: "2026-06-15" }), utc("2026-07-01")),
    ).toEqual({ date: "2026-07-15", basis: "paid_through" });
    expect(
      nextPaymentVerdict(facts({ firstPaymentDate: "2020-03-15" }), utc("2020-01-20")),
    ).toEqual({ date: "2020-03-15", basis: "first_payment" });
    expect(nextPaymentVerdict(facts(), utc("2020-01-11"))).toEqual({
      date: "2020-01-15",
      basis: "origination",
    });
  });
});

// ============================================================================
// The mid-life import — the case this module was built for
// ============================================================================

describe("deriveNextPaymentDate — mid-life acquired note", () => {
  const midLife = facts({
    originationDate: "2019-04-08",
    maturityDate: "2049-04-15",
    acquisitionDate: "2026-06-30",
    paymentDueDay: 15,
    paidThroughDate: "2026-06-15",
  });

  it("derives from paidThroughDate, not from the 2019 origination", () => {
    const next = deriveNextPaymentDate(midLife, utc("2026-07-01"));
    expect(next).toBe("2026-07-15");
    expect(next?.startsWith("2019")).toBe(false);
  });

  it("returns the very next period only — it invents no intervening history", () => {
    // Seven years of periods exist in the note's life. We assert exactly one
    // month of movement off paid-through: the module makes no claim about
    // periods it has no evidence for.
    const next = deriveNextPaymentDate(midLife, utc("2026-07-01"));
    const paidThrough = utc("2026-06-15");
    const nextDate = utc(next!);
    const monthsApart =
      (nextDate.getUTCFullYear() - paidThrough.getUTCFullYear()) * 12 +
      (nextDate.getUTCMonth() - paidThrough.getUTCMonth());
    expect(monthsApart).toBe(1);
  });

  it("handles a paid-through recorded a few days BEFORE that month's due date", () => {
    // Prior servicer exported "paid through 2026-06-01" on a 15th-due note.
    // The next unpaid period is that same month's 15th, not July's.
    expect(
      deriveNextPaymentDate(
        facts({ paymentDueDay: 15, paidThroughDate: "2026-06-01" }),
        utc("2026-07-01"),
      ),
    ).toBe("2026-06-15");
  });

  it("never manufactures a period earlier than the note's first one", () => {
    // A garbage import can put paid-through before the anchor; the answer
    // must still be the anchor, not a pre-origination date.
    expect(
      deriveNextPaymentDate(
        facts({
          originationDate: "2020-01-10",
          paymentDueDay: 15,
          paidThroughDate: "2019-05-15",
        }),
        utc("2020-02-01"),
      ),
    ).toBe("2020-01-15");
  });

  it("falls back to the anchor when nothing has ever been paid on paper WE originated-and-held", () => {
    // No hidden servicing history here: origination and acquisition are
    // contemporaneous, so "no payments recorded" really does mean no
    // payments. Either genuinely alarming or a data gap — both readings
    // require showing the date.
    expect(
      deriveNextPaymentDate(
        facts({
          originationDate: "2019-04-08",
          acquisitionDate: "2019-04-08",
          paymentDueDay: 15,
          paidThroughDate: null,
        }),
        utc("2026-07-30"),
      ),
    ).toBe("2019-04-15");
  });
});

// ============================================================================
// The anti-fabrication rule: a history AcreOS never saw is not one we assert
// ============================================================================

describe("deriveNextPaymentDate — history predates acquisition", () => {
  // A decade-old note bought last month, imported with no payment rows yet.
  const justImported = facts({
    originationDate: "2019-04-08",
    maturityDate: "2049-04-15",
    acquisitionDate: "2026-06-30",
    paymentDueDay: 15,
    firstPaymentDate: null,
    paidThroughDate: null,
  });

  it("returns no date, with a reason, rather than a 2019 due date", () => {
    expect(nextPaymentVerdict(justImported, utc("2026-07-30"))).toEqual({
      date: null,
      reason: "history_predates_acquisition",
    });
    expect(deriveNextPaymentDate(justImported, utc("2026-07-30"))).toBeNull();
  });

  it("does not substitute the acquisition date as an anchor", () => {
    // Anchoring on acquisition would assert the note was CURRENT when we
    // bought it — swapping one invented fact for another.
    const verdict = nextPaymentVerdict(justImported, utc("2026-07-30"));
    expect(verdict.date).toBeNull();
  });

  it("asserts NO delinquency and NO assessable late fee — the exact fabrication being prevented", () => {
    // Without the guard this note reads as ~2,600 days past due: every
    // surface badges the borrower `default_candidate` and the RESPA
    // §1024.39 early-intervention caller fires a federal obligation off a
    // date nobody verified, against someone who may have paid the prior
    // servicer perfectly every month.
    const nextPaymentDate = deriveNextPaymentDate(justImported, utc("2026-07-30"));
    expect(nextPaymentDate).toBeNull();

    expect(
      computeNoteDelinquency({
        nextPaymentDate,
        gracePeriodDays: 10,
        asOf: utc("2026-07-30"),
      }),
    ).toEqual({ daysDelinquent: 0, delinquencyStatus: "current" });

    const fee = lateFeeAssessable({
      nextPaymentDate,
      gracePeriodDays: 10,
      lateFeeCents: 5000,
      asOf: utc("2026-07-30"),
    });
    expect(fee.assessable).toBe(false);
    expect(fee.reason).toMatch(/no next payment date/i);
  });

  it("yields a real date once a paidThroughDate is imported", () => {
    // The guard is about missing evidence, not about old notes. Supply the
    // prior servicer's paid-through and the schedule resolves normally.
    expect(
      nextPaymentVerdict(
        { ...justImported, paidThroughDate: "2026-06-15" },
        utc("2026-07-30"),
      ),
    ).toEqual({ date: "2026-07-15", basis: "paid_through" });
  });

  it("yields a real date when the paperwork states a firstPaymentDate", () => {
    // A stated first payment is a fact off the instrument, not an inference
    // from origination, so the guard does not apply.
    expect(
      nextPaymentVerdict(
        { ...justImported, firstPaymentDate: "2019-05-15" },
        utc("2026-07-30"),
      ),
    ).toEqual({ date: "2019-05-15", basis: "first_payment" });
  });

  it("does NOT regress the seller-financed-at-close case", () => {
    // Originated and acquired in the same month: no hidden history exists,
    // so a real date must still come back.
    expect(
      nextPaymentVerdict(
        facts({
          originationDate: "2026-07-05",
          acquisitionDate: "2026-07-05",
          maturityDate: "2056-07-15",
          paymentDueDay: 15,
        }),
        utc("2026-07-30"),
      ),
    ).toEqual({ date: "2026-07-15", basis: "origination" });
  });

  it("tolerates exactly one period of settlement lag", () => {
    // Anchor 2026-07-15, acquired 2026-08-15 — one period. Settlement
    // timing, not a servicing history, so it still resolves.
    expect(
      nextPaymentVerdict(
        facts({
          originationDate: "2026-07-05",
          acquisitionDate: "2026-08-15",
          maturityDate: "2056-07-15",
          paymentDueDay: 15,
        }),
        utc("2026-09-01"),
      ),
    ).toEqual({ date: "2026-07-15", basis: "origination" });

    // One day past that tolerance and we refuse: a period went by under
    // someone else's servicing.
    expect(
      nextPaymentVerdict(
        facts({
          originationDate: "2026-07-05",
          acquisitionDate: "2026-08-16",
          maturityDate: "2056-07-15",
          paymentDueDay: 15,
        }),
        utc("2026-09-01"),
      ),
    ).toEqual({ date: null, reason: "history_predates_acquisition" });
  });
});

// ============================================================================
// Past-due dates are NOT rolled forward (the notes.tsx defect)
// ============================================================================

describe("deriveNextPaymentDate — overdue notes", () => {
  it("returns the PAST date for a note six months behind", () => {
    // notes.tsx would render the upcoming 15th here, making this note look
    // identical to a current one. The truth is January.
    const next = deriveNextPaymentDate(
      facts({ paymentDueDay: 15, paidThroughDate: "2025-12-15" }),
      utc("2026-07-30"),
    );
    expect(next).toBe("2026-01-15");
    expect(utc(next!).getTime()).toBeLessThan(utc("2026-07-30").getTime());
  });

  it("gives the same answer regardless of how far past asOf has moved", () => {
    // asOf must not shift the contractual due date — only the delinquency
    // count derived from it.
    const f = facts({ paymentDueDay: 15, paidThroughDate: "2025-12-15" });
    expect(deriveNextPaymentDate(f, utc("2026-01-16"))).toBe("2026-01-15");
    expect(deriveNextPaymentDate(f, utc("2026-07-30"))).toBe("2026-01-15");
    expect(deriveNextPaymentDate(f, utc("2027-07-30"))).toBe("2026-01-15");
  });
});

// ============================================================================
// Month clamping
// ============================================================================

describe("deriveNextPaymentDate — short-month clamping", () => {
  it("clamps due day 31 to Feb 28 in a non-leap year", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 31,
          originationDate: "2020-01-05",
          paidThroughDate: "2025-01-31",
        }),
        utc("2025-02-10"),
      ),
    ).toBe("2025-02-28");
  });

  it("clamps due day 31 to Feb 29 in a leap year", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 31,
          originationDate: "2020-01-05",
          paidThroughDate: "2024-01-31",
        }),
        utc("2024-02-10"),
      ),
    ).toBe("2024-02-29");
  });

  it("clamps due day 30 in February, leap and non-leap", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 30,
          originationDate: "2020-01-05",
          paidThroughDate: "2025-01-30",
        }),
        utc("2025-02-10"),
      ),
    ).toBe("2025-02-28");
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 30,
          originationDate: "2020-01-05",
          paidThroughDate: "2024-01-30",
        }),
        utc("2024-02-10"),
      ),
    ).toBe("2024-02-29");
  });

  it("clamps due day 29 in a non-leap February but not a leap one", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 29,
          originationDate: "2020-01-05",
          paidThroughDate: "2025-01-29",
        }),
        utc("2025-02-10"),
      ),
    ).toBe("2025-02-28");
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 29,
          originationDate: "2020-01-05",
          paidThroughDate: "2024-01-29",
        }),
        utc("2024-02-10"),
      ),
    ).toBe("2024-02-29");
  });

  it("recovers the full due day the month AFTER a clamped one", () => {
    // The clamp is per-month, not sticky: a 31st note clamped to Feb 28 is
    // due March 31, not March 28.
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 31,
          originationDate: "2020-01-05",
          paidThroughDate: "2025-02-28",
        }),
        utc("2025-03-01"),
      ),
    ).toBe("2025-03-31");
  });

  it("clamps a 31st note across a 30-day month", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 31,
          originationDate: "2020-01-05",
          paidThroughDate: "2025-03-31",
        }),
        utc("2025-04-05"),
      ),
    ).toBe("2025-04-30");
  });
});

// ============================================================================
// Maturity
// ============================================================================

describe("deriveNextPaymentDate — maturity", () => {
  it("returns null when the note is paid through maturity", () => {
    const paidOff = facts({
      paymentDueDay: 15,
      maturityDate: "2026-06-15",
      paidThroughDate: "2026-06-15",
    });
    expect(deriveNextPaymentDate(paidOff, utc("2026-07-01"))).toBeNull();
    // Distinct from the other two blanks — this one means "nothing more is
    // due on the monthly schedule", not "we don't know".
    expect(nextPaymentVerdict(paidOff, utc("2026-07-01"))).toEqual({
      date: null,
      reason: "paid_through_maturity",
    });
  });

  it("returns null when the next period would fall past maturity", () => {
    // What's owed after the last monthly period is a balloon/payoff figure,
    // computed on a different surface. Emitting a 361st monthly due date on
    // a 360-month note would be an invented obligation.
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 15,
          maturityDate: "2026-06-15",
          paidThroughDate: "2026-05-15",
        }),
        utc("2026-07-01"),
      ),
    ).toBe("2026-06-15");
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 15,
          maturityDate: "2026-06-20",
          paidThroughDate: "2026-06-20",
        }),
        utc("2026-07-01"),
      ),
    ).toBeNull();
  });

  it("returns the final period when it lands exactly on maturity", () => {
    expect(
      deriveNextPaymentDate(
        facts({
          paymentDueDay: 15,
          maturityDate: "2026-07-15",
          paidThroughDate: "2026-06-15",
        }),
        utc("2026-07-01"),
      ),
    ).toBe("2026-07-15");
  });
});

// ============================================================================
// Incoherent facts → null, never a throw, never a guess
// ============================================================================

describe("deriveNextPaymentDate — incoherent facts return null", () => {
  it("rejects a paymentDueDay below 1", () => {
    expect(deriveNextPaymentDate(facts({ paymentDueDay: 0 }), utc("2026-07-01"))).toBeNull();
  });

  it("rejects a paymentDueDay above 31", () => {
    expect(deriveNextPaymentDate(facts({ paymentDueDay: 32 }), utc("2026-07-01"))).toBeNull();
  });

  it("rejects a non-integer paymentDueDay", () => {
    expect(deriveNextPaymentDate(facts({ paymentDueDay: 15.5 }), utc("2026-07-01"))).toBeNull();
    expect(
      deriveNextPaymentDate(
        facts({ paymentDueDay: Number.NaN }),
        utc("2026-07-01"),
      ),
    ).toBeNull();
  });

  it("rejects unparseable dates rather than letting JS roll them over", () => {
    expect(
      deriveNextPaymentDate(facts({ originationDate: "not-a-date" }), utc("2026-07-01")),
    ).toBeNull();
    expect(
      deriveNextPaymentDate(facts({ maturityDate: "2050/01/15" }), utc("2026-07-01")),
    ).toBeNull();
    // 2025-02-30 would silently become March 2nd via Date.UTC. Refuse it.
    expect(
      deriveNextPaymentDate(facts({ originationDate: "2025-02-30" }), utc("2026-07-01")),
    ).toBeNull();
    expect(
      deriveNextPaymentDate(facts({ originationDate: "2020-13-01" }), utc("2026-07-01")),
    ).toBeNull();
  });

  it("rejects a maturity before origination", () => {
    expect(
      deriveNextPaymentDate(
        facts({ originationDate: "2030-01-10", maturityDate: "2020-01-10" }),
        utc("2026-07-01"),
      ),
    ).toBeNull();
  });

  it("rejects a present-but-malformed firstPaymentDate", () => {
    // Falling back to the origination-derived anchor here would silently use
    // a different schedule than the note's paperwork specifies.
    expect(
      deriveNextPaymentDate(facts({ firstPaymentDate: "03/15/2020" }), utc("2026-07-01")),
    ).toBeNull();
  });

  it("rejects a present-but-malformed paidThroughDate", () => {
    // The dangerous direction: ignoring it would fall back to the anchor and
    // report a current note as years past due.
    expect(
      deriveNextPaymentDate(facts({ paidThroughDate: "2026-06-31" }), utc("2026-07-01")),
    ).toBeNull();
  });

  it("rejects an unparseable acquisitionDate", () => {
    // The acquisition guard cannot run without it, and running the
    // origination inference with the guard disabled is precisely the
    // fabrication path. Refuse instead.
    expect(
      deriveNextPaymentDate(facts({ acquisitionDate: "06/30/2026" }), utc("2026-07-01")),
    ).toBeNull();
    expect(
      deriveNextPaymentDate(facts({ acquisitionDate: "2026-02-30" }), utc("2026-07-01")),
    ).toBeNull();
  });

  it("rejects an invalid asOf", () => {
    expect(deriveNextPaymentDate(facts(), new Date("nonsense"))).toBeNull();
  });

  it("reports incoherent_facts as the reason, distinguishable from the other blanks", () => {
    expect(
      nextPaymentVerdict(facts({ paymentDueDay: 0 }), utc("2026-07-01")),
    ).toEqual({ date: null, reason: "incoherent_facts" });
    expect(nextPaymentVerdict(facts(), new Date("nonsense"))).toEqual({
      date: null,
      reason: "incoherent_facts",
    });
  });
});

// ============================================================================
// advancePaidThrough
// ============================================================================

describe("advancePaidThrough", () => {
  it("advances one monthly period from an existing paid-through", () => {
    expect(
      advancePaidThrough(facts({ paymentDueDay: 15, paidThroughDate: "2026-06-15" }), 1),
    ).toBe("2026-07-15");
  });

  it("advances several periods at once", () => {
    expect(
      advancePaidThrough(facts({ paymentDueDay: 15, paidThroughDate: "2026-01-15" }), 6),
    ).toBe("2026-07-15");
  });

  it("lands on the anchor when the first period is satisfied from nothing", () => {
    expect(
      advancePaidThrough(
        facts({ originationDate: "2020-01-10", paymentDueDay: 15, paidThroughDate: null }),
        1,
      ),
    ).toBe("2020-01-15");
  });

  it("returns the unchanged paid-through for zero periods", () => {
    expect(
      advancePaidThrough(facts({ paidThroughDate: "2026-06-15" }), 0),
    ).toBe("2026-06-15");
    // Nothing paid and nothing satisfied is not a date.
    expect(advancePaidThrough(facts({ paidThroughDate: null }), 0)).toBeNull();
  });

  it("clamps into short months as it advances", () => {
    expect(
      advancePaidThrough(
        facts({ paymentDueDay: 31, originationDate: "2020-01-05", paidThroughDate: "2025-01-31" }),
        1,
      ),
    ).toBe("2025-02-28");
  });

  it("caps at maturity so paid-through never drifts past the note's life", () => {
    expect(
      advancePaidThrough(
        facts({
          paymentDueDay: 15,
          maturityDate: "2026-08-15",
          paidThroughDate: "2026-07-15",
        }),
        12,
      ),
    ).toBe("2026-08-15");
  });

  it("makes deriveNextPaymentDate return null once it reaches maturity", () => {
    const f = facts({
      paymentDueDay: 15,
      maturityDate: "2026-08-15",
      paidThroughDate: "2026-07-15",
    });
    const advanced = advancePaidThrough(f, 1);
    expect(advanced).toBe("2026-08-15");
    expect(
      deriveNextPaymentDate({ ...f, paidThroughDate: advanced }, utc("2026-09-01")),
    ).toBeNull();
  });

  it("returns null for negative or fractional periods", () => {
    expect(advancePaidThrough(facts({ paidThroughDate: "2026-06-15" }), -1)).toBeNull();
    expect(advancePaidThrough(facts({ paidThroughDate: "2026-06-15" }), 1.5)).toBeNull();
  });

  it("returns null for incoherent facts", () => {
    expect(advancePaidThrough(facts({ paymentDueDay: 0 }), 1)).toBeNull();
    expect(advancePaidThrough(facts({ maturityDate: "bogus" }), 1)).toBeNull();
  });
});

// ============================================================================
// computeNoteDelinquency — band boundaries
// ============================================================================

describe("computeNoteDelinquency — boundaries with no grace", () => {
  const due = "2026-07-01";
  const at = (isoAsOf: string) =>
    computeNoteDelinquency({
      nextPaymentDate: due,
      gracePeriodDays: 0,
      asOf: utc(isoAsOf),
    });

  it("is current on the due date itself (day 0)", () => {
    expect(at("2026-07-01")).toEqual({
      daysDelinquent: 0,
      delinquencyStatus: "current",
    });
  });

  it("is current BEFORE the due date (negative days floor to 0)", () => {
    expect(at("2026-06-20")).toEqual({
      daysDelinquent: 0,
      delinquencyStatus: "current",
    });
  });

  it("enters early_delinquent at day 1 and holds through day 5", () => {
    expect(at("2026-07-02")).toEqual({
      daysDelinquent: 1,
      delinquencyStatus: "early_delinquent",
    });
    expect(at("2026-07-06")).toEqual({
      daysDelinquent: 5,
      delinquencyStatus: "early_delinquent",
    });
  });

  it("enters delinquent at day 6 and holds through day 15", () => {
    expect(at("2026-07-07")).toEqual({
      daysDelinquent: 6,
      delinquencyStatus: "delinquent",
    });
    expect(at("2026-07-16")).toEqual({
      daysDelinquent: 15,
      delinquencyStatus: "delinquent",
    });
  });

  it("enters seriously_delinquent at day 16 and holds through day 30", () => {
    expect(at("2026-07-17")).toEqual({
      daysDelinquent: 16,
      delinquencyStatus: "seriously_delinquent",
    });
    expect(at("2026-07-31")).toEqual({
      daysDelinquent: 30,
      delinquencyStatus: "seriously_delinquent",
    });
  });

  it("enters default_candidate at day 31 and stays there", () => {
    expect(at("2026-08-01")).toEqual({
      daysDelinquent: 31,
      delinquencyStatus: "default_candidate",
    });
    expect(at("2026-12-01")).toMatchObject({
      delinquencyStatus: "default_candidate",
    });
  });
});

describe("computeNoteDelinquency — grace offset", () => {
  it("shifts every boundary by the grace period", () => {
    // A 10-day grace means the delinquency clock starts on the 11th, not the
    // 2nd. Badging a borrower delinquent inside their own contractual grace
    // would trigger collection outreach the note does not authorize.
    const withGrace = (isoAsOf: string) =>
      computeNoteDelinquency({
        nextPaymentDate: "2026-07-01",
        gracePeriodDays: 10,
        asOf: utc(isoAsOf),
      });

    expect(withGrace("2026-07-05")).toEqual({
      daysDelinquent: 0,
      delinquencyStatus: "current",
    });
    expect(withGrace("2026-07-11")).toEqual({
      daysDelinquent: 0,
      delinquencyStatus: "current",
    });
    expect(withGrace("2026-07-12")).toEqual({
      daysDelinquent: 1,
      delinquencyStatus: "early_delinquent",
    });
    expect(withGrace("2026-07-16")).toEqual({
      daysDelinquent: 5,
      delinquencyStatus: "early_delinquent",
    });
    expect(withGrace("2026-07-17")).toEqual({
      daysDelinquent: 6,
      delinquencyStatus: "delinquent",
    });
    expect(withGrace("2026-08-11")).toEqual({
      daysDelinquent: 31,
      delinquencyStatus: "default_candidate",
    });
  });

  it("treats a negative or non-finite grace as zero grace", () => {
    expect(
      computeNoteDelinquency({
        nextPaymentDate: "2026-07-01",
        gracePeriodDays: -5,
        asOf: utc("2026-07-02"),
      }),
    ).toEqual({ daysDelinquent: 1, delinquencyStatus: "early_delinquent" });
    expect(
      computeNoteDelinquency({
        nextPaymentDate: "2026-07-01",
        gracePeriodDays: Number.NaN,
        asOf: utc("2026-07-02"),
      }),
    ).toEqual({ daysDelinquent: 1, delinquencyStatus: "early_delinquent" });
  });

  it("floors partial days rather than rounding up", () => {
    // 12 hours past the deadline is not a day past due; rounding up would
    // start a collection ladder half a day early.
    expect(
      computeNoteDelinquency({
        nextPaymentDate: "2026-07-01",
        gracePeriodDays: 0,
        asOf: new Date("2026-07-02T12:00:00.000Z"),
      }),
    ).toEqual({ daysDelinquent: 1, delinquencyStatus: "early_delinquent" });
  });

  it("reports a neutral current/0 when no due date is known", () => {
    // Neutral default, NOT a claim of currency — callers branch on the null
    // date and render a blank.
    expect(
      computeNoteDelinquency({
        nextPaymentDate: null,
        gracePeriodDays: 10,
        asOf: utc("2026-07-30"),
      }),
    ).toEqual({ daysDelinquent: 0, delinquencyStatus: "current" });
    expect(
      computeNoteDelinquency({
        nextPaymentDate: "garbage",
        gracePeriodDays: 10,
        asOf: utc("2026-07-30"),
      }),
    ).toEqual({ daysDelinquent: 0, delinquencyStatus: "current" });
  });
});

// ============================================================================
// lateFeeAssessable — advisory only
// ============================================================================

describe("lateFeeAssessable", () => {
  it("is false with an explanatory reason when no late fee is configured", () => {
    const result = lateFeeAssessable({
      nextPaymentDate: "2026-01-15",
      gracePeriodDays: 10,
      lateFeeCents: 0,
      asOf: utc("2026-07-30"),
    });
    expect(result.assessable).toBe(false);
    expect(result.reason).toMatch(/no late fee is configured/i);
    expect(result.reason).toContain("0");
  });

  it("is false when no due date could be derived", () => {
    const result = lateFeeAssessable({
      nextPaymentDate: null,
      gracePeriodDays: 10,
      lateFeeCents: 5000,
      asOf: utc("2026-07-30"),
    });
    expect(result.assessable).toBe(false);
    expect(result.reason).toMatch(/no next payment date/i);
  });

  it("is false inside the grace period, naming the grace length", () => {
    const result = lateFeeAssessable({
      nextPaymentDate: "2026-07-25",
      gracePeriodDays: 10,
      lateFeeCents: 5000,
      asOf: utc("2026-07-30"),
    });
    expect(result.assessable).toBe(false);
    expect(result.reason).toMatch(/grace period/i);
    expect(result.reason).toContain("10");
  });

  it("is true past the grace period, and says nothing was assessed", () => {
    const result = lateFeeAssessable({
      nextPaymentDate: "2026-07-01",
      gracePeriodDays: 10,
      lateFeeCents: 5000,
      asOf: utc("2026-07-30"),
    });
    expect(result.assessable).toBe(true);
    // Advisory only — the string must not imply a fee was charged, and the
    // real assessment still runs through lateFees/index.ts.
    expect(result.reason).toMatch(/nothing has been assessed/i);
  });

  it("prefers the no-fee-configured reason over the delinquency reason", () => {
    // A wildly delinquent note with no configured fee must not show
    // "assessable" language for an amount that does not exist.
    const result = lateFeeAssessable({
      nextPaymentDate: "2020-01-15",
      gracePeriodDays: 0,
      lateFeeCents: 0,
      asOf: utc("2026-07-30"),
    });
    expect(result.assessable).toBe(false);
    expect(result.reason).toMatch(/no late fee is configured/i);
  });
});

// ============================================================================
// Drift guard: the two books must agree on what "delinquent" means
// ============================================================================

describe("NOTE_DELINQUENCY_THRESHOLDS", () => {
  it("matches DELINQUENCY_THRESHOLDS in financeAgent.ts, verbatim", () => {
    // We cannot import financeAgent (it pulls in storage + the OpenAI client
    // + the mail rails, which would make this module impure), so we read it
    // as text. Without this test the originated-note book and the
    // acquired-note book could silently drift and give the founder two
    // different answers to "is this borrower delinquent?".
    const source = readFileSync(
      fileURLToPath(new URL("../financeAgent.ts", import.meta.url)),
      "utf8",
    );

    const block = /const DELINQUENCY_THRESHOLDS\s*=\s*\{([\s\S]*?)\n\};/.exec(source);
    expect(block, "DELINQUENCY_THRESHOLDS block not found in financeAgent.ts").not.toBeNull();

    const parsePair = (key: string): { min: number; max: number } => {
      const m = new RegExp(
        `${key}:\\s*\\{\\s*min:\\s*(-?\\d+),\\s*max:\\s*(Infinity|-?\\d+)\\s*\\}`,
      ).exec(block![1]);
      expect(m, `threshold "${key}" not found in financeAgent.ts`).not.toBeNull();
      return {
        min: Number(m![1]),
        max: m![2] === "Infinity" ? Infinity : Number(m![2]),
      };
    };

    expect(parsePair("earlyDelinquent")).toEqual(NOTE_DELINQUENCY_THRESHOLDS.earlyDelinquent);
    expect(parsePair("delinquent")).toEqual(NOTE_DELINQUENCY_THRESHOLDS.delinquent);
    expect(parsePair("seriouslyDelinquent")).toEqual(
      NOTE_DELINQUENCY_THRESHOLDS.seriouslyDelinquent,
    );
    expect(parsePair("defaultCandidate")).toEqual(NOTE_DELINQUENCY_THRESHOLDS.defaultCandidate);
  });

  it("declares the same status vocabulary as financeAgent's DelinquencyStatus", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../financeAgent.ts", import.meta.url)),
      "utf8",
    );
    const union = /export type DelinquencyStatus\s*=([\s\S]*?);/.exec(source);
    expect(union).not.toBeNull();
    const members = (union![1].match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, ""));
    expect(members.sort()).toEqual(
      [
        "current",
        "early_delinquent",
        "delinquent",
        "seriously_delinquent",
        "default_candidate",
      ].sort(),
    );
  });
});
