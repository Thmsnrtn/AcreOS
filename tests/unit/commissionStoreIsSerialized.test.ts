/**
 * W10.4 audit findings 1 + 2 — the commission store under concurrent closes,
 * and what an undo / re-close does to the money.
 *
 * Commission records live in ONE organization_integrations row per org (a JSON
 * list), so every write is read-modify-write of the whole list. A bulk close
 * runs N close hooks at once: each read the list before any wrote, so N closes
 * left ONE record — and each counted the same "prior deals in period", so
 * every agent was priced at the base tier. Every writer now runs under a
 * per-org advisory lock and reads through it.
 *
 * Driven through the REAL commissionService over tests/helpers/fakeDealsDb,
 * whose advisory lock is a real mutex and whose selects resolve after a delay
 * (so concurrent readers genuinely interleave, as two connections would).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});

type Svc = typeof import("../../server/services/commissionService");
let svc: Svc;

const ORG = 42;
const AGENT = 12;
/** Tiers by prior deals in the period: 0–1 → 3%, 2+ → 4%. */
const CONFIG = {
  tiers: [
    { minDeals: 0, ratePercent: 3, label: "Standard" },
    { minDeals: 2, ratePercent: 4, label: "Silver" },
  ],
  trackingPeriod: "annual" as const,
};

const integrations = () => F.h!.fake.rows("organization_integrations");
const stored = (): Array<Record<string, any>> => {
  const row = integrations().find((r) => r.provider === "commission_records");
  if (!row) return [];
  return (JSON.parse((row.credentials as { encrypted: string }).encrypted) as { records: Array<Record<string, any>> }).records;
};
const deal = (id: number, status = "closed") => F.h!.fake.rows("deals").push({ id, organizationId: ORG, status });
const setStatus = (id: number, status: string) => {
  F.h!.fake.rows("deals").find((d) => d.id === id)!.status = status;
};

beforeAll(async () => {
  svc = await import("../../server/services/commissionService");
});

beforeEach(() => {
  F.h!.fake.reset();
  integrations().push({
    id: 1,
    organizationId: ORG,
    provider: "commission_config",
    credentials: { encrypted: JSON.stringify({ config: CONFIG }) },
  });
});

describe("finding 1 — N concurrent closes record N commissions, at the right tiers", () => {
  it("a bulk close of four deals by one agent: four records, tiers counted inside the lock", async () => {
    // Every read resolves 5ms after it executes: without the lock all four
    // writers read the empty list before any of them writes.
    F.h!.fake.selectDelayMs = 5;
    for (const id of [1, 2, 3, 4]) deal(id);
    const closedAt = new Date("2026-06-01T00:00:00Z");
    await Promise.all(
      [1, 2, 3, 4].map((id) => svc.recordDealCommission(ORG, AGENT, id, 10_000_00, closedAt, { onlyIfDealClosed: true })),
    );
    const records = stored();
    expect(records.map((r) => r.dealId).sort()).toEqual([1, 2, 3, 4]);
    // The tier sequence each writer saw: 0, 1, 2, 3 prior deals → 3, 3, 4, 4.
    expect(records.map((r) => r.commissionRatePercent).sort()).toEqual([3, 3, 4, 4]);
    // ONE store row (the insert branch did not run twice).
    expect(integrations().filter((r) => r.provider === "commission_records")).toHaveLength(1);
    // Every writer took the per-org store lock.
    expect(F.h!.fake.lockLog.filter((l) => l === `acquire commission_records:${ORG}`)).toHaveLength(4);
  });

  it("a payment racing a new close loses neither", async () => {
    F.h!.fake.selectDelayMs = 5;
    deal(1);
    deal(2);
    const first = await svc.recordDealCommission(ORG, AGENT, 1, 10_000_00);
    await Promise.all([
      svc.recordCommissionPayment(ORG, first!.id, 100_00),
      svc.recordDealCommission(ORG, AGENT, 2, 20_000_00),
    ]);
    const records = stored();
    expect(records.map((r) => r.dealId).sort()).toEqual([1, 2]);
    expect(records.find((r) => r.dealId === 1)!.paidCents).toBe(100_00);
  });
});

