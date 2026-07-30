/**
 * Structural build B — the acquired book's aging sweep.
 *
 * Before this job, NOTHING in the repo ever wrote `'late'` or `'default'` to
 * `acquired_notes.status`. The only automatic status write anywhere was
 * `paid_off` in the payment recorder. A note six months down and a note paid
 * current rendered identically on every surface.
 *
 * `planNoteAging` is a pure function precisely so the rules below are testable
 * without a database (this environment has no DATABASE_URL) and without mocking
 * the clock — `asOf` is an argument.
 *
 * The three rules this file exists to defend, all of which are ways the sweep
 * could invent an obligation against a real borrower:
 *   1. TERMINAL IS TERMINAL — a paid_off or sold note is never re-aged.
 *   2. UNKNOWN IS NOT LATE — a note whose facts cannot produce a due date is
 *      not delinquent; it is unread.
 *   3. NO MONEY MOVES — the late fee is an advisory count, never a charge
 *      (founder ruling #15).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  planNoteAging,
  noteStatusForDelinquency,
  isWorseningTransition,
  TERMINAL_NOTE_STATUSES,
  AGEABLE_NOTE_STATUSES,
  ACQUIRED_NOTE_AGING_JOB_NAME,
  type AgingNoteRow,
} from "../../server/jobs/acquiredNoteAging";
import { EARLY_INTERVENTION_TRIGGER_DAY } from "../../server/services/respa/earlyIntervention";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/** 2026-07-30, the day these rules were written. Every case is relative to it. */
const ASOF = new Date(Date.UTC(2026, 6, 30));
const day = (n: number) => new Date(ASOF.getTime() + n * 24 * 60 * 60 * 1000);

/**
 * A note originated AND acquired in the same month, so the schedule module
 * will produce a real date rather than refusing on `history_predates_acquisition`.
 * Overrides let each case state only the fact it is about.
 */
function note(over: Partial<AgingNoteRow> = {}): AgingNoteRow {
  return {
    id: "note-1",
    organizationId: 7,
    noteNumber: "N-001",
    status: "performing",
    paymentDueDay: 15,
    originationDate: "2025-01-10",
    maturityDate: "2035-01-15",
    acquisitionDate: "2025-01-20",
    firstPaymentDate: "2025-02-15",
    paidThroughDate: "2026-06-15",
    nextPaymentDate: null,
    gracePeriodDays: 10,
    lateFeeCents: 5000,
    daysDelinquent: 0,
    delinquencyStatus: "current",
    ...over,
  };
}

describe("RULE 1 — terminal states are terminal", () => {
  for (const status of TERMINAL_NOTE_STATUSES) {
    it(`a '${status}' note is never touched`, () => {
      const plan = planNoteAging(note({ status, paidThroughDate: "2020-01-15" }), ASOF);
      expect(plan.skipReason).toContain(status);
      expect(plan.changes).toEqual({});
      expect(plan.changed).toBe(false);
      expect(plan.status).toBe(status);
      expect(plan.transition).toBeNull();
      // The sweep resurrecting a sold note as "late" would be a fabricated
      // obligation against a borrower who owes this org nothing.
      expect(plan.lateFeeAdvisory).toBeNull();
    });
  }
});

describe("RULE 2 — unknown is not late", () => {
  it("a note whose facts cannot produce a due date asserts NO delinquency", () => {
    // The mid-life import: originated 2019, bought in 2026, no payment history
    // imported. The schedule module refuses rather than claiming seven years
    // of arrears the platform never observed.
    const plan = planNoteAging(
      note({
        originationDate: "2019-03-10",
        acquisitionDate: "2026-07-01",
        firstPaymentDate: null,
        paidThroughDate: null,
      }),
      ASOF,
    );
    expect(plan.nextPaymentDate).toBeNull();
    expect(plan.skipReason).toMatch(/unknown is not late/);
    expect(plan.changes.daysDelinquent).toBeUndefined();
    expect(plan.changes.delinquencyStatus).toBeUndefined();
    expect(plan.changes.status).toBeUndefined();
    expect(plan.transition).toBeNull();
  });

  it("clears an unsupported STORED date so the UI renders an honest blank", () => {
    const plan = planNoteAging(
      note({
        originationDate: "2019-03-10",
        acquisitionDate: "2026-07-01",
        firstPaymentDate: null,
        paidThroughDate: null,
        nextPaymentDate: "2026-08-15", // left over from a prior, wrong derivation
      }),
      ASOF,
    );
    expect(plan.changes.nextPaymentDate).toBeNull();
    expect(plan.changed).toBe(true);
  });

  it("a note missing schedule facts is skipped, not guessed at", () => {
    for (const missing of [
      { paymentDueDay: null },
      { originationDate: null },
      { maturityDate: null },
      { acquisitionDate: null },
    ] as Partial<AgingNoteRow>[]) {
      const plan = planNoteAging(note(missing), ASOF);
      expect(plan.skipReason).toBe("note is missing schedule facts");
      expect(plan.changes).toEqual({});
    }
  });
});

