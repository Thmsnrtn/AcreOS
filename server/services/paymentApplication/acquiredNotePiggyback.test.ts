/**
 * §1026.36(c)(1) piggyback on acquired-note payments (Beatrice 2026-06-02
 * ruling §5). The piggyback uses the SAME pure algorithm
 * (`decidePaymentApplication`) — the new contribution is the predicate gate
 * up-front: acquired-note payments only invoke prompt-crediting + suspense
 * handling when the note qualifies for Reg-Z scope.
 *
 * These tests exercise the algorithm composed with the sync predicate,
 * confirming the same prompt-crediting + partial-to-suspense behavior fires
 * on a qualifying acquired-note shape (and is gated out on a non-qualifying
 * one).
 */

import { describe, expect, it } from "vitest";
import { decidePaymentApplication } from "./index";
import { qualifiesForRegZStatementSync } from "../periodicStatements/predicate";
import type { AcquiredNote } from "@shared/schema/notes-vertical";

const PERIODIC_CENTS = 50_000;
const PERIODIC_SPLIT = {
  principalCents: 10_000,
  interestCents: 35_000,
  escrowCents: 5_000,
};
const CHICAGO = "America/Chicago";

function qualifyingAcquired(overrides: Partial<AcquiredNote> = {}): AcquiredNote {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: 1,
    propertyId: null,
    borrowerId: null,
    noteNumber: "AN-Q-1",
    originalPrincipalCents: 10_000_000,
    currentBalanceCents: 9_500_000,
    unappliedBalanceCents: 0,
    interestRateBps: 800,
    termMonths: 360,
    paymentAmountCents: PERIODIC_CENTS,
    paymentDueDay: 1,
    originationDate: "2020-01-01",
    maturityDate: "2050-01-01",
    acquisitionDate: "2024-06-01",
    acquisitionPriceCents: 8_500_000,
    status: "performing",
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

describe("§1026.36(c)(1) piggyback on acquired-note payments", () => {
  const baseInput = {
    paymentAmountCents: 50_000,
    periodicPaymentAmountCents: PERIODIC_CENTS,
    existingSuspenseBalanceCents: 0,
    receivedAt: new Date("2026-06-15T15:00:00Z"),
    dueDate: new Date("2026-06-15T05:00:00Z"),
    loanTz: CHICAGO,
    periodicSplit: PERIODIC_SPLIT,
  };

  it("qualifying acquired note → full payment hits prompt-crediting", () => {
    const note = qualifyingAcquired();
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(true);

    // Predicate passes → the same pure algorithm fires.
    const decision = decidePaymentApplication(baseInput);
    expect(decision.appliedToPrincipalCents).toBe(PERIODIC_SPLIT.principalCents);
    expect(decision.appliedToInterestCents).toBe(PERIODIC_SPLIT.interestCents);
    expect(decision.appliedToSuspenseCents).toBe(0);
    expect(decision.regCitation).toContain("§1026.36(c)(1)");
  });

  it("qualifying acquired note → partial payment lands in suspense (§1026.36(c)(1)(ii))", () => {
    const note = qualifyingAcquired();
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(true);

    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 20_000, // less than periodic
    });
    expect(decision.appliedToPrincipalCents).toBe(0);
    expect(decision.appliedToSuspenseCents).toBe(20_000);
    expect(decision.newSuspenseBalanceCents).toBe(20_000);
    expect(decision.regCitation).toContain("§1026.36(c)(1)(ii)");
  });

  it("passive-holder acquired note → predicate gates payment, no §1026.36(c) attaches", () => {
    const note = qualifyingAcquired({ servicingArrangement: "passive_holder" });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1024.2(b)");
    // The piggyback contract: when the predicate skips, the caller
    // (`applyAcquiredNotePayment`) returns early WITHOUT firing the algorithm.
    // We don't take on §1026.36(c) obligations on a note we don't service.
  });

  it("business-purpose acquired note → predicate gates payment", () => {
    const note = qualifyingAcquired({ isConsumerPurpose: false });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1026.3(a)");
  });

  it("non-dwelling collateral acquired note → predicate gates payment (federal); state overlay may still apply", () => {
    const note = qualifyingAcquired({ collateralIsDwelling: false });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    expect(predicate.citation).toContain("§1026.2(a)(19)");
    // TODO(beatrice-state-overlay): a non-dwelling consumer loan still owes
    // disclosure under several state overlays (CA, NY, TX, OK). When the
    // overlay matrix lands, this test extends to assert the state-level
    // generation fires even on a federal skip.
  });
});
