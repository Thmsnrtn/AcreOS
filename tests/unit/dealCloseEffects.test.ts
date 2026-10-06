/**
 * W10.4 contract item 1 — every close side effect formerly inline in PUT
 * /api/deals/:id still happens, from recordDealClose, with the SAME gates and
 * the SAME dedupe keys. (oneCloseWriter.test.ts proves it is reached once from
 * every writer; this proves what it does when reached.)
 *
 * Ported from the PUT-side behaviour, gate by gate:
 *   - won and lost both calibrate and snapshot (deal_outcome closed_won /
 *     closed_lost) and pair lead_conversion (converted / dismissed);
 *   - only a won DISPOSITION pairs avm_vs_actual and records the training row,
 *     keyed `deal:<closedSaleDealKey>`, inside the per-deal lock;
 *   - the commission only with an assigned agent, a positive amount, a client
 *     book and an explicitly saved config — args (orgId, agent, dealId, cents);
 *   - first_deal_closed carries the acting user when there is one, null when
 *     there is not (never invented);
 *   - team event, conversion, outcome telemetry, market network and pattern
 *     fingerprint on a won close only;
 *   - no transition, nothing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  calibrate: vi.fn(async () => undefined),
  referral: vi.fn(async () => undefined),
  snapshot: vi.fn(),
  pair: vi.fn(),
  team: vi.fn(async () => undefined),
  hasConfig: vi.fn(async () => true),
  commission: vi.fn(async () => undefined),
  conversion: vi.fn(async () => undefined),
  activation: vi.fn(),
  evidence: vi.fn(),
  contribute: vi.fn(async () => ({ contributed: true, reason: "" })),
  pattern: vi.fn(async () => undefined),
  train: vi.fn(async () => "1"),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});
vi.mock("../../server/services/outcomeCalibrationLoop", () => ({ onDealClosed: F.calibrate }));
vi.mock("../../server/services/referralReward", () => ({ recordReferralShareMoment: F.referral }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: F.snapshot, pairOutcomeAsync: F.pair }));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({ dispatchTeamEvent: F.team }));
vi.mock("../../server/services/commissionService", () => ({ hasCommissionConfig: F.hasConfig, recordDealCommission: F.commission }));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: { recordConversion: F.conversion } }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: F.activation }));
vi.mock("../../server/services/marketNetworkContributor", () => ({
  closedSaleEvidence: F.evidence,
  closedSaleDealKey: (o: number, d: number) => `key-${o}-${d}`,
  contributeClosedDealToNetwork: F.contribute,
}));
vi.mock("../../server/services/acreOSValuation", () => ({
  acreOSValuation: { recordTransactionForTraining: F.train, retractTrainingTransaction: vi.fn(async () => true) },
}));
vi.mock("../../server/services/dealPatternCloning", () => ({ dealPatternCloningService: { recordPatternFromClosedDeal: F.pattern } }));

type Close = typeof import("../../server/services/dealClose");
let recordDealClose: Close["recordDealClose"];
const settle = () => new Promise((r) => setTimeout(r, 30));

const deal = (over: Record<string, unknown> = {}) => ({
  id: 7,
  organizationId: 42,
  status: "closed",
  type: "disposition",
  propertyId: 3,
  acceptedAmount: "60000",
  offerAmount: "55000",
  assignedTo: 12,
  dealBook: null,
  analysisResults: { netProfit: 9000 },
  createdAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

beforeAll(async () => {
  ({ recordDealClose } = await import("../../server/services/dealClose"));
  // Load the lazily-imported effect modules once (see oneCloseWriter.test.ts).
  await Promise.all([
    import("../../server/services/outcomeCalibrationLoop"),
    import("../../server/services/referralReward"),
    import("../../server/services/mlSnapshots"),
    import("../../server/services/teamWebhookDispatcher"),
    import("../../server/services/commissionService"),
    import("../../server/services/leadScoring"),
    import("../../server/services/activation"),
    import("../../server/services/marketNetworkContributor"),
    import("../../server/services/acreOSValuation"),
    import("../../server/services/dealPatternCloning"),
  ]);
});

beforeEach(() => {
  F.h!.fake.reset();
  for (const f of [F.calibrate, F.referral, F.snapshot, F.pair, F.team, F.commission, F.conversion, F.activation, F.evidence, F.contribute, F.pattern, F.train]) f.mockClear();
  F.hasConfig.mockReset();
  F.hasConfig.mockResolvedValue(true);
  F.evidence.mockResolvedValue({
    ok: true, dealKey: "key-42-7", price: 60000, acres: 20, county: "Llano", state: "TX", zoning: null,
    closingDate: new Date("2026-09-30T00:00:00Z"), propertyId: 3,
  });
  F.h!.fake.rows("properties").push({ id: 3, organizationId: 42, sellerId: 11, zip: "78643", latitude: "30.7", longitude: "-98.6" });
  // The committed row the close hook runs after: the first win is claimed
  // only on a deal that is closed NOW (claimFirstWin).
  F.h!.fake.rows("deals").push({ id: 7, organizationId: 42, status: "closed", propertyId: 3 });
});

describe("a won close runs every effect PUT ran, with PUT's gates", () => {
  it("all of them, once", async () => {
    await recordDealClose(42, { status: "in_escrow" }, deal(), { userId: "user-1" });
    await settle();
    expect(F.calibrate).toHaveBeenCalledWith(42, 7, "won");
    expect(F.referral).toHaveBeenCalledWith(42);
    expect(F.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotType: "deal_outcome", subjectId: "7", orgId: 42,
      labels: expect.objectContaining({ outcome: "closed_won", acceptedAmount: 60000, status: "closed" }),
    }));
    expect(F.pair).toHaveBeenCalledWith(expect.objectContaining({
      snapshotType: "avm_vs_actual", subjectId: "3", outcomeLabels: { actualSalePrice: 60000, dealId: 7 },
    }));
    expect(F.pair).toHaveBeenCalledWith(expect.objectContaining({
      snapshotType: "lead_conversion", subjectId: "11", outcomeLabels: expect.objectContaining({ outcome: "converted", dealId: 7 }),
    }));
    expect(F.team).toHaveBeenCalledWith(42, "deal_closed", expect.objectContaining({ title: "Deal closed" }));
    // Decided on the deal's status when it runs (an undo that landed first means none).
    expect(F.commission).toHaveBeenCalledWith(42, 12, 7, 6_000_000, undefined, { onlyIfDealClosed: true });
    expect(F.conversion).toHaveBeenCalledWith(11, 42, "deal_closed", { dealValue: 60000, profitMargin: 9000 });
    expect(F.activation).toHaveBeenCalledWith(expect.objectContaining({ orgId: 42, userId: "user-1", eventName: "first_deal_closed" }));
    expect(F.h!.fake.rows("outcome_telemetry")).toEqual([
      expect.objectContaining({ organizationId: 42, outcomeType: "deal_won", relatedDealId: 7, relatedPropertyId: 3 }),
    ]);
    expect(F.contribute).toHaveBeenCalledWith(7, 42);
    expect(F.pattern).toHaveBeenCalledWith(42, 7);
  });

  it("the training row: same dedupe key, 'medium', inside the per-deal lock with the evidence read on the same tx", async () => {
    await recordDealClose(42, { status: "in_escrow" }, deal(), {});
    await settle();
    expect(F.train).toHaveBeenCalledTimes(1);
    const [org, point, quality, opts] = F.train.mock.calls[0] as unknown as [string, Record<string, any>, string, { dedupeKey: string; tx: unknown }];
    expect(org).toBe("42");
    expect(quality).toBe("medium");
    expect(opts.dedupeKey).toBe("deal:key-42-7");
    // The ONLY insert allowed to reaffirm a retracted row: evidence re-read under the lock.
    expect(opts).toMatchObject({ reaffirmUnderLock: true });
    expect(point).toMatchObject({ salePrice: 60000, acres: 20, pricePerAcre: 3000, location: { state: "TX", county: "Llano", zipCode: "78643" } });
    // The evidence was read through the SAME transaction the insert ran on…
    expect(F.evidence).toHaveBeenCalledWith(7, 42, opts.tx);
    expect(opts.tx).not.toBe(undefined);
    // …which held the per-deal lock.
    expect(F.h!.fake.lockLog.filter((l) => l.includes("deal_training"))).toEqual(["acquire deal_training:42:7", "release deal_training:42:7"]);
  });

  it("no acting user → first_deal_closed records null, never a guess", async () => {
    await recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    expect(F.activation).toHaveBeenCalledWith(expect.objectContaining({ eventName: "first_deal_closed", userId: null }));
  });

  it("an acquisition is not a sale: no avm_vs_actual, no training row (the rest still runs)", async () => {
    await recordDealClose(42, { status: "in_escrow" }, deal({ type: "acquisition" }));
    await settle();
    expect(F.pair.mock.calls.map((c) => (c[0] as { snapshotType: string }).snapshotType)).toEqual(["lead_conversion"]);
    expect(F.train).not.toHaveBeenCalled();
    expect(F.commission).toHaveBeenCalled();
  });

  it("the commission gate: no agent, own book, no config, or no amount → none", async () => {
    await recordDealClose(42, { status: "in_escrow" }, deal({ assignedTo: null }));
    await recordDealClose(42, { status: "in_escrow" }, deal({ dealBook: "own_investment" }));
    await recordDealClose(42, { status: "in_escrow" }, deal({ acceptedAmount: null }));
    F.hasConfig.mockResolvedValue(false);
    await recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    expect(F.commission).not.toHaveBeenCalled();
  });
});

describe("a lost close (cancelled) runs only the lost half", () => {
  it("calibration lost + deal_outcome closed_lost + lead dismissed; nothing a sale does", async () => {
    await recordDealClose(42, { status: "offer_sent" }, deal({ status: "cancelled" }), { userId: "user-1" });
    await settle();
    expect(F.calibrate).toHaveBeenCalledWith(42, 7, "lost");
    expect(F.snapshot).toHaveBeenCalledWith(expect.objectContaining({ labels: expect.objectContaining({ outcome: "closed_lost", status: "cancelled" }) }));
    expect(F.pair).toHaveBeenCalledWith(expect.objectContaining({ snapshotType: "lead_conversion", outcomeLabels: expect.objectContaining({ outcome: "dismissed" }) }));
    for (const f of [F.referral, F.team, F.commission, F.conversion, F.activation, F.contribute, F.pattern, F.train]) {
      expect(f).not.toHaveBeenCalled();
    }
    expect(F.pair.mock.calls.some((c) => (c[0] as { snapshotType: string }).snapshotType === "avm_vs_actual")).toBe(false);
    expect(F.h!.fake.rows("outcome_telemetry")).toEqual([]);
  });
});

describe("no transition, no close", () => {
  it("closed → closed, or a non-terminal status, runs nothing", async () => {
    await recordDealClose(42, { status: "closed" }, deal());
    await recordDealClose(42, { status: "accepted" }, deal({ status: "in_escrow" }));
    await recordDealClose(42, null, deal());
    await settle();
    for (const f of [F.calibrate, F.referral, F.snapshot, F.pair, F.team, F.commission, F.conversion, F.activation, F.contribute, F.pattern, F.train]) {
      expect(f).not.toHaveBeenCalled();
    }
  });
});
