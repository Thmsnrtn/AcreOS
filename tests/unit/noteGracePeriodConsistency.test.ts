/**
 * The servicing engine and the signed note must state the same term.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Three call sites read `acquired_notes.grace_period_days`:
 *
 *   server/jobs/acquiredNoteAging.ts   `note.gracePeriodDays ?? 0`
 *   server/services/documents.ts       `note.gracePeriodDays || 10`
 *   server/routes-documents.ts         `note.gracePeriodDays || 10`
 *
 * So for a note whose record does not state a grace period, AcreOS measured
 * delinquency against ZERO days while the promissory note it generated — the
 * document with a SIGNATURES block — promised TEN. A borrower could be marked
 * late by the engine inside a window the instrument grants them.
 *
 * And `||` fires on `0`. A note whose record explicitly grants NO grace period
 * produced a legal instrument asserting ten days: not a default filling a gap,
 * a document contradicting the record it was generated from.
 *
 * ── WHAT IS GATED ───────────────────────────────────────────────────────────
 * 1. `noteGracePeriodDays` distinguishes an explicit 0 from an absent term —
 *    the distinction `||` destroyed, asserted directly and as a property over
 *    the whole input domain.
 * 2. No document may print a grace period the record does not state, and none
 *    may contradict an explicit 0.
 * 3. The aging engine reports whether the term was stated, so its zero
 *    assumption is visible rather than silent.
 * 4. All three sites consume the SAME resolver — the second law: a canonical
 *    function with no production adoption is not canonical, and this one
 *    exists precisely because three copies disagreed.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { noteGracePeriodDays } from "../../shared/notes/delinquency";
import { planNoteAging, type AgingNoteRow } from "../../server/jobs/acquiredNoteAging";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

function source(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("noteGracePeriodDays — an explicit zero is a term", () => {
  it("returns 0 for an explicit 0, not null and not a substitute", () => {
    // THE case `|| 10` destroyed.
    expect(noteGracePeriodDays(0)).toBe(0);
  });

  it("returns null only when the record states nothing usable", () => {
    expect(noteGracePeriodDays(null)).toBeNull();
    expect(noteGracePeriodDays(undefined)).toBeNull();
    expect(noteGracePeriodDays(Number.NaN)).toBeNull();
    expect(noteGracePeriodDays(Number.POSITIVE_INFINITY)).toBeNull();
    expect(noteGracePeriodDays(-5)).toBeNull();
  });

  it("passes real terms through, floored", () => {
    expect(noteGracePeriodDays(10)).toBe(10);
    expect(noteGracePeriodDays(1)).toBe(1);
    expect(noteGracePeriodDays(15.9)).toBe(15);
  });

  it("never invents a number: every non-null answer came from the input", () => {
    // Property over the domain, so a substitution cannot hide in one branch.
    for (const v of [0, 1, 3, 7, 10, 15, 30, 45, 90]) {
      expect(noteGracePeriodDays(v)).toBe(v);
    }
    for (const v of [null, undefined, Number.NaN, -1, -10]) {
      expect(noteGracePeriodDays(v as number | null)).toBeNull();
    }
  });
});

describe("no document may state a term the record does not carry", () => {
  const DOC_SITES = ["server/services/documents.ts", "server/routes-documents.ts"];

  it("neither document site defaults the grace period to a literal", () => {
    for (const rel of DOC_SITES) {
      const src = source(rel);
      expect(src.length, `${rel} stripped to nothing`).toBeGreaterThan(1000);
      // The exact expression, and any equivalent: no numeric fallback at all.
      expect(
        src,
        `${rel} still substitutes a literal for the note's grace period`,
      ).not.toMatch(/gracePeriodDays\s*(\|\||\?\?)\s*-?\d/);
    }
  });

  it("both document sites consume the canonical resolver", () => {
    // A canonical function with no production adoption is not canonical. This
    // one exists because three call sites disagreed; all three must consume it
    // or the disagreement can simply come back.
    for (const rel of [...DOC_SITES, "server/jobs/acquiredNoteAging.ts"]) {
      const src = source(rel);
      expect(src, `${rel} does not call noteGracePeriodDays`).toMatch(
        /noteGracePeriodDays\(/,
      );
    }
  });

  it("the promissory note's late-charge clause refuses an unstated term", () => {
    const src = source("server/routes-documents.ts");
    // The clause must have a branch that says so, and must not reach for 10.
    expect(src).toMatch(/does not state a grace period/);
    expect(src).not.toMatch(/within \$\{note\.gracePeriodDays/);
    // And an explicit 0 must produce "on its due date", not "within 0 days".
    expect(src).toMatch(/not received on its due date/);
  });
});

describe("the aging sweep reports its own assumption", () => {
  /**
   * A COMPLETE row. The first draft omitted paymentDueDay / originationDate /
   * maturityDate, so `planNoteAging` returned "note is missing schedule facts"
   * and every aging assertion below passed over a skipped note — two of them
   * vacuously, asserting that 0 equals 0. The `daysDelinquent` assertion at the
   * bottom is what exposed it, which is the argument for keeping at least one
   * test in a file that demands the values DIFFER.
   */
  // Fully typed, with NO cast. The first draft ended `} as AgingNoteRow`,
  // which `check-tests-typecheck` correctly flagged as a new offender — and
  // that gate's rationale is exactly the hazard here: a cast lets a fixture
  // omit a field, or misspell one, and the test asserts on something that does
  // not exist and passes forever. `id` is a string on this row, not a number,
  // which is precisely what the cast was papering over.
  const base: AgingNoteRow = {
    id: "note-1",
    organizationId: 9,
    noteNumber: "N-0001",
    status: "current",
    paymentDueDay: 1,
    originationDate: "2026-01-01",
    maturityDate: "2031-01-01",
    acquisitionDate: "2026-01-01",
    firstPaymentDate: "2026-02-01",
    paidThroughDate: "2026-07-01",
    nextPaymentDate: "2026-08-01",
    gracePeriodDays: null,
    lateFeeCents: 5000,
    daysDelinquent: null,
    delinquencyStatus: null,
  };

  it("vacuity guard: the fixture is aged, not skipped", () => {
    const plan = planNoteAging(base, new Date("2026-08-20T00:00:00Z"));
    expect(
      plan.skipReason,
      "the fixture is being skipped, so every assertion below is vacuous",
    ).toBeNull();
    expect(plan.daysDelinquent, "the fixture is not actually delinquent").toBeGreaterThan(0);
  });

  it("flags a note whose record states no grace period", () => {
    const plan = planNoteAging({ ...base, gracePeriodDays: null }, new Date("2026-08-20T00:00:00Z"));
    expect(plan.graceStated).toBe(false);
  });

  it("does NOT flag a note that explicitly states zero", () => {
    // The distinction the whole change is about: 0 is a stated term.
    const plan = planNoteAging({ ...base, gracePeriodDays: 0 }, new Date("2026-08-20T00:00:00Z"));
    expect(plan.graceStated).toBe(true);
  });

  it("does not flag a note with a real term", () => {
    const plan = planNoteAging({ ...base, gracePeriodDays: 10 }, new Date("2026-08-20T00:00:00Z"));
    expect(plan.graceStated).toBe(true);
  });

  it("an explicit 0 and an unstated term behave IDENTICALLY here — only the paperwork differs", () => {
    // Both measure against zero grace days, deliberately. The documents are
    // where they diverge, and that divergence is the point: an internal aging
    // signal can be re-derived, a signed instrument cannot.
    const asOf = new Date("2026-08-20T00:00:00Z");
    const zero = planNoteAging({ ...base, gracePeriodDays: 0 }, asOf);
    const unstated = planNoteAging({ ...base, gracePeriodDays: null }, asOf);
    expect(unstated.daysDelinquent).toBe(zero.daysDelinquent);
    expect(unstated.delinquencyStatus).toBe(zero.delinquencyStatus);
    expect(unstated.lateFeeAdvisory).toEqual(zero.lateFeeAdvisory);
    // …and only `graceStated` tells them apart.
    expect(unstated.graceStated).not.toBe(zero.graceStated);
  });

  /**
   * Grace governs FEES, not the delinquency day count — `computeNoteDelinquency`
   * accepts the parameter and documents that it ignores it deliberately. The
   * first draft of this file asserted on `daysDelinquent` and failed for that
   * reason, which was the test being wrong rather than the code: the assertion
   * belongs on `lateFeeAdvisory`, the one output grace actually moves.
   */
  it("the grace period changes the LATE FEE advisory, which is where it is load-bearing", () => {
    const asOf = new Date("2026-08-20T00:00:00Z"); // 19 days past due
    const wideGrace = planNoteAging({ ...base, gracePeriodDays: 30 }, asOf);
    const unstated = planNoteAging({ ...base, gracePeriodDays: null }, asOf);

    expect(
      wideGrace.lateFeeAdvisory?.assessable,
      "a 30-day grace period on a 19-day-late note must not make a fee assessable",
    ).toBe(false);
    expect(
      unstated.lateFeeAdvisory?.assessable,
      "with no stated grace the sweep assumes zero, so the fee IS assessable — " +
        "which is exactly the assumption `graceStated` exists to surface",
    ).toBe(true);
    // If the resolver collapsed every input to one value, these would match.
    expect(wideGrace.lateFeeAdvisory).not.toEqual(unstated.lateFeeAdvisory);
  });
});
