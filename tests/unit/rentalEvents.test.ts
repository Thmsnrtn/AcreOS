// Pins the buy-and-hold landlord lifecycle emitters (audit Wave 1, beta→core):
// the four landlord templates were dead until this emitter shipped. This test
// fixes the new truth — each event carries ONLY real fields, a null tenant email
// suppresses the recipient (never a fabricated address), ytdPaid / nextDueDate /
// lateFeeApplied are real or null, the dropped fabrications stay gone, and the
// two lease events fire together off one lease context.
//
// The rent + maintenance emitters resolve their payload from real joins, so the
// db is stubbed with a chainable mock routed by the select projection's keys
// (each resolver selects a distinctive column set). The lease emitter is pure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  emitRentalEvent: vi.fn(),
  rows: { current: {} as Record<string, any[]> },
}));

vi.mock("../../server/services/workflow-engine", () => ({
  emitRentalEvent: H.emitRentalEvent,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// A chainable db whose terminal `await` resolves to a result routed by the
// distinctive keys of the `.select({...})` projection each resolver uses.
vi.mock("../../server/db", () => {
  const pick = (keys: string[]): any[] => {
    const r = H.rows.current;
    if (keys.includes("address")) return r.property ?? [];
    if (keys.includes("name")) return r.org ?? [];
    if (keys.includes("cents")) return r.ytd ?? [];
    if (keys.includes("due")) return r.nextDue ?? [];
    if (keys.includes("lateFee")) return r.lateFee ?? [];
    if (keys.includes("firstName")) return r.tenant ?? [];
    return [];
  };
  const chain = (proj: any) => {
    const keys = proj ? Object.keys(proj) : [];
    const c: any = {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      then: (res: any, rej: any) => Promise.resolve(pick(keys)).then(res, rej),
    };
    return c;
  };
  return { db: { select: (proj: any) => chain(proj) } };
});

import {
  emitRentReceived,
  emitMaintenanceRequestReceived,
  emitLeaseExpiryEvents,
  type MaintenanceTicketRow,
  type ResolvedLeaseContext,
} from "../../server/services/rentalEvents";

/** Let the fire-and-forget async emitters drain their (already-resolved) reads. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  H.emitRentalEvent.mockClear();
  H.rows.current = {};
});
afterEach(() => vi.clearAllMocks());

describe("emitRentReceived (rent.received)", () => {
  const input = {
    organizationId: 7,
    leaseId: "lease_1",
    paymentId: "pay_1",
    propertyId: 42,
    amountCents: 140_000,
    receivedAt: "2026-05-15",
    rentChargeId: "rc_1",
    rentPeriodMonth: "2026-05-01",
  };

  it("fires with only real fields (cents → dollars, real YTD sum, next open charge)", async () => {
    H.rows.current = {
      tenant: [{ firstName: "Maria", lastName: "Vasquez", email: "maria@example.com" }],
      property: [{ address: "12 Oak St, Unit 3B" }],
      org: [{ name: "Cedar Property Co" }],
      ytd: [{ cents: "700000" }],
      nextDue: [{ due: "2026-06-01" }],
      lateFee: [{ lateFee: 0 }],
    };
    emitRentReceived(input);
    await flush();

    expect(H.emitRentalEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = H.emitRentalEvent.mock.calls[0];
    expect(event).toBe("rent.received");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42); // properties.id — the numeric entity handle
    expect(data.rentAmount).toBe(1_400);
    expect(data.rentPeriodLabel).toBe("May 2026");
    expect(data.ytdPaid).toBe(7_000); // REAL sum, cents → dollars
    expect(data.nextDueDate).toBe("2026-06-01");
    expect(data.tenantName).toBe("Maria Vasquez");
    expect(data.tenantEmail).toBe("maria@example.com");
    expect(data.propertyAddress).toBe("12 Oak St, Unit 3B");
    expect(data.orgName).toBe("Cedar Property Co");
    expect(data.lateFeeApplied).toBe(false);
    expect(data.leaseId).toBe("lease_1");
    expect(data.paymentId).toBe("pay_1");
  });

  it("a null tenant email omits the recipient (null), never fabricates one", async () => {
    H.rows.current = {
      tenant: [{ firstName: "Maria", lastName: "Vasquez", email: null }],
      property: [{ address: "12 Oak St" }],
      org: [{ name: "Cedar" }],
      ytd: [{ cents: "0" }],
      nextDue: [],
      lateFee: [{ lateFee: 0 }],
    };
    emitRentReceived(input);
    await flush();
    const [, , , data] = H.emitRentalEvent.mock.calls[0];
    expect(data.tenantEmail).toBeNull(); // {{tenantEmail}} → blank → recipient suppressed
    expect(data.tenantName).toBe("Maria Vasquez");
  });

  it("reflects a REAL applied late fee (rent_charges.late_fee_cents > 0)", async () => {
    H.rows.current = {
      tenant: [], property: [], org: [], ytd: [{ cents: "140000" }],
      nextDue: [], lateFee: [{ lateFee: 2500 }],
    };
    emitRentReceived(input);
    await flush();
    expect(H.emitRentalEvent.mock.calls[0][3].lateFeeApplied).toBe(true);
  });

  it("an unlinked tenant / unapplied credit pass through as null, never guessed", async () => {
    H.rows.current = {
      tenant: [], property: [], org: [], ytd: [{ cents: "0" }], nextDue: [], lateFee: [],
    };
    emitRentReceived({ ...input, rentChargeId: null, rentPeriodMonth: null });
    await flush();
    const [, , , data] = H.emitRentalEvent.mock.calls[0];
    expect(data.tenantName).toBeNull();
    expect(data.tenantEmail).toBeNull();
    expect(data.rentPeriodLabel).toBeNull();
    expect(data.nextDueDate).toBeNull();
    expect(data.lateFeeApplied).toBe(false); // no charge → nothing to be late against
    expect(data.propertyAddress).toBeNull();
    // The amount is always real — a payment has an amount.
    expect(data.rentAmount).toBe(1_400);
  });
});

describe("emitMaintenanceRequestReceived (maintenance.request_received)", () => {
  const ticket = (over: Partial<MaintenanceTicketRow> = {}): MaintenanceTicketRow => ({
    id: "tkt_1",
    organizationId: 7,
    propertyId: 42,
    submittedByTenantId: "ten_1",
    title: "Kitchen sink leaking",
    description: "Water pooling under the disposal since this morning",
    category: "plumbing",
    severity: "urgent",
    ...over,
  });

  it("binds the REAL severity enum as urgencyLevel; the dropped fabrications stay gone", async () => {
    H.rows.current = {
      tenant: [{ firstName: "Dana", lastName: "Kim", email: "dana@example.com" }],
      property: [{ address: "88 Pine Ave" }],
      org: [{ name: "Cedar Property Co" }],
    };
    emitMaintenanceRequestReceived(ticket());
    await flush();

    expect(H.emitRentalEvent).toHaveBeenCalledTimes(1);
    const [event, orgId, entityId, data] = H.emitRentalEvent.mock.calls[0];
    expect(event).toBe("maintenance.request_received");
    expect(orgId).toBe(7);
    expect(entityId).toBe(42);
    expect(data.ticketId).toBe("tkt_1");
    expect(data.urgencyLevel).toBe("urgent"); // real maintenance_tickets.severity
    expect(data.requestCategory).toBe("plumbing");
    expect(data.requestDescription).toBe("Water pooling under the disposal since this morning");
    expect(data.tenantName).toBe("Dana Kim");
    expect(data.tenantEmail).toBe("dana@example.com");
    expect(data.propertyAddress).toBe("88 Pine Ave");
    expect(data.orgName).toBe("Cedar Property Co");
    // The dropped fabrications never appear.
    expect(data.urgencyRationale).toBeUndefined();
    expect(data.suggestedVendor).toBeUndefined();
    expect(data.estimatedCost).toBeUndefined();
    expect(data.responseTimeSla).toBeUndefined();
  });

  it("falls back to the title when there is no description, leaves an uncategorised ticket null", async () => {
    H.rows.current = { tenant: [], property: [], org: [] };
    emitMaintenanceRequestReceived(ticket({ description: null, category: null }));
    await flush();
    const data = H.emitRentalEvent.mock.calls[0][3];
    expect(data.requestDescription).toBe("Kitchen sink leaking"); // fell back to title
    expect(data.requestCategory).toBeNull(); // uncategorised → null, not a guess
  });

  it("a landlord-logged ticket (no tenant) suppresses the acknowledgment recipient", async () => {
    H.rows.current = { tenant: [], property: [{ address: "88 Pine Ave" }], org: [{ name: "Cedar" }] };
    emitMaintenanceRequestReceived(ticket({ submittedByTenantId: null }));
    await flush();
    const data = H.emitRentalEvent.mock.calls[0][3];
    expect(data.tenantName).toBeNull();
    expect(data.tenantEmail).toBeNull(); // {{tenantEmail}} → blank, never fabricated
  });
});

describe("emitLeaseExpiryEvents (lease.renewal_countdown_60d + lease.expiring_60d)", () => {
  const leaseCtx = (over: Partial<ResolvedLeaseContext> = {}): ResolvedLeaseContext => ({
    organizationId: 7,
    propertyId: 42,
    leaseId: "lease_9",
    endDate: "2026-10-31",
    monthlyRentCents: 185_000,
    state: "TX",
    tenant: { name: "Sam Ortiz", email: "sam@example.com" },
    propertyAddress: "5 Birch Ct",
    orgName: "Cedar Property Co",
    ...over,
  });

  it("emits BOTH events, entityId = propertyId, only real lease fields (no comps)", () => {
    emitLeaseExpiryEvents(leaseCtx());
    expect(H.emitRentalEvent).toHaveBeenCalledTimes(2);
    const events = H.emitRentalEvent.mock.calls.map((c) => c[0]);
    expect(events).toContain("lease.renewal_countdown_60d");
    expect(events).toContain("lease.expiring_60d");
    for (const [, orgId, entityId, data] of H.emitRentalEvent.mock.calls) {
      expect(orgId).toBe(7);
      expect(entityId).toBe(42); // properties.id
      expect(data.currentRent).toBe(1_850); // monthly_rent_cents → dollars
      expect(data.leaseEndDate).toBe("2026-10-31");
      expect(data.state).toBe("TX");
      expect(data.leaseId).toBe("lease_9");
      // The dropped residential-comps fabrications never appear.
      expect(data.marketRent).toBeUndefined();
      expect(data.suggestedRenewalRent).toBeUndefined();
      expect(data.rentChangePct).toBeUndefined();
      expect(data.renewalTermMonths).toBeUndefined();
      expect(data.renewalDecisionDeadline).toBeUndefined();
      expect(data.stateNoticeDays).toBeUndefined();
    }
  });

  it("a null tenant email suppresses the renewal recipient", () => {
    emitLeaseExpiryEvents(leaseCtx({ tenant: { name: "Sam Ortiz", email: null } }));
    const data = H.emitRentalEvent.mock.calls[0][3];
    expect(data.tenantEmail).toBeNull();
    expect(data.tenantName).toBe("Sam Ortiz");
  });
});
