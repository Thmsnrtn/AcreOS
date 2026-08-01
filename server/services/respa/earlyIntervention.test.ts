/**
 * Tests for RESPA §1024.39 early-intervention FLAGGING (Beatrice 2026-06-02
 * ruling §5 piggyback item 4). "Fire" throughout means FLAG for outreach:
 * the module sends NOTHING to a borrower — the operator must make the
 * §1024.39 contact (see earlyIntervention.ts header). Pure-function tests
 * cover the day-36 trigger boundary + non-trigger range. The DB-backed
 * `flagEarlyIntervention` path (predicate-gate + idempotency UNIQUE) is
 * exercised by integration tests once the test harness has db-mock plumbing
 * for respa_outreach_events.
 *
 * Coverage:
 *  - triggers at exactly day 36
 *  - doesn't re-fire on day 37 / 38 (idempotency via UNIQUE — covered at
 *    DB layer; the pure function is monotonic in `daysDelinquent` and
 *    relies on the persistence index for the real guard)
 *  - no-op for non-qualifying loans (predicate-gate behavior, asserted via
 *    composing with the sync predicate)
 */

import { describe, expect, it } from "vitest";
import {
  shouldFireEarlyIntervention,
  EARLY_INTERVENTION_TRIGGER_DAY,
} from "./earlyIntervention";
import { qualifiesForRegZStatementSync } from "../periodicStatements/predicate";
import { computeNoteDelinquency } from "../notes/acquiredNoteSchedule";
import type { AcquiredNote } from "@shared/schema/notes-vertical";

const GRACE_DAYS = 10;
/** The first period the borrower missed — the one the delinquency runs from. */
const MISSED_DUE_DATE = "2026-05-01";
/** Last period fully satisfied: the cycle before the missed one. */
const PAID_THROUGH = "2026-04-01";

/**
 * Evaluation instants chosen so the note's STORED aging equals the day the
 * test hands to `shouldFireEarlyIntervention`. Without this the fixture would
 * quietly say "current" while the assertion says "36 days delinquent".
 *
 * Both instants moved 10 days earlier on 2026-07-30, when
 * `computeNoteDelinquency` was corrected to count from the DUE DATE rather
 * than from due-plus-grace. That correction is the point of the change, not a
 * detail: §1024.39's duty attaches at 36 days DELINQUENT, and delinquency
 * starts the day the payment was due. Counting after a 10-day grace delayed
 * this federal obligation by ten days for every borrower on the book.
 *
 * So the offsets are now MISSED_DUE_DATE + the day count, with no grace term:
 * 2026-05-01 + 36 = 2026-06-06, and + 60 = 2026-06-30.
 */
const AS_OF_TRIGGER_DAY = new Date(Date.UTC(2026, 5, 6));
const AS_OF_DAY_60 = new Date(Date.UTC(2026, 5, 30));

/**
 * The stored schedule + aging columns for a note observed at `asOf`. The two
 * derived columns come from the same pure function the nightly aging job
 * uses, so the fixture can only ever hold a combination the real system
 * could produce.
 */
function agingAsOf(asOf: Date) {
  return {
    firstPaymentDate: "2020-02-01",
    nextPaymentDate: MISSED_DUE_DATE,
    paidThroughDate: PAID_THROUGH,
    gracePeriodDays: GRACE_DAYS,
    ...computeNoteDelinquency({
      nextPaymentDate: MISSED_DUE_DATE,
      gracePeriodDays: GRACE_DAYS,
      asOf,
    }),
  };
}

