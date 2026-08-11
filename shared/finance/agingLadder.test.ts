/**
 * THE EXIT TEST for the shared aging ladder.
 *
 * Four things this suite exists to make impossible:
 *
 *   1. A boundary edit that quietly re-shapes the board. Every edge is pinned
 *      on BOTH sides, and the edge list is DERIVED from `AGING_LADDER_BUCKETS`
 *      rather than retyped — so adding, removing or moving a rung is a red
 *      suite, not a silent change of meaning.
 *   2. A row going missing. Conservation is asserted as an identity over the
 *      fixture and over a swept range of ages.
 *   3. "No due date" being read as "current". That is the single fabrication
 *      this engine was built to refuse.
 *   4. A bucket total that silently omits rows whose amount is unknown.
 *
 * Plus a DERIVED cross-book check: both books must import their boundaries
 * from this module. The check reads the two route files as TEXT and fails if
 * either grows its own copy of 30/60/90 — the "third copy" this whole slice
 * exists to prevent.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AGING_LADDER_BUCKETS,
  NOT_AGED_ID,
  bucketAging,
  bucketForDaysPastDue,
  conservationHolds,
  isCalendarDate,
  scheduleWindowDue,
  type AgeableRow,
  type AgingBucketId,
} from "./agingLadder";

const AS_OF = "2026-08-11";

/** 'YYYY-MM-DD' exactly `days` before AS_OF. */
function dueDaysAgo(days: number): string {
  const at = new Date(Date.UTC(2026, 7, 11));
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((r) => r.id).sort();
}