describe("the status band moves on real delinquency", () => {
  it("a current note stays performing and writes NOTHING", () => {
    // Paid through 2026-07-15, so the next due is 2026-08-15 — in the future.
    const plan = planNoteAging(
      note({ paidThroughDate: "2026-07-15", nextPaymentDate: "2026-08-15" }),
      ASOF,
    );
    expect(plan.daysDelinquent).toBe(0);
    expect(plan.status).toBe("performing");
    // A no-op UPDATE per note per day is pure write amplification on a table
    // the whole book reads.
    expect(plan.changed).toBe(false);
    expect(plan.changes).toEqual({});
  });

  it("counts from the due date — one day past due IS one day delinquent", () => {
    // REWRITTEN 2026-07-30, and inverted rather than deleted. This used to
    // assert that a 30-day grace kept a note one day past due at 0 days
    // delinquent. Grace governs FEES, not the delinquency clock: RESPA
    // §1024.39's 36-day trigger and §1026.41's 45/90-day gates all run from
    // the due date, so offsetting by grace delayed a federal obligation by the
    // length of the grace period, and disagreed with the originated book about
    // the same borrower. The note's own grace is still honoured where it
    // belongs — see the late-fee advisory below.
    const plan = planNoteAging(
      note({ paidThroughDate: "2026-06-15", gracePeriodDays: 30 }),
      new Date(Date.UTC(2026, 6, 16)),
    );
    expect(plan.daysDelinquent).toBe(1);
    expect(plan.delinquencyStatus).toBe("early_delinquent");
    expect(plan.status).toBe("late");
  });

  it("but the LATE FEE still respects the note's grace", () => {
    // The other half of the same rule: one day past due is delinquent, and a
    // fee is NOT yet assessable on a note granting 30 days. Charging a
    // borrower inside the terms they signed is the failure this pins shut.
    const plan = planNoteAging(
      note({ paidThroughDate: "2026-06-15", gracePeriodDays: 30 }),
      new Date(Date.UTC(2026, 6, 16)),
    );
    expect(plan.lateFeeAdvisory?.assessable).toBe(false);
    expect(plan.lateFeeAdvisory?.reason).toMatch(/grace/i);
  });

  it("flips performing → late once past grace", () => {
    // Next due 2026-07-15, grace 10 → late from 2026-07-26 onward.
    const plan = planNoteAging(note({ paidThroughDate: "2026-06-15" }), ASOF);
    expect(plan.daysDelinquent).toBeGreaterThan(0);
    expect(plan.status).toBe("late");
    expect(plan.changes.status).toBe("late");
    expect(plan.transition).toEqual({ from: "performing", to: "late", worsening: true });
  });

  it("flips to default only at the default_candidate band", () => {
    const plan = planNoteAging(
      note({ status: "late", paidThroughDate: "2026-02-15" }),
      ASOF,
    );
    expect(plan.delinquencyStatus).toBe("default_candidate");
    expect(plan.status).toBe("default");
    expect(plan.transition).toEqual({ from: "late", to: "default", worsening: true });
  });

  it("a recovery is a transition but NOT a worsening one", () => {
    const plan = planNoteAging(
      note({ status: "late", paidThroughDate: "2026-07-15" }),
      ASOF,
    );
    expect(plan.status).toBe("performing");
    expect(plan.transition?.worsening).toBe(false);
  });

  it("leaves a status outside the three ageable ones alone", () => {
    // A value some future migration introduces must not be force-fitted into
    // a band this job invented.
    const plan = planNoteAging(
      note({ status: "in_foreclosure", paidThroughDate: "2026-02-15" }),
      ASOF,
    );
    expect(plan.status).toBe("in_foreclosure");
    expect(plan.changes.status).toBeUndefined();
    expect(plan.transition).toBeNull();
  });

  it("band → status mapping is total and monotone", () => {
    expect(noteStatusForDelinquency("current")).toBe("performing");
    expect(noteStatusForDelinquency("early_delinquent")).toBe("late");
    expect(noteStatusForDelinquency("delinquent")).toBe("late");
    expect(noteStatusForDelinquency("seriously_delinquent")).toBe("late");
    expect(noteStatusForDelinquency("default_candidate")).toBe("default");
    for (const s of AGEABLE_NOTE_STATUSES) {
      expect(isWorseningTransition(s, s)).toBe(false);
    }
    expect(isWorseningTransition("performing", "default")).toBe(true);
    expect(isWorseningTransition("default", "performing")).toBe(false);
    // An unknown status is never called a worsening — we do not rank what we
    // did not define.
    expect(isWorseningTransition("in_foreclosure", "late")).toBe(false);
  });
});