describe("finding 2 — leaving closed reverses what is reversible; paid money is never reset", () => {
  it("undo of an unpaid commission removes it (nothing moved)", async () => {
    deal(7);
    await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    expect(stored()).toHaveLength(1);
    setStatus(7, "in_escrow");
    expect(await svc.retractDealCommission(ORG, 7, "Deal left closed (now in_escrow)")).toEqual({ removed: 1, flagged: 0 });
    expect(stored()).toEqual([]);
  });

  it("undo of a PAID commission keeps it, unchanged in amount, flagged for review", async () => {
    deal(7);
    const rec = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    await svc.recordCommissionPayment(ORG, rec!.id, 500_00);
    setStatus(7, "in_escrow");
    expect(await svc.retractDealCommission(ORG, 7, "Deal left closed (now in_escrow)")).toEqual({ removed: 0, flagged: 1 });
    const [kept] = stored();
    expect(kept).toMatchObject({ id: rec!.id, paidCents: 500_00, totalOwedCents: rec!.totalOwedCents, status: "partial" });
    expect(kept.reviewFlag).toMatchObject({ reason: "Deal left closed (now in_escrow)" });
  });

  it("a re-close never replaces a record that has payments", async () => {
    deal(7);
    const rec = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    await svc.recordCommissionPayment(ORG, rec!.id, 500_00);
    // closed → undo → closed, at a different price
    const again = await svc.recordDealCommission(ORG, AGENT, 7, 90_000_00, new Date(), { onlyIfDealClosed: true });
    expect(again!.id).toBe(rec!.id);
    const [only] = stored();
    expect(only).toMatchObject({ id: rec!.id, paidCents: 500_00, salePrice: 60_000_00 });
    expect(stored()).toHaveLength(1);
  });

  it("an unpaid record IS replaced by a re-close (idempotent per deal, current price)", async () => {
    deal(7);
    await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    await svc.recordDealCommission(ORG, AGENT, 7, 90_000_00);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ salePrice: 90_000_00, paidCents: 0 });
  });

  it("ordering: a reopen's retraction that runs after the deal closed again leaves the commission", async () => {
    deal(7); // closed again by the time the undo's hook runs
    await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    expect(await svc.retractDealCommission(ORG, 7, "late")).toEqual({ removed: 0, flagged: 0 });
    expect(stored()).toHaveLength(1);
  });

  it("ordering: a close hook that runs after the undo committed records nothing", async () => {
    deal(7, "in_escrow");
    expect(await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00, new Date(), { onlyIfDealClosed: true })).toBeNull();
    expect(stored()).toEqual([]);
  });
});

describe("re-audit — the lock body never needs a second connection; refusals are typed", () => {
  const saveSplit = () =>
    integrations().push({
      id: 2,
      organizationId: ORG,
      provider: "commission_split_config",
      credentials: {
        encrypted: JSON.stringify({ config: { agentSplitBps: 7000, annualCapCents: null, transactionFeeCents: null, franchiseFeeBps: null } }),
      },
    });

  it("a close with a saved split reads nothing through the global db while holding the store lock", async () => {
    // Pool of 5: a bulk close parks every connection on this lock; a holder
    // that then needs a sixth for the split config waits until it times out.
    saveSplit();
    deal(7);
    const rec = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00, new Date(), { onlyIfDealClosed: true });
    // Vacuity: the split path ran (the read under test happened).
    expect(rec).toMatchObject({ splitApplied: true, splitAgentNetCents: Math.round(60_000_00 * 0.03 * 0.7) });
    expect(F.h!.fake.globalDbUnderLock).toEqual([]);
    await svc.recordCommissionPayment(ORG, rec!.id, 100_00);
    setStatus(7, "in_escrow");
    F.h!.fake.lockLog = [];
    await svc.retractDealCommission(ORG, 7, "Deal left closed (now in_escrow)");
    // Vacuity: the retraction held the store lock.
    expect(F.h!.fake.lockLog.filter((l) => l === `acquire commission_records:${ORG}`)).toHaveLength(1);
    expect(F.h!.fake.globalDbUnderLock).toEqual([]);
  });

  it("a manual entry for a deal whose commission has payments is refused, not answered with the old record", async () => {
    deal(7);
    const rec = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    await svc.recordCommissionPayment(ORG, rec!.id, 500_00);
    await expect(svc.recordDealCommission(ORG, 99, 7, 90_000_00, undefined, { refuseIfPaid: true })).rejects.toBeInstanceOf(
      svc.CommissionAlreadyPaidError,
    );
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ id: rec!.id, teamMemberId: AGENT, paidCents: 500_00 });
  });

  it("a re-close clears the stale 'left closed' review flag on a paid record", async () => {
    deal(7);
    const rec = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00);
    await svc.recordCommissionPayment(ORG, rec!.id, 500_00);
    setStatus(7, "in_escrow");
    await svc.retractDealCommission(ORG, 7, "Deal left closed (now in_escrow)");
    expect(stored()[0].reviewFlag).toBeDefined();
    setStatus(7, "closed");
    const again = await svc.recordDealCommission(ORG, AGENT, 7, 60_000_00, new Date(), { onlyIfDealClosed: true });
    expect(again).toMatchObject({ id: rec!.id, paidCents: 500_00 });
    expect(again!.reviewFlag).toBeUndefined();
    expect(stored()[0].reviewFlag).toBeUndefined();
  });
});
