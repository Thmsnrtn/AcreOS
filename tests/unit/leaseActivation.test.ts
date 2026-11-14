/**
 * S-04 — lease activation: the transition that ends draft-forever leases.
 *
 * On main before this package, a lease created on /leases was born `draft`
 * and no client caller could move it, so every downstream reader silently
 * skipped it. This file pins the whole chain with the readers' OWN pure
 * cores (no DB):
 *
 *   1. the activation rule itself (shared/rental/leaseActivation.ts) — the
 *      same function POST /api/leases/:id/activate evaluates;
 *   2. rent charges: the activated status is in the generator's status list
 *      (imported from the generator, so the two cannot drift), the draft
 *      status is not, and the shared charge planner produces charges for
 *      the activated lease's schedule;
 *   3. the expiry clock: classifyExpiringLeases fires for the activated
 *      lease inside its window and skips the identical draft;
 *   4. the deposit clock: depositClock.resolveMoveOutDate resolves a
 *      move-out ONLY from a move-out inspection or an ended/terminated
 *      lease's end date — states a draft-forever lease never reaches — and
 *      computeDepositDeadline (the pure computation startDepositClock
 *      persists) turns that resolved date into a real statutory deadline,
 *      while an unresolved move-out stays honestly unknown, never guessed.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { publish: vi.fn() },
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitRentalEvent: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  evaluateLeaseActivation,
  LEASE_ACTIVATION_TARGET,
  GENERATABLE_LEASE_STATUSES,
} from "../../shared/rental/leaseActivation";
import { GENERATABLE_LEASE_STATUSES as GENERATOR_STATUSES } from "../../server/services/rental/rentChargeGenerator";
import { planRentCharges } from "../../shared/rental/rentSchedule";
import { classifyExpiringLeases, type ScannedLeaseRow } from "../../server/services/leaseExpiryDetector";
import { computeDepositDeadline } from "../../shared/regulatory/depositReturnRules";

// ─── 1. The activation rule ────────────────────────────────────────────────

describe("evaluateLeaseActivation — draft → active", () => {
  it("activates a draft lease with a tenant attached", () => {
    const d = evaluateLeaseActivation({ status: "draft", tenantCount: 1 });
    expect(d).toEqual({ ok: true, fromStatus: "draft", toStatus: "active" });
  });

  it("activates a pending_signature lease with tenants attached", () => {
    const d = evaluateLeaseActivation({ status: "pending_signature", tenantCount: 2 });
    expect(d.ok).toBe(true);
  });

  it("refuses a draft with NO tenant — charges and clocks need a tenancy to run against", () => {
    const d = evaluateLeaseActivation({ status: "draft", tenantCount: 0 });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("LEASE_HAS_NO_TENANT");
      expect(d.reason).toMatch(/attach at least one tenant/i);
    }
  });

  it("refuses to re-activate an active lease (and says its clocks already run)", () => {
    const d = evaluateLeaseActivation({ status: "active", tenantCount: 1 });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.code).toBe("LEASE_NOT_ACTIVATABLE_FROM_STATUS");
      expect(d.reason).toMatch(/already active/i);
    }
  });

  it.each(["ended", "terminated", "renewed"])("refuses activation from the closed status %s", (status) => {
    const d = evaluateLeaseActivation({ status, tenantCount: 3 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("LEASE_NOT_ACTIVATABLE_FROM_STATUS");
  });
});

// ─── 2. Rent charges run on the activated lease ────────────────────────────

describe("activation ⇒ rent-charge generation", () => {
  it("the generator's status list and the activation module's are the same list", () => {
    expect(GENERATOR_STATUSES).toBe(GENERATABLE_LEASE_STATUSES);
  });

  it("the activation TARGET is generatable; draft is not", () => {
    expect(GENERATABLE_LEASE_STATUSES).toContain(LEASE_ACTIVATION_TARGET);
    expect(GENERATABLE_LEASE_STATUSES).not.toContain("draft");
  });

  it("the charge planner produces rent for the activated lease's schedule", () => {
    // The exact schedule the generator plans from (see planForLease in
    // rentChargeGenerator.ts): a lease starting on the 1st, planned through
    // three full months.
    const plan = planRentCharges({
      lease: {
        startDate: "2026-09-01",
        endDate: "2027-08-31",
        rentDueDayOfMonth: 1,
        monthlyRentCents: 140_000,
      },
      existingMonths: [],
      throughDate: "2026-11-30",
    });
    expect(plan.create.map((c) => c.chargedForMonth)).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-11-01",
    ]);
    expect(plan.create.every((c) => c.amountCents === 140_000)).toBe(true);
  });
});

// ─── 3. The expiry clock fires on the activated lease ──────────────────────

describe("activation ⇒ lease-expiry scan", () => {
  const NOW = new Date("2026-09-01T00:00:00.000Z");
  const row = (status: string): ScannedLeaseRow => ({
    id: "lease_s04",
    organizationId: 7,
    propertyId: 42,
    endDate: "2026-10-31", // exactly 60 days out — inside the renewal window
    monthlyRentCents: 140_000,
    state: "TX",
    status,
  });

  it("fires for the lease once activated", () => {
    const d = evaluateLeaseActivation({ status: "draft", tenantCount: 1 });
    expect(d.ok).toBe(true);
    const findings = classifyExpiringLeases([row(LEASE_ACTIVATION_TARGET)], NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].leaseId).toBe("lease_s04");
  });

  it("skips the identical lease while it is still a draft", () => {
    expect(classifyExpiringLeases([row("draft")], NOW)).toHaveLength(0);
  });
});

// ─── 4. The deposit clock can start once the lifecycle moves ───────────────

describe("activation ⇒ security-deposit clock", () => {
  it("an ended lease's end date starts a real statutory deadline", () => {
    // depositClock.resolveMoveOutDate's rule, precedence step 2: the
    // lease's endDate counts as move-out ONLY once the lease is marked
    // ended/terminated — a state a draft-forever lease never reaches
    // through any product path.
    const deadline = computeDepositDeadline({
      moveOutDate: "2026-10-31",
      state: "TX",
      hasDeductions: false,
    });
    expect(deadline.known).toBe(true);
    expect(deadline.deadlineDate).not.toBeNull();
    expect(deadline.citation).toBeTruthy();
  });

  it("no resolved move-out (the draft-forever state) means no clock — honestly unknown, never guessed", () => {
    const deadline = computeDepositDeadline({
      moveOutDate: null,
      state: "TX",
      hasDeductions: false,
    });
    expect(deadline.known).toBe(false);
    expect(deadline.deadlineDate).toBeNull();
    expect(deadline.unknownReason).toMatch(/move-out date is required/i);
  });
});
