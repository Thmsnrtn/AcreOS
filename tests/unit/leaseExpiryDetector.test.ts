/**
 * Lease-expiry detector (audit Wave 1, buy_and_hold beta→core).
 *
 * Pins the PURE decision core of the daily lease-expiry scan (mirrors
 * notePaymentDueDetector's shape): the ~60-day window, the null-endDate /
 * non-active skips, the per-(lease, endDate) idempotency key so a daily rerun
 * never re-emits, and that a qualifying lease fires BOTH lease workflow events.
 *
 * Pure functions only — no DB. The db / eventMeshPublisher / workflow-engine
 * modules the SUT imports at load are stubbed so importing it opens no
 * connection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { emitRentalEvent } = vi.hoisted(() => ({ emitRentalEvent: vi.fn() }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { publish: vi.fn() },
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitRentalEvent }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  classifyExpiringLeases,
  selectNewFindings,
  RENEWAL_WINDOW_DAYS,
  LEASE_EXPIRY_CHANNEL,
  type ScannedLeaseRow,
} from "../../server/services/leaseExpiryDetector";
import {
  emitLeaseExpiryEvents,
  type ResolvedLeaseContext,
} from "../../server/services/rentalEvents";

// 2026-09-01: an active lease ending 2026-10-31 is exactly 60 days out.
const NOW = new Date("2026-09-01T00:00:00.000Z");

function lease(over: Partial<ScannedLeaseRow> = {}): ScannedLeaseRow {
  return {
    id: "lease_a",
    organizationId: 7,
    propertyId: 42,
    endDate: "2026-10-31",
    monthlyRentCents: 185_000,
    state: "TX",
    status: "active",
    ...over,
  };
}

afterEach(() => emitRentalEvent.mockClear());

describe("classifyExpiringLeases — window", () => {
  it("fires for an active lease ~60 days from its end date", () => {
    const f = classifyExpiringLeases([lease()], NOW);
    expect(f).toHaveLength(1);
    expect(f[0].leaseId).toBe("lease_a");
    expect(f[0].daysUntilEnd).toBe(RENEWAL_WINDOW_DAYS); // exactly 60
    expect(f[0].endDate).toBe("2026-10-31");
    expect(f[0].dedupeKey).toBe("lease-expiry:lease_a:2026-10-31");
  });

  it("fires anywhere inside the window (a mid-window lease still fires once)", () => {
    const f = classifyExpiringLeases([lease({ endDate: "2026-09-11" })], NOW); // 10 days out
    expect(f).toHaveLength(1);
    expect(f[0].daysUntilEnd).toBe(10);
  });

  it("does NOT fire before the window (more than 60 days out)", () => {
    expect(classifyExpiringLeases([lease({ endDate: "2026-11-15" })], NOW)).toHaveLength(0);
  });

  it("does NOT fire for a lease already past its end date", () => {
    expect(classifyExpiringLeases([lease({ endDate: "2026-08-01" })], NOW)).toHaveLength(0);
  });
});

describe("classifyExpiringLeases — skips", () => {
  it("skips month-to-month leases (null end date — no end, no signal)", () => {
    expect(classifyExpiringLeases([lease({ endDate: null })], NOW)).toHaveLength(0);
  });

  it("skips non-active leases even inside the window", () => {
    expect(classifyExpiringLeases([lease({ status: "draft" })], NOW)).toHaveLength(0);
    expect(classifyExpiringLeases([lease({ status: "ended" })], NOW)).toHaveLength(0);
    expect(classifyExpiringLeases([lease({ status: "terminated" })], NOW)).toHaveLength(0);
  });
});

describe("dedupe per (leaseId, endDate)", () => {
  it("the key is stable across runs and selectNewFindings drops an already-published finding", () => {
    // Run 1 → a fresh finding is new and would publish + emit.
    const run1 = classifyExpiringLeases([lease()], NOW);
    const publishedAfterRun1 = new Set(run1.map((f) => f.dedupeKey));
    expect(selectNewFindings(run1, publishedAfterRun1)).toHaveLength(0);

    // Run 2 the next day (still in-window) produces the SAME key → not re-emitted.
    const run2 = classifyExpiringLeases([lease()], new Date("2026-09-02T00:00:00.000Z"));
    expect(run2[0].dedupeKey).toBe(run1[0].dedupeKey);
    expect(selectNewFindings(run2, publishedAfterRun1)).toHaveLength(0);
  });

  it("a genuinely new lease (different key) is not suppressed", () => {
    const run1 = classifyExpiringLeases([lease()], NOW);
    const published = new Set(run1.map((f) => f.dedupeKey));
    const other = classifyExpiringLeases([lease({ id: "lease_b" })], NOW);
    expect(selectNewFindings(other, published)).toHaveLength(1);
  });

  it("channel constant is the lease-expiry channel", () => {
    expect(LEASE_EXPIRY_CHANNEL).toBe("lease:expiry");
  });
});

describe("a qualifying lease fires BOTH lease events", () => {
  it("emits lease.renewal_countdown_60d AND lease.expiring_60d for a finding", () => {
    const finding = classifyExpiringLeases([lease()], NOW)[0];
    const ctx: ResolvedLeaseContext = {
      organizationId: finding.orgId,
      propertyId: finding.propertyId,
      leaseId: finding.leaseId,
      endDate: finding.endDate,
      monthlyRentCents: finding.row.monthlyRentCents,
      state: finding.row.state,
      tenant: { name: "Sam Ortiz", email: "sam@example.com" },
      propertyAddress: "5 Birch Ct",
      orgName: "Cedar Property Co",
    };
    emitLeaseExpiryEvents(ctx);
    expect(emitRentalEvent).toHaveBeenCalledTimes(2);
    const events = emitRentalEvent.mock.calls.map((c) => c[0]);
    expect(events).toContain("lease.renewal_countdown_60d");
    expect(events).toContain("lease.expiring_60d");
    // entityId is the property (numeric handle); the lease uuid rides in data.
    for (const call of emitRentalEvent.mock.calls) {
      expect(call[2]).toBe(42);
      expect(call[3].leaseId).toBe("lease_a");
    }
  });
});