describe("RULE 3 — no money moves", () => {
  it("the advisory is false when the note carries no late fee", () => {
    const plan = planNoteAging(
      note({ lateFeeCents: 0, paidThroughDate: "2026-02-15" }),
      ASOF,
    );
    expect(plan.lateFeeAdvisory?.assessable).toBe(false);
    expect(plan.lateFeeAdvisory?.reason).toBeTruthy();
  });

  it("an assessable advisory still writes no fee anywhere in the plan", () => {
    const plan = planNoteAging(note({ paidThroughDate: "2026-02-15" }), ASOF);
    expect(plan.lateFeeAdvisory?.assessable).toBe(true);
    // The writeback shape has no fee field at all — that is the guarantee.
    expect(Object.keys(plan.changes).every((k) => !/fee/i.test(k))).toBe(true);
  });

  it("the job module inserts nothing into any money table", () => {
    const src = read("server/jobs/acquiredNoteAging.ts");
    expect(src, "the aging sweep must never insert a ledger row").not.toMatch(
      /\.insert\(\s*(notePayments|payments|rentPayments)/,
    );
    for (const forbidden of ["stripe", "createPaymentIntent", "prepareCustomerMoneyCall"]) {
      expect(src, `the aging sweep must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("the sweep is actually wired — the defect class this repo keeps hitting", () => {
  const runner = read("server/jobs/runScheduledJobs.ts");

  it("is imported AND started from the scheduler", () => {
    expect(runner).toMatch(/import\s*\{\s*startAcquiredNoteAgingJob\s*\}/);
    expect(runner).toMatch(/startAcquiredNoteAgingJob\(\)/);
  });

  it("has a JOB_ROSTER entry, so the deadman can page when it goes dark", () => {
    // Without this, the whole book silently freezes at whatever standing it
    // last had — which reads on every surface as "everyone is current".
    const registry = read("server/jobs/jobRegistry.ts");
    expect(registry).toContain(`"${ACQUIRED_NOTE_AGING_JOB_NAME}"`);
    const coverage = read("tests/unit/jobRosterCoverage.test.ts");
    expect(
      coverage,
      "acquiredNoteAging.ts must be in SCANNED_FILES or the roster parity check cannot see its lock",
    ).toContain("server/jobs/acquiredNoteAging.ts");
  });

  it("the API actually SENDS the fields the note surfaces render", () => {
    // The exact miniature of this repo's most common defect: notes.tsx and
    // note-detail.tsx both render a reason-aware honest blank for a missing
    // due date, keyed on `nextPaymentDateReason`. If the server never puts
    // that field on the wire, every blank collapses to the same generic
    // sentence and the operator can't tell "import the history" from "this
    // note is paid off". Both responses must carry it.
    const routes = read("server/routes-notes.ts");
    expect((routes.match(/nextPaymentDateReason:/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((routes.match(/lateFeeAdvisory: noteLateFeeAdvisory/g) ?? []).length).toBeGreaterThanOrEqual(2);
    for (const page of ["client/src/pages/notes.tsx", "client/src/pages/note-detail.tsx"]) {
      expect(read(page), `${page} must consume the reason`).toContain("nextPaymentDateReason");
    }
  });

  it("the browser no longer derives a due date of its own", () => {
    // `nextPaymentLabel` took today's date, clamped the note's due day to the
    // month, and rolled forward if it had passed — so a note six months down
    // showed the same friendly upcoming date as a current one. Deleted, and it
    // must not come back as a "fallback": a fallback here IS the fabrication.
    const page = read("client/src/pages/notes.tsx");
    expect(page).not.toContain("nextPaymentLabel");
    expect(page, "no client-side month arithmetic off paymentDueDay").not.toMatch(
      /setUTCMonth\([^)]*\+\s*1/,
    );
  });

  it("is the caller RESPA §1024.39 early intervention never had", () => {
    const src = read("server/jobs/acquiredNoteAging.ts");
    expect(src).toContain("flagEarlyIntervention");
    // Pre-gated on the module's OWN exported constant rather than a literal 36,
    // so the gate cannot drift away from the regulation it encodes.
    expect(src).toContain("EARLY_INTERVENTION_TRIGGER_DAY");
    expect(src).not.toMatch(/daysDelinquent\s*>=\s*36\b/);
    expect(EARLY_INTERVENTION_TRIGGER_DAY).toBeGreaterThan(0);
  });
});
