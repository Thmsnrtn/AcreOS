/**
 * Tests for the §1026.41 servicer-scope predicate (Beatrice 2026-06-02
 * acquired-notes ruling). Pure-function variant exercised here; the
 * DB-backed `qualifiesForRegZStatement` is exercised by integration tests
 * in periodicStatements.integration.test.ts (skip-ledger pathway).
 *
 * Coverage:
 *  - 4 "qualifies" scenarios (1 originated note + 3 acquired-note shapes)
 *  - 6 "skips" scenarios (the 6 not-covered cases from Beatrice's memo)
 */

import { describe, expect, it } from "vitest";
import { qualifiesForRegZStatementSync } from "./predicate";
import type { AcquiredNote } from "@shared/schema/notes-vertical";
import type { notes } from "@shared/schema";

type Note = typeof notes.$inferSelect;

/**
 * Synthetic acquired-note row factory. Every field that matters to the
 * predicate is overridable. Sensible defaults for the qualifying case.
 */
function acquiredNote(overrides: Partial<AcquiredNote> = {}): AcquiredNote {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    organizationId: 1,
    propertyId: null,
    borrowerId: null,
    noteNumber: "AN-0001",
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
    // The §1026.41 predicate is a SCOPE test (consumer purpose, dwelling,
    // who services it) — it never reads the schedule or the aging columns.
    // So this fixture stays deliberately neutral and self-consistent: no
    // derived schedule dates, schema defaults for the rest. A performing
    // note that is current and carries no stated fee.
    firstPaymentDate: null,
    nextPaymentDate: null,
    paidThroughDate: null,
    gracePeriodDays: 10,
    lateFeeCents: 0,
    daysDelinquent: 0,
    delinquencyStatus: "current",
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
  };
}

describe("qualifiesForRegZStatementSync — Beatrice 2026-06-02 ruling", () => {
  // ── QUALIFIES (4 scenarios) ────────────────────────────────────────────
  describe("qualifies", () => {
    it("originated note always qualifies (AcreOS is servicer by construction)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "note",
        row: { id: 42 } as Note,
      });
      expect(result.qualifies).toBe(true);
      expect(result.citation).toContain("§1026.41(a)");
    });

    it("acquired note: consumer-purpose + dwelling + self_serviced → qualifies", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote(),
      });
      expect(result.qualifies).toBe(true);
      expect(result.citation).toContain("§1026.41(a)");
    });

    it("acquired note: workout / pre-charge-off still qualifies when self_serviced (Beatrice case 6)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({
          status: "default",
          servicingArrangement: "self_serviced",
          // A note in `default` cannot also be stored as current — the aging
          // columns have to describe the same loan the status describes.
          // Deep delinquency (past the 30-day band) is what puts it here.
          nextPaymentDate: "2026-01-01",
          paidThroughDate: "2025-12-01",
          daysDelinquent: 90,
          delinquencyStatus: "default_candidate",
        }),
      });
      expect(result.qualifies).toBe(true);
    });

    it("acquired note: dwelling-secured parcel with mobile-home borrower qualifies (Beatrice case 9)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({
          isConsumerPurpose: true,
          collateralIsDwelling: true,
          servicingArrangement: "self_serviced",
        }),
      });
      expect(result.qualifies).toBe(true);
    });
  });

  // ── SKIPS (6 scenarios mapped to Beatrice's case table) ────────────────
  describe("skips with §-citation", () => {
    it("Beatrice case 1: seller-retained servicing → skip §1026.36(a)(4)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ servicingArrangement: "seller_retained" }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.skipReason).toContain("seller_retained");
      expect(result.citation).toContain("§1026.36(a)(4)");
    });

    it("Beatrice case 3: sub-serviced → skip §1024.2(b)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ servicingArrangement: "sub_serviced" }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.skipReason).toContain("sub_serviced");
      expect(result.citation).toContain("§1024.2(b)");
    });

    it("Beatrice case 5: passive holder → skip §1024.2(b)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ servicingArrangement: "passive_holder" }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.skipReason).toContain("passive_holder");
      expect(result.citation).toContain("§1024.2(b)");
    });

    it("Beatrice case 8: raw-land collateral, no dwelling → skip §1026.2(a)(19)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ collateralIsDwelling: false }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.skipReason).toContain("not a dwelling");
      expect(result.citation).toContain("§1026.2(a)(19)");
    });

    it("Beatrice case 10: business-purpose borrower (LLC commercial use) → skip §1026.3(a)", () => {
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ isConsumerPurpose: false }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.skipReason).toContain("business-purpose");
      expect(result.citation).toContain("§1026.3(a)");
    });

    it("Beatrice case 7-analog: out-of-scope row (tax-deed-style) — non-consumer + non-dwelling, consumer gate fires first", () => {
      // Predicate ordering: §1026.3(a) consumer gate fires before the
      // dwelling gate, so a row that's BOTH non-consumer AND non-dwelling
      // is reported as the business-purpose skip. This matches Beatrice's
      // decision-tree ordering (§3).
      const result = qualifiesForRegZStatementSync({
        kind: "acquired_note",
        row: acquiredNote({ isConsumerPurpose: false, collateralIsDwelling: false }),
      });
      expect(result.qualifies).toBe(false);
      expect(result.citation).toContain("§1026.3(a)");
    });
  });

  // ── INVARIANTS ─────────────────────────────────────────────────────────
  it("every skip has a non-empty citation (Beatrice §4 audit primitive)", () => {
    const skipShapes: AcquiredNote[] = [
      acquiredNote({ isConsumerPurpose: false }),
      acquiredNote({ collateralIsDwelling: false }),
      acquiredNote({ servicingArrangement: "passive_holder" }),
      acquiredNote({ servicingArrangement: "sub_serviced" }),
      acquiredNote({ servicingArrangement: "seller_retained" }),
    ];
    for (const row of skipShapes) {
      const result = qualifiesForRegZStatementSync({ kind: "acquired_note", row });
      expect(result.qualifies).toBe(false);
      expect(result.citation.length).toBeGreaterThan(0);
      expect(result.skipReason?.length).toBeGreaterThan(0);
    }
  });
});