function acquiredNote(overrides: Partial<AcquiredNote> = {}): AcquiredNote {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    organizationId: 1,
    propertyId: null,
    borrowerId: null,
    noteNumber: "AN-EI-1",
    originalPrincipalCents: 10_000_000,
    currentBalanceCents: 9_500_000,
    unappliedBalanceCents: 0,
    interestRateBps: 800,
    termMonths: 360,
    paymentAmountCents: 50_000,
    paymentDueDay: 1,
    originationDate: "2020-01-01",
    maturityDate: "2050-01-01",
    acquisitionDate: "2024-06-01",
    acquisitionPriceCents: 8_500_000,
    // Default shape: the day-36 note the §1024.39 tests are about.
    ...agingAsOf(AS_OF_TRIGGER_DAY),
    // §1024.39 outreach is unrelated to fee terms, and this note's
    // instrument carries none. 0 = no late fee (schema default).
    lateFeeCents: 0,
    status: "late",
    payerName: "Jane Borrower",
    payerAddress: null,
    payerEncryptedTin: null,
    payerTinType: null,
    originalLender: null,
    assignmentDocS3Key: null,
    insuranceStatus: "verified",
    insuranceCarrier: null,
    insurancePolicyNumber: null,
    insuranceExpiresAt: null,
    insuranceAnnualPremiumCents: null,
    taxEscrowEnabled: false,
    taxEscrowBalanceCents: 0,
    taxDisbursementDueDate: null,
    taxDisbursementAmountCents: null,
    taxAuthorityName: null,
    consecutiveOnTimePayments: 0,
    reperformingThresholdMet: false,
    compliancePostureJson: null,
    isConsumerPurpose: true,
    collateralIsDwelling: true,
    servicingArrangement: "self_serviced",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("§1024.39 early-intervention — pure decision gate", () => {
  it("constant: trigger day is exactly 36", () => {
    expect(EARLY_INTERVENTION_TRIGGER_DAY).toBe(36);
  });

  it("triggers at exactly day 36", () => {
    const result = shouldFireEarlyIntervention(36);
    expect(result.shouldFire).toBe(true);
    expect(result.citation).toContain("§1024.39(a)");
  });

  it("does NOT trigger on day 35 (boundary)", () => {
    const result = shouldFireEarlyIntervention(35);
    expect(result.shouldFire).toBe(false);
    expect(result.citation).toContain("§1024.39(a)");
  });

  it("still triggers on day 37 / 38 — the IDEMPOTENCY guard is at the persistence layer", () => {
    // The pure function is monotonic: anything >= 36 returns shouldFire=true.
    // The "no double-fire on day 37/38" requirement is enforced by the
    // UNIQUE index on (org, loan, loan_type, event_type, cycle_anchor).
    // The DB-backed `flagEarlyIntervention` returns alreadyFired=true on
    // the second call — that's exercised by integration tests.
    expect(shouldFireEarlyIntervention(37).shouldFire).toBe(true);
    expect(shouldFireEarlyIntervention(38).shouldFire).toBe(true);
    expect(shouldFireEarlyIntervention(60).shouldFire).toBe(true);
  });

  it("does NOT trigger on day 0 (current cycle)", () => {
    const result = shouldFireEarlyIntervention(0);
    expect(result.shouldFire).toBe(false);
  });
});

describe("§1024.39 early-intervention — predicate-gate composition", () => {
  it("self-serviced consumer-purpose dwelling-secured acquired note → predicate qualifies", () => {
    const note = acquiredNote();
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(true);
    // The row's own stored aging must be the day we then ask about — one note,
    // one delinquency depth.
    expect(note.daysDelinquent).toBe(EARLY_INTERVENTION_TRIGGER_DAY);
    expect(note.delinquencyStatus).toBe("default_candidate");
    // Combined: predicate.qualifies && shouldFireEarlyIntervention(36) → fire.
    const trigger = shouldFireEarlyIntervention(note.daysDelinquent);
    expect(predicate.qualifies && trigger.shouldFire).toBe(true);
  });

  it("passive_holder acquired note → predicate gates, NO §1024.39 attaches even at day 60", () => {
    // Aged forward to day 60 on the row itself — the "deep delinquency" this
    // case is about is stored on the note, not only asserted about it.
    const note = acquiredNote({
      servicingArrangement: "passive_holder",
      ...agingAsOf(AS_OF_DAY_60),
    });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1024.2(b)");
    expect(note.daysDelinquent).toBe(60);
    // Even at deep delinquency, the duty doesn't attach to a passive holder.
    const trigger = shouldFireEarlyIntervention(note.daysDelinquent);
    expect(trigger.shouldFire).toBe(true); // pure function says yes
    expect(predicate.qualifies && trigger.shouldFire).toBe(false); // composed: no
  });

  it("business-purpose acquired note → §1024.39 doesn't attach (out of RESPA consumer scope)", () => {
    const note = acquiredNote({ isConsumerPurpose: false });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1026.3(a)");
  });
});