function bucket(ladder: ReturnType<typeof bucketAging>, id: AgingBucketId) {
  const found = ladder.buckets.find((b) => b.id === id);
  if (!found) throw new Error(`no bucket ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// The fixture ledger — charges at KNOWN ages
// ---------------------------------------------------------------------------

const FIXTURE: AgeableRow[] = [
  // current: due in the future, and due exactly today (day 0 is NOT past due)
  { id: "future", dueDate: dueDaysAgo(-14), outstandingCents: 100_00 },
  { id: "today", dueDate: dueDaysAgo(0), outstandingCents: 250_00 },
  // 1-30
  { id: "d1", dueDate: dueDaysAgo(1), outstandingCents: 40_00 },
  { id: "d30", dueDate: dueDaysAgo(30), outstandingCents: 60_00 },
  // 31-60
  { id: "d31", dueDate: dueDaysAgo(31), outstandingCents: 125_50 },
  { id: "d60", dueDate: dueDaysAgo(60), outstandingCents: 74_50 },
  // 61-90
  { id: "d61", dueDate: dueDaysAgo(61), outstandingCents: 300_00 },
  { id: "d90", dueDate: dueDaysAgo(90), outstandingCents: 200_00 },
  // 90+
  { id: "d91", dueDate: dueDaysAgo(91), outstandingCents: 1_000_00 },
  { id: "d400", dueDate: dueDaysAgo(400), outstandingCents: 500_00 },
  // not aged — the refusal case
  { id: "noDue", dueDate: null, outstandingCents: 999_00, reason: "No schedule on file for this note." },
  // aged, but the amount is unknown: bucket membership yes, bucket total no
  { id: "d45unknown", dueDate: dueDaysAgo(45), outstandingCents: null, reason: "Paid-through date not recorded." },
  // excluded — reported, never silently dropped
  {
    id: "disputed",
    dueDate: dueDaysAgo(75),
    outstandingCents: 88_00,
    excludedCode: "disputed",
    excludedReason: "Balance disputed by the payer; held out of the board until resolved.",
  },
];

describe("aging ladder — fixture membership and totals", () => {
  const ladder = bucketAging({ asOf: AS_OF, rows: FIXTURE });

  it("places every fixture row in exactly the expected bucket", () => {
    expect(ids(bucket(ladder, "current").rows)).toEqual(["future", "today"]);
    expect(ids(bucket(ladder, "d1_30").rows)).toEqual(["d1", "d30"]);
    expect(ids(bucket(ladder, "d31_60").rows)).toEqual(["d31", "d45unknown", "d60"]);
    expect(ids(bucket(ladder, "d61_90").rows)).toEqual(["d61", "d90"]);
    expect(ids(bucket(ladder, "d90_plus").rows)).toEqual(["d400", "d91"]);
    expect(ids(ladder.notAged.rows)).toEqual(["noDue"]);
    expect(ids(ladder.excluded.rows)).toEqual(["disputed"]);
  });

  it("totals each bucket to the exact sum of its own rows", () => {
    expect(bucket(ladder, "current").totalCents).toBe(100_00 + 250_00);
    expect(bucket(ladder, "d1_30").totalCents).toBe(40_00 + 60_00);
    // d45unknown contributes NOTHING — its amount is not known.
    expect(bucket(ladder, "d31_60").totalCents).toBe(125_50 + 74_50);
    expect(bucket(ladder, "d61_90").totalCents).toBe(300_00 + 200_00);
    expect(bucket(ladder, "d90_plus").totalCents).toBe(1_000_00 + 500_00);

    for (const b of ladder.buckets) {
      const sumOfRows = b.rows.reduce((s, r) => s + (r.outstandingCents ?? 0), 0);
      expect(b.totalCents).toBe(sumOfRows);
      expect(b.count).toBe(b.rows.length);
    }
  });

  it("sorts each bucket oldest-first so the worst row is at the top", () => {
    for (const b of ladder.buckets) {
      const days = b.rows.map((r) => r.daysPastDue);
      expect([...days].sort((a, z) => z - a)).toEqual(days);
    }
  });

  it("conserves: the sum of the buckets equals the sum of the rows", () => {
    expect(conservationHolds(ladder, FIXTURE)).toBe(true);

    const placed =
      ladder.buckets.reduce((s, b) => s + b.count, 0) +
      ladder.notAged.count +
      ladder.excluded.count;
    expect(placed).toBe(FIXTURE.length);
    expect(ladder.rowCount).toBe(FIXTURE.length);

    const knownInput = FIXTURE.reduce((s, r) => s + (r.outstandingCents ?? 0), 0);
    expect(ladder.grandTotalCents).toBe(knownInput);
    expect(ladder.agedTotalCents + ladder.notAged.totalCents + ladder.excluded.totalCents).toBe(
      ladder.grandTotalCents,
    );
  });
});

describe("refusal: a charge with no due date is NOT AGED, never current", () => {
  it("lands in not_aged and is absent from every ladder rung", () => {
    const ladder = bucketAging({
      asOf: AS_OF,
      rows: [{ id: "orphan", dueDate: null, outstandingCents: 500_00 }],
    });

    expect(ladder.notAged.count).toBe(1);
    expect(ladder.notAged.rows[0]).toMatchObject({ id: "orphan", code: "no_due_date" });

    // The load-bearing negative: NOT in current, and not anywhere else either.
    expect(bucket(ladder, "current").rows).toHaveLength(0);
    expect(bucket(ladder, "current").totalCents).toBe(0);
    for (const b of ladder.buckets) {
      expect(b.rows.map((r) => r.id)).not.toContain("orphan");
    }
    expect(ladder.agedTotalCents).toBe(0);
    // ...and its money is still accounted for.
    expect(ladder.grandTotalCents).toBe(500_00);
  });

  it("treats an unparseable due date as not-aged with its own code", () => {
    const ladder = bucketAging({
      asOf: AS_OF,
      rows: [
        { id: "junk", dueDate: "not-a-date", outstandingCents: 10_00 },
        { id: "feb30", dueDate: "2026-02-30", outstandingCents: 10_00 },
      ],
    });
    expect(ladder.notAged.count).toBe(2);
    expect(ladder.notAged.rows.every((r) => r.code === "unparseable_due_date")).toBe(true);
    expect(bucket(ladder, "current").count).toBe(0);
  });

  it("refuses an unusable as-of rather than declaring the whole book unmeasurable", () => {
    expect(() => bucketAging({ asOf: "yesterday", rows: FIXTURE })).toThrow(TypeError);
    expect(() => bucketAging({ asOf: "2026-13-01", rows: [] })).toThrow(TypeError);
  });
});

describe("honesty: an incomplete total says so", () => {
  it("marks a bucket incomplete when a row's amount is unknown", () => {
    const ladder = bucketAging({ asOf: AS_OF, rows: FIXTURE });
    const b = bucket(ladder, "d31_60");
    expect(b.unknownAmountCount).toBe(1);
    expect(b.totalIsComplete).toBe(false);
    expect(ladder.totalIsComplete).toBe(false);
    expect(ladder.unknownAmountCount).toBe(1);

    // Buckets with no unknowns stay complete — the flag is per-bucket, so the
    // surface can print a plain total where it is entitled to.
    expect(bucket(ladder, "d1_30").totalIsComplete).toBe(true);
  });

  it("refuses a non-integer or non-finite amount instead of rounding it", () => {
    const ladder = bucketAging({
      asOf: AS_OF,
      rows: [
        { id: "frac", dueDate: dueDaysAgo(10), outstandingCents: 12.5 },
        { id: "nan", dueDate: dueDaysAgo(10), outstandingCents: Number.NaN },
        { id: "inf", dueDate: dueDaysAgo(10), outstandingCents: Number.POSITIVE_INFINITY },
      ],
    });
    const b = bucket(ladder, "d1_30");
    expect(b.count).toBe(3);
    expect(b.totalCents).toBe(0);
    expect(b.unknownAmountCount).toBe(3);
    expect(b.rows.map((r) => r.unknownAmountCode).sort()).toEqual([
      "not_a_number",
      "not_a_number",
      "not_integer_cents",
    ]);
  });

  it("reports excluded rows with their reason instead of dropping them", () => {
    const ladder = bucketAging({ asOf: AS_OF, rows: FIXTURE });
    expect(ladder.excluded.count).toBe(1);
    expect(ladder.excluded.byCode).toEqual([
      {
        code: "disputed",
        reason: "Balance disputed by the payer; held out of the board until resolved.",
        count: 1,
        totalCents: 88_00,
      },
    ]);
    // And it is nowhere on the ladder.
    for (const b of ladder.buckets) {
      expect(b.rows.map((r) => r.id)).not.toContain("disputed");
    }
  });
});

describe("empty ledger", () => {
  it("says it is empty rather than presenting a board of zeros", () => {
    const ladder = bucketAging({ asOf: AS_OF, rows: [] });
    expect(ladder.isEmpty).toBe(true);
    expect(ladder.rowCount).toBe(0);
    expect(ladder.grandTotalCents).toBe(0);
    // A zeroed board and an empty ledger are different claims; `isEmpty` is
    // the flag a surface branches on to render an EmptyState.
    expect(ladder.buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("is NOT empty when rows exist but every one of them is unaged", () => {
    const ladder = bucketAging({
      asOf: AS_OF,
      rows: [{ id: "a", dueDate: null, outstandingCents: 1_00 }],
    });
    expect(ladder.isEmpty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE BOUNDARY RATCHET — derived from the table, pinned on both sides
// ---------------------------------------------------------------------------

describe("bucket boundaries are pinned on both sides", () => {
  it("declares exactly the five documented rungs, in order", () => {
    expect(AGING_LADDER_BUCKETS.map((b) => b.id)).toEqual([
      "current",
      "d1_30",
      "d31_60",
      "d61_90",
      "d90_plus",
    ]);
    expect(NOT_AGED_ID).toBe("not_aged");
    // The literal boundary tuple. Any move to a rung edge fails HERE first,
    // with a message that names the number that changed.
    expect(
      AGING_LADDER_BUCKETS.map((b) => [b.minDaysPastDue, b.maxDaysPastDue]),
    ).toEqual([
      [null, 0],
      [1, 30],
      [31, 60],
      [61, 90],
      [91, null],
    ]);
  });

  it("covers the day-count line with no gap and no overlap", () => {
    for (let d = -30; d <= 400; d += 1) {
      const matches = AGING_LADDER_BUCKETS.filter(
        (b) =>
          (b.minDaysPastDue === null || d >= b.minDaysPastDue) &&
          (b.maxDaysPastDue === null || d <= b.maxDaysPastDue),
      );
      expect(matches).toHaveLength(1);
      expect(bucketForDaysPastDue(d)).toBe(matches[0].id);
    }
  });

  it("places each edge day and the day after it in ADJACENT rungs", () => {
    // Derived from the table: for every rung with a closed max, day == max is
    // in that rung and day == max + 1 is in the NEXT one. A boundary mutation
    // makes one of these two assertions false whichever way it moves.
    for (let i = 0; i < AGING_LADDER_BUCKETS.length - 1; i += 1) {
      const here = AGING_LADDER_BUCKETS[i];
      const next = AGING_LADDER_BUCKETS[i + 1];
      const edge = here.maxDaysPastDue;
      expect(edge).not.toBeNull();
      expect(bucketForDaysPastDue(edge as number)).toBe(here.id);
      expect(bucketForDaysPastDue((edge as number) + 1)).toBe(next.id);
      // The rungs must abut — no unclaimed day between them.
      expect(next.minDaysPastDue).toBe((edge as number) + 1);
    }
  });

  it("routes a real fixture row across each edge the same way", () => {
    for (const b of AGING_LADDER_BUCKETS) {
      if (b.maxDaysPastDue === null) continue;
      const edge = b.maxDaysPastDue;
      const onEdge = bucketAging({
        asOf: AS_OF,
        rows: [{ id: "x", dueDate: dueDaysAgo(edge), outstandingCents: 1 }],
      });
      const overEdge = bucketAging({
        asOf: AS_OF,
        rows: [{ id: "x", dueDate: dueDaysAgo(edge + 1), outstandingCents: 1 }],
      });
      expect(onEdge.buckets.find((x) => x.count === 1)!.id).toBe(b.id);
      expect(overEdge.buckets.find((x) => x.count === 1)!.id).not.toBe(b.id);
    }
  });

  it("conserves across a swept range of ages", () => {
    const rows: AgeableRow[] = [];
    for (let d = -10; d <= 200; d += 1) {
      rows.push({ id: `r${d}`, dueDate: dueDaysAgo(d), outstandingCents: 100 + d });
    }
    const ladder = bucketAging({ asOf: AS_OF, rows });
    expect(conservationHolds(ladder, rows)).toBe(true);
    expect(ladder.buckets.reduce((s, b) => s + b.count, 0)).toBe(rows.length);
  });

  it("counts days with no timezone drift (day 0 is current, day 1 is past due)", () => {
    // Asserted THROUGH `bucketAging` — the production path — so the day count
    // on a row is the one a surface actually renders.
    const age = (due: string, asOf: string) =>
      bucketAging({ asOf, rows: [{ id: "x", dueDate: due, outstandingCents: 1 }] })
        .buckets.flatMap((b) => b.rows)[0].daysPastDue;

    expect(age("2026-08-11", "2026-08-11")).toBe(0);
    expect(age("2026-08-10", "2026-08-11")).toBe(1);
    expect(age("2026-08-12", "2026-08-11")).toBe(-1);
    // Across a DST boundary in every US zone — date-only UTC math is immune.
    expect(age("2026-03-01", "2026-03-31")).toBe(30);
    expect(age("2026-10-15", "2026-11-15")).toBe(31);
    // Day 0 is `current`; day 1 is the first past-due rung.
    expect(bucketForDaysPastDue(age("2026-08-11", "2026-08-11"))).toBe("current");
    expect(bucketForDaysPastDue(age("2026-08-10", "2026-08-11"))).toBe("d1_30");
  });

  it("validates an as-of by the engine's own parser, not by shape", () => {
    // What the routes call before `bucketAging` so a bad date is a 400, not a
    // 500. A regex would wave both of these through.
    expect(isCalendarDate("2026-08-11")).toBe(true);
    expect(isCalendarDate("2026-13-45")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheduled books (the notes side)
// ---------------------------------------------------------------------------

describe("scheduleWindowDue — books that record a schedule, not charges", () => {
  const base = {
    paymentDueDay: 15,
    maturityDate: "2040-01-15",
    asOf: "2026-08-11",
  };

  it("counts the periods that have come due, oldest first", () => {
    const w = scheduleWindowDue({ ...base, firstUnsatisfiedDueDate: "2026-05-15" });
    expect(w.refusal).toBeNull();
    expect(w.dueDates).toEqual(["2026-05-15", "2026-06-15", "2026-07-15"]);
    expect(w.periodsDue).toBe(3);
    expect(w.oldestDueDate).toBe("2026-05-15");
    // 2026-08-15 has NOT come due as of 2026-08-11 and must not be counted.
    expect(w.dueDates).not.toContain("2026-08-15");
  });

  it("clamps a 31st due day to the month's last day", () => {
    const w = scheduleWindowDue({
      paymentDueDay: 31,
      maturityDate: "2040-01-31",
      asOf: "2026-04-30",
      firstUnsatisfiedDueDate: "2026-01-31",
    });
    expect(w.dueDates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("stops at maturity rather than inventing a post-maturity period", () => {
    const w = scheduleWindowDue({
      paymentDueDay: 15,
      maturityDate: "2026-06-15",
      asOf: "2026-08-11",
      firstUnsatisfiedDueDate: "2026-05-15",
    });
    expect(w.dueDates).toEqual(["2026-05-15", "2026-06-15"]);
    expect(w.cappedAtMaturity).toBe(true);
  });

  it("REFUSES when the book has no first unsatisfied due date", () => {
    const w = scheduleWindowDue({ ...base, firstUnsatisfiedDueDate: null });
    expect(w.refusal).toBe("no_first_unsatisfied_due_date");
    expect(w.periodsDue).toBe(0);
    expect(w.oldestDueDate).toBeNull();
  });

  it("REFUSES on an unusable due day or maturity instead of guessing one", () => {
    expect(
      scheduleWindowDue({ ...base, paymentDueDay: 0, firstUnsatisfiedDueDate: "2026-05-15" }).refusal,
    ).toBe("invalid_due_day");
    expect(
      scheduleWindowDue({ ...base, maturityDate: null, firstUnsatisfiedDueDate: "2026-05-15" }).refusal,
    ).toBe("unparseable_maturity");
  });

  it("returns zero periods for a schedule whose first period is still future", () => {
    const w = scheduleWindowDue({ ...base, firstUnsatisfiedDueDate: "2026-09-15" });
    expect(w.refusal).toBeNull();
    expect(w.periodsDue).toBe(0);
    // Zero periods due is NOT a refusal — the note is genuinely current.
    expect(w.oldestDueDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DERIVED: both books read their boundaries from HERE
// ---------------------------------------------------------------------------

describe("no second copy of the ladder", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const consumers = [
    "server/routes-rent-ledger.ts",
    "server/routes-notes.ts",
    "client/src/components/aging-ladder-board.tsx",
  ];

  it("has every aging consumer importing this module", () => {
    for (const rel of consumers) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      expect(src, `${rel} must import the shared aging ladder`).toMatch(
        /from "@shared\/finance\/agingLadder"/,
      );
    }
  });

  /**
   * `/api/notes/aging` is a LITERAL under `/api/notes/*`, and
   * `routes-finance.ts` registers `/api/notes/:id` in an EARLIER
   * `registerFinanceRoutes(app)` call. The literal survives only because that
   * handler calls `next()` for a non-numeric id — `Number("aging")` is NaN.
   *
   * `scripts/check-route-order.mjs` explicitly does NOT model cross-file
   * ordering ("registration order across files isn't derivable statically"),
   * so nothing else guards this. Deleting the fall-through would 404 the aging
   * board — and `/api/notes/acquired` and `/api/notes/insurance-watch` with it.
   */
  it("keeps the cross-file fall-through that lets /api/notes/aging be reached", () => {
    const finance = readFileSync(path.join(repoRoot, "server/routes-finance.ts"), "utf8");
    const handler = finance.slice(finance.indexOf('api.get("/api/notes/:id"'));
    const body = handler.slice(0, handler.indexOf("\n  });"));
    expect(body, "routes-finance /api/notes/:id must exist").toContain("/api/notes/:id");
    expect(body, "non-numeric ids must fall through to later literal routes").toMatch(
      /Number\.isFinite\(id\)[\s\S]*return next\(\);/,
    );

    // ...and the literal must be registered before the acquired book's own
    // `/api/notes/:id`, which does NOT fall through.
    const notes = readFileSync(path.join(repoRoot, "server/routes-notes.ts"), "utf8");
    const agingAt = notes.indexOf('"/api/notes/aging"');
    const idAt = notes.indexOf('"/api/notes/:id"');
    expect(agingAt, "/api/notes/aging must be registered in routes-notes.ts").toBeGreaterThan(-1);
    expect(idAt).toBeGreaterThan(-1);
    expect(agingAt).toBeLessThan(idAt);
  });

  it("has no consumer restating the 30/60/90 boundaries in its own code", () => {
    // The failure this catches for real: `/api/rent/aging` used to bucket in
    // hand-written SQL/JS with the numbers inline, and the client restated the
    // labels a third time. Any consumer that re-grows a literal ladder here
    // is the drift this slice removed.
    const forbidden = [
      /days_overdue\s*>\s*30/,
      /days_overdue\s*>\s*60/,
      /days_overdue\s*>\s*90/,
      /daysPastDue\s*>\s*30/,
      /daysPastDue\s*>\s*60/,
      /daysPastDue\s*>\s*90/,
    ];
    for (const rel of consumers) {
      const src = readFileSync(path.join(repoRoot, rel), "utf8");
      for (const pattern of forbidden) {
        expect(pattern.test(src), `${rel} restates an aging boundary (${pattern})`).toBe(false);
      }
    }
  });
});

