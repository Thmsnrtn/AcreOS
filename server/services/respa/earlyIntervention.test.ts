/**
 * Tests for RESPA §1024.39 early-intervention scaffold (Beatrice 2026-06-02
 * ruling §5 piggyback item 4). Pure-function tests cover the day-36 trigger
 * boundary + non-trigger range. The DB-backed `flagEarlyIntervention` path
 * (predicate-gate + idempotency UNIQUE) is exercised by integration tests
 * once the test harness has db-mock plumbing for respa_outreach_events.
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
import type { AcquiredNote } from "@shared/schema/notes-vertical";

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
  } as AcquiredNote;
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
    // Combined: predicate.qualifies && shouldFireEarlyIntervention(36) → fire.
    const trigger = shouldFireEarlyIntervention(36);
    expect(predicate.qualifies && trigger.shouldFire).toBe(true);
  });

  it("passive_holder acquired note → predicate gates, NO §1024.39 attaches even at day 60", () => {
    const note = acquiredNote({ servicingArrangement: "passive_holder" });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1024.2(b)");
    // Even at deep delinquency, the duty doesn't attach to a passive holder.
    const trigger = shouldFireEarlyIntervention(60);
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
