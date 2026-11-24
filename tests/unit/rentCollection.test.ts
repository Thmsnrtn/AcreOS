/**
 * P3-3 rent collection (decided 2026-11-16) — the pure decision cores.
 *
 * Pins:
 *   1. The scheduler's amount math is the LEASE's: the existing planner
 *      (shared/rental/rentSchedule) is the charge engine; this suite pins
 *      that the cycle's late half derives what is owed from the charge
 *      columns (amount + lateFee − paid), never the stored balance cache.
 *   2. NO CUSTODY: the rent checkout params carry no platform-take key at
 *      any depth, name the LANDLORD as collector, and dispatch on
 *      metadata.type === "rent_payment"; prepareCustomerMoneyCall scopes
 *      the call to the org's OWN account and throws on a take or an
 *      unscoped call.
 *   3. The posting rule's session gate: unpaid sessions, sessions for a
 *      different lease/org, and amount-less sessions are refused before
 *      any write.
 *   4. The late-rent trigger: a charge is late only when it still owes
 *      (derived), its due date is strictly past, and grace (lease's own,
 *      else state rule, else 0) has run out; the dedupe key is stable per
 *      (charge, dueDate) so a daily rerun never re-fires.
 *
 * Pure functions only — no DB. The db / mesh / workflow modules the SUTs
 * import at load are stubbed so importing them opens no connection.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {}, withTransaction: vi.fn() }));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { publish: vi.fn() },
}));
vi.mock("../../server/services/workflow-engine", () => ({
  emitRentalEvent: vi.fn(),
  emitPaymentEvent: vi.fn(),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: {} }));

import {
  outstandingCentsForCharge,
  totalOutstandingCents,
  rentSessionRefusal,
  type RentCheckoutSession,
} from "../../server/services/rental/rentCollection";
import {
  classifyLateRentCharges,
  selectNewLateFindings,
  RENT_LATE_CHANNEL,
  type LateRentChargeRow,
} from "../../server/services/rentCycle";
import {
  buildRentCardCheckoutParams,
  prepareCustomerMoneyCall,
  PlatformTakeError,
  UnscopedCustomerMoneyCallError,
} from "../../server/services/customerMoneyRouting";
import { planRentCharges } from "../../shared/rental/rentSchedule";

// ── 0. The scheduler — charges come from the lease's own terms ────────────
// The daily cycle (rentCycle.ts half 1) runs the generator whose planner is
// planRentCharges; these pins are the cycle's contract: amount and due date
// are the lease's, full periods only, and a rerun plans nothing new.

describe("planRentCharges — the scheduler's planner", () => {
  const lease = {
    startDate: "2026-10-01",
    endDate: null,
    rentDueDayOfMonth: 5,
    monthlyRentCents: 140_000,
    scheduleSteps: [],
    isSection8: false,
    hapPortionCents: null,
    tenantPortionCents: null,
  };

  it("plans each full month at the lease's rent, due on the lease's due day", () => {
    const plan = planRentCharges({ lease, existingMonths: [], throughDate: "2026-11-18" });
    expect(plan.create.map((c) => [c.chargedForMonth, c.dueDate, c.amountCents])).toEqual([
      ["2026-10-01", "2026-10-05", 140_000],
      ["2026-11-01", "2026-11-05", 140_000],
    ]);
  });

  it("a rerun over the same horizon plans nothing (idempotent at the planner)", () => {
    const plan = planRentCharges({
      lease,
      existingMonths: ["2026-10-01", "2026-11-01"],
      throughDate: "2026-11-18",
    });
    expect(plan.create).toHaveLength(0);
  });

  it("does not plan a month whose start is past the horizon", () => {
    const plan = planRentCharges({ lease, existingMonths: [], throughDate: "2026-10-15" });
    expect(plan.create.map((c) => c.chargedForMonth)).toEqual(["2026-10-01"]);
  });
});

// ── 1. What is owed — derived, never the stored cache ─────────────────────

describe("outstandingCentsForCharge", () => {
  it("derives amount + lateFee − paid", () => {
    expect(
      outstandingCentsForCharge({ amountCents: 140_000, lateFeeCents: 5_000, paidCents: 70_000 }),
    ).toBe(75_000);
  });

  it("a fully paid charge owes nothing, and overpayment never goes negative", () => {
    expect(
      outstandingCentsForCharge({ amountCents: 140_000, lateFeeCents: 0, paidCents: 140_000 }),
    ).toBe(0);
    expect(
      outstandingCentsForCharge({ amountCents: 140_000, lateFeeCents: 0, paidCents: 150_000 }),
    ).toBe(0);
  });

  it("totalOutstandingCents sums only what is still owed", () => {
    expect(
      totalOutstandingCents([
        { amountCents: 140_000, lateFeeCents: 0, paidCents: 140_000 },
        { amountCents: 140_000, lateFeeCents: 2_500, paidCents: 0 },
      ]),
    ).toBe(142_500);
  });
});

// ── 2. No custody — the checkout params and the chokepoint ────────────────

const CHECKOUT_INPUT = {
  leaseId: "lease_1",
  organizationId: 7,
  landlordName: "Cedar Property Co",
  tenantName: "Sam Ortiz",
  tenantEmail: "sam@example.com",
  amountCents: 140_000,
  baseUrl: "https://app.example",
};

describe("buildRentCardCheckoutParams — no custody by construction", () => {
  it("names the landlord as collector and carries the dispatch metadata", () => {
    const params = buildRentCardCheckoutParams(CHECKOUT_INPUT);
    expect(params.metadata?.type).toBe("rent_payment");
    expect(params.metadata?.leaseId).toBe("lease_1");
    expect(params.metadata?.organizationId).toBe("7");
    const item = params.line_items?.[0] as any;
    expect(item.price_data.unit_amount).toBe(140_000);
    expect(item.price_data.product_data.name).toContain("Cedar Property Co");
    expect(item.price_data.product_data.description).toContain("does not take a cut");
  });

  it("contains no platform-take key at any depth", () => {
    const params = buildRentCardCheckoutParams(CHECKOUT_INPUT) as any;
    const banned = ["application_fee_amount", "application_fee_percent", "transfer_data", "on_behalf_of"];
    const walk = (v: any) => {
      if (v === null || typeof v !== "object") return;
      for (const [k, val] of Object.entries(v)) {
        expect(banned).not.toContain(k);
        walk(val);
      }
    };
    walk(params);
  });
});

describe("prepareCustomerMoneyCall — the rent call is scoped, or it throws", () => {
  it("scopes the rent checkout to the landlord's OWN account", () => {
    const { options } = prepareCustomerMoneyCall(
      "rent.card.checkout.session",
      buildRentCardCheckoutParams(CHECKOUT_INPUT),
      { accountId: "acct_landlord_1" },
    );
    expect(options.stripeAccount).toBe("acct_landlord_1");
  });

  it("throws when a platform take is smuggled into the params", () => {
    const poisoned = {
      ...buildRentCardCheckoutParams(CHECKOUT_INPUT),
      payment_intent_data: { application_fee_amount: 100 },
    } as any;
    expect(() =>
      prepareCustomerMoneyCall("rent.card.checkout.session", poisoned, { accountId: "acct_landlord_1" }),
    ).toThrow(PlatformTakeError);
  });

  it("throws on an unscoped call — there is no platform fallback", () => {
    expect(() =>
      prepareCustomerMoneyCall(
        "rent.card.checkout.session",
        buildRentCardCheckoutParams(CHECKOUT_INPUT),
        { accountId: "" } as any,
      ),
    ).toThrow(UnscopedCustomerMoneyCallError);
  });
});

// ── 3. The posting rule's session gate ────────────────────────────────────

function session(over: Partial<RentCheckoutSession> = {}): RentCheckoutSession {
  return {
    id: "cs_test_1",
    amount_total: 140_000,
    payment_status: "paid",
    metadata: { leaseId: "lease_1", organizationId: "7", type: "rent_payment" },
    payment_intent: "pi_1",
    ...over,
  } as RentCheckoutSession;
}

describe("rentSessionRefusal", () => {
  const expected = { leaseId: "lease_1", organizationId: 7 };

  it("accepts a paid session for this lease and org", () => {
    expect(rentSessionRefusal(session(), expected)).toBeNull();
  });

  it("refuses an unpaid session (delayed-notification methods complete unpaid)", () => {
    expect(rentSessionRefusal(session({ payment_status: "unpaid" }), expected)).toBe(
      "payment_not_completed",
    );
  });

  it("refuses a session naming a different lease or org", () => {
    expect(
      rentSessionRefusal(session({ metadata: { leaseId: "lease_2", organizationId: "7" } }), expected),
    ).toBe("session_not_for_lease");
    expect(
      rentSessionRefusal(session({ metadata: { leaseId: "lease_1", organizationId: "9" } }), expected),
    ).toBe("session_not_for_lease");
  });

  it("refuses a paid session with no amount", () => {
    expect(rentSessionRefusal(session({ amount_total: null }), expected)).toBe("amount_missing");
    expect(rentSessionRefusal(session({ amount_total: 0 }), expected)).toBe("amount_missing");
  });
});

// ── 4. The late-rent trigger ──────────────────────────────────────────────

// 2026-11-18 (Wednesday): a charge due 2026-11-01 is 17 days past due.
const NOW = new Date("2026-11-18T09:00:00.000Z");

function charge(over: Partial<LateRentChargeRow> = {}): LateRentChargeRow {
  return {
    id: "charge_1",
    organizationId: 7,
    leaseId: "lease_1",
    dueDate: "2026-11-01",
    amountCents: 140_000,
    lateFeeCents: 0,
    paidCents: 0,
    balanceCents: 140_000,
    legalPosture: "ok",
    leaseGraceDays: null,
    stateGraceDays: null,
    ...over,
  };
}

describe("classifyLateRentCharges", () => {
  it("fires for an unpaid charge past due with no grace", () => {
    const f = classifyLateRentCharges([charge()], NOW);
    expect(f).toHaveLength(1);
    expect(f[0].daysPastDue).toBe(17);
    expect(f[0].outstandingCents).toBe(140_000);
    expect(f[0].dedupeKey).toBe("rent-late:charge_1:2026-11-01");
    expect(RENT_LATE_CHANNEL).toBe("rent:late");
  });

  it("does NOT fire on the due day itself, or before it", () => {
    expect(classifyLateRentCharges([charge({ dueDate: "2026-11-18" })], NOW)).toHaveLength(0);
    expect(classifyLateRentCharges([charge({ dueDate: "2026-12-01" })], NOW)).toHaveLength(0);
  });

  it("does NOT fire for a paid charge, even long past due", () => {
    expect(classifyLateRentCharges([charge({ paidCents: 140_000, balanceCents: 0 })], NOW)).toHaveLength(0);
  });

  it("a partial payment leaves the charge late on the DERIVED remainder (stored balance cache ignored)", () => {
    // Stored cache claims 0 (the old max(0,…) corruption shape); the derived
    // remainder is 70_000, so the charge is still late.
    const f = classifyLateRentCharges(
      [charge({ paidCents: 70_000, balanceCents: 0 })],
      NOW,
    );
    expect(f).toHaveLength(1);
    expect(f[0].outstandingCents).toBe(70_000);
  });

  it("grace: the lease's own grace wins over the state rule; inside grace is not late", () => {
    // Due 2026-11-10 → 8 days past due. Lease grace 10 → not late.
    expect(
      classifyLateRentCharges([charge({ dueDate: "2026-11-10", leaseGraceDays: 10, stateGraceDays: 2 })], NOW),
    ).toHaveLength(0);
    // Same charge, lease silent, state grace 2 → late, grace recorded as 2.
    const f = classifyLateRentCharges(
      [charge({ dueDate: "2026-11-10", leaseGraceDays: null, stateGraceDays: 2 })],
      NOW,
    );
    expect(f).toHaveLength(1);
    expect(f[0].graceDays).toBe(2);
    // Exactly AT the grace boundary is still inside grace.
    expect(
      classifyLateRentCharges([charge({ dueDate: "2026-11-16", leaseGraceDays: 2 })], NOW),
    ).toHaveLength(0);
  });

  it("dedupe: the key is stable across runs and selectNewLateFindings drops a published finding", () => {
    const run1 = classifyLateRentCharges([charge()], NOW);
    const published = new Set(run1.map((f) => f.dedupeKey));
    const run2 = classifyLateRentCharges([charge()], new Date("2026-11-19T09:00:00.000Z"));
    expect(run2[0].dedupeKey).toBe(run1[0].dedupeKey);
    expect(selectNewLateFindings(run2, published)).toHaveLength(0);
    // A different charge is a new fact and is not suppressed.
    const other = classifyLateRentCharges([charge({ id: "charge_2" })], NOW);
    expect(selectNewLateFindings(other, published)).toHaveLength(1);
  });
});