describe("fleet-13 audit — the schedule anchor must agree with the due day", () => {
  /**
   * The walk used to take the STORED first-unsatisfied due date for period 0
   * and then snap every later period to `paymentDueDay`. Those two fields
   * routinely disagree on real rows: `acquiredNoteSchedule.scheduleAnchor`
   * returns `firstPaymentDate` verbatim and un-snapped, while `importExport`
   * DEFAULTS `paymentDueDay` to 1 for any tape with no day-of-month column.
   *
   * The result was a hybrid schedule with a twelve-day "month" that
   * miscounted arrears by a full payment in either direction — and it did so
   * silently, on the surface whose entire purpose is to say how far behind a
   * borrower is.
   */
  const base = { maturityDate: "2040-05-15", asOf: "2026-08-11" };

  it("refuses rather than walking a schedule it cannot identify", () => {
    // The exact overstating case: anchored on the 20th, due day defaulted to 1.
    const w = scheduleWindowDue({
      ...base,
      firstUnsatisfiedDueDate: "2026-05-20",
      paymentDueDay: 1,
    });
    expect(w.refusal).toBe("anchor_does_not_match_due_day");
    // A refusal reports NOTHING, rather than a plausible number.
    expect(w.periodsDue).toBe(0);
    expect(w.dueDates).toEqual([]);
    expect(w.oldestDueDate).toBeNull();
  });

  it("refuses the understating direction too", () => {
    // Anchored on the 1st, due day 28 — the mirror case, which under-counted.
    const w = scheduleWindowDue({
      ...base,
      firstUnsatisfiedDueDate: "2026-05-01",
      paymentDueDay: 28,
    });
    expect(w.refusal).toBe("anchor_does_not_match_due_day");
  });

  it("walks normally when the anchor and the due day agree", () => {
    const w = scheduleWindowDue({
      ...base,
      firstUnsatisfiedDueDate: "2026-05-15",
      paymentDueDay: 15,
    });
    expect(w.refusal).toBeNull();
    // Three periods due by 2026-08-11: May 15, Jun 15, Jul 15. Aug 15 is not
    // yet due, and that boundary is the point of the walk.
    expect(w.dueDates).toEqual(["2026-05-15", "2026-06-15", "2026-07-15"]);
    expect(w.periodsDue).toBe(3);
  });

  it("treats a short-month clamp as agreement, not as a mismatch", () => {
    // A 31st due day anchored on Feb 28 is CONSISTENT — it is exactly how the
    // walk itself resolves a due day past the end of a short month, so judging
    // the anchor by a different rule would refuse a perfectly good schedule.
    const w = scheduleWindowDue({
      maturityDate: "2040-01-31",
      asOf: "2026-05-11",
      firstUnsatisfiedDueDate: "2026-02-28",
      paymentDueDay: 31,
    });
    expect(w.refusal).toBeNull();
    expect(w.dueDates[0]).toBe("2026-02-28");
    // …and the following periods take the real last day of each month.
    expect(w.dueDates).toContain("2026-03-31");
    expect(w.dueDates).toContain("2026-04-30");
  });

  it("a refused window contributes NO periods to multiply against", () => {
    // The second blocking finding, at the engine boundary: `periodsDue` 0 on a
    // refusal is what let a caller compute `0 * paymentAmount = $0.00` and
    // report a confident zero for a note it had just refused to date. The
    // engine's contract is that a refusal carries no countable periods; the
    // caller must treat the amount as UNKNOWN rather than as zero.
    const w = scheduleWindowDue({
      ...base,
      firstUnsatisfiedDueDate: null,
      paymentDueDay: 15,
    });
    expect(w.refusal).toBe("no_first_unsatisfied_due_date");
    expect(w.periodsDue).toBe(0);
  });
});
