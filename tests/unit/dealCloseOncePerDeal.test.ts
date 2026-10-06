/**
 * W10.4 audit findings 2, 3 and 5 — what a close does when it is not the
 * first, when the deal is sample data, and when a reopen races a re-close.
 *
 *  2. The bulk undo moves a closed deal back to in_escrow; closing it again is
 *     a genuine transition, so recordDealClose runs again. The effects that
 *     are not idempotent by their own key — deal_won telemetry, the lead
 *     conversion, the "won" calibration, the team post, the referral moment,
 *     the pattern fingerprint — must not double-record. The deal_won row is
 *     the once-per-deal claim (taken under a per-deal lock). Leaving closed
 *     reverses the commission (commissionService.retractDealCommission).
 *  3. A deal on a SAMPLE- parcel is not a sale: closing the demo deal used to
 *     record first_deal_closed (onConflictDoNothing — the org's REAL first
 *     close was later dropped), telemetry, calibration, a Slack post, … None
 *     of it runs.
 *  5. The reopen's training retraction runs under the per-deal lock and only
 *     if the deal is not closed NOW — so close → undo → close in quick
 *     succession cannot end retracted while closed. Close & Carry's
 *     retraction stays unconditional.
 *
 * Real dealClose over tests/helpers/fakeDealsDb (WHERE clauses evaluated,
 * advisory locks real); each effect's module observed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  calibrate: vi.fn(async () => undefined),
  referral: vi.fn(async () => undefined),
  snapshot: vi.fn(),
  pair: vi.fn(),
  team: vi.fn(async () => undefined),
  commission: vi.fn(async () => undefined),
  retractCommission: vi.fn(async () => ({ removed: 1, flagged: 0 })),
  conversion: vi.fn(async () => undefined),
  activation: vi.fn(),
  contribute: vi.fn(async () => ({ contributed: true, reason: "" })),
  pattern: vi.fn(async () => undefined),
  train: vi.fn(async () => "1"),
  retractTraining: vi.fn(async () => true),
  withdraw: vi.fn(async () => "withdrawn" as const),
  logError: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: F.logError, debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});
vi.mock("../../server/services/outcomeCalibrationLoop", () => ({ onDealClosed: F.calibrate }));
vi.mock("../../server/services/referralReward", () => ({ recordReferralShareMoment: F.referral }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: F.snapshot, pairOutcomeAsync: F.pair }));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({ dispatchTeamEvent: F.team }));
vi.mock("../../server/services/commissionService", () => ({
  hasCommissionConfig: async () => true,
  recordDealCommission: F.commission,
  retractDealCommission: F.retractCommission,
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: { recordConversion: F.conversion } }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: F.activation }));
vi.mock("../../server/services/marketNetworkContributor", () => ({
  closedSaleEvidence: async () => ({
    ok: true, dealKey: "key-42-7", price: 60000, acres: 20, county: "Llano", state: "TX", zoning: null,
    closingDate: new Date("2026-09-30T00:00:00Z"), propertyId: 3,
  }),
  closedSaleDealKey: (o: number, d: number) => `key-${o}-${d}`,
  contributeClosedDealToNetwork: F.contribute,
  withdrawStagedNetworkContribution: F.withdraw,
}));
vi.mock("../../server/services/acreOSValuation", () => ({
  acreOSValuation: { recordTransactionForTraining: F.train, retractTrainingTransaction: F.retractTraining },
}));
vi.mock("../../server/services/dealPatternCloning", () => ({ dealPatternCloningService: { recordPatternFromClosedDeal: F.pattern } }));

type Close = typeof import("../../server/services/dealClose");
let close: Close;
const settle = () => new Promise((r) => setTimeout(r, 30));
const ALL = () => [F.calibrate, F.referral, F.snapshot, F.pair, F.team, F.commission, F.conversion, F.activation, F.contribute, F.pattern, F.train];

const deal = (over: Record<string, unknown> = {}) => ({
  id: 7, organizationId: 42, status: "closed", type: "disposition", propertyId: 3,
  acceptedAmount: "60000", offerAmount: "55000", assignedTo: 12, dealBook: null,
  analysisResults: { netProfit: 9000 }, createdAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});
const telemetry = () => F.h!.fake.rows("outcome_telemetry").filter((r) => r.outcomeType === "deal_won");

beforeAll(async () => {
  close = await import("../../server/services/dealClose");
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
  for (const f of [...ALL(), F.retractCommission, F.retractTraining, F.withdraw, F.logError]) f.mockClear();
  F.h!.fake.rows("properties").push({ id: 3, organizationId: 42, sellerId: 11, apn: "045-120-007", zip: "78643" });
  F.h!.fake.rows("deals").push({ id: 7, organizationId: 42, status: "closed" });
});

describe("finding 2 — a re-close (closed → undo → closed) does not double-record", () => {
  it("the once-per-deal effects run for the first win only; the idempotent ones run again", async () => {
    await close.recordDealClose(42, { status: "in_escrow" }, deal(), { userId: "user-1" });
    await settle();
    // …undo, then closed again:
    await close.recordDealClose(42, { status: "in_escrow" }, deal(), { userId: "user-1" });
    await settle();

    // ONE deal_won row, ONE conversion, ONE "won" calibration, ONE team post,
    // ONE referral moment, ONE pattern.
    expect(telemetry()).toHaveLength(1);
    expect(F.conversion).toHaveBeenCalledTimes(1);
    expect(F.calibrate).toHaveBeenCalledTimes(1);
    expect(F.calibrate).toHaveBeenCalledWith(42, 7, "won");
    expect(F.team).toHaveBeenCalledTimes(1);
    expect(F.referral).toHaveBeenCalledTimes(1);
    expect(F.pattern).toHaveBeenCalledTimes(1);
    // Idempotent by their own keys, so they run each time: the commission
    // (one record per deal; a paid one is never replaced), the training row
    // (deal:<dealKey>), the network (dealKey), first_deal_closed (per org),
    // the deal_outcome snapshot (onConflictDoNothing).
    expect(F.commission).toHaveBeenCalledTimes(2);
    expect(F.train).toHaveBeenCalledTimes(2);
    expect(F.contribute).toHaveBeenCalledTimes(2);
    // No lock body (deal_won claim, training row) opened a second connection.
    expect(F.h!.fake.lockLog.length).toBeGreaterThan(0);
    expect(F.h!.fake.globalDbUnderLock).toEqual([]);
  });

  it("two re-closes racing take the claim once (per-deal lock)", async () => {
    await Promise.all([
      close.recordDealClose(42, { status: "in_escrow" }, deal()),
      close.recordDealClose(42, { status: "in_escrow" }, deal()),
    ]);
    await settle();
    expect(telemetry()).toHaveLength(1);
    expect(F.conversion).toHaveBeenCalledTimes(1);
    expect(F.h!.fake.lockLog.filter((l) => l === "acquire deal_won:42:7")).toHaveLength(2);
  });

  it("a deal that closed before (its deal_won row exists) runs none of them", async () => {
    F.h!.fake.rows("outcome_telemetry").push({ id: 1, organizationId: 42, outcomeType: "deal_won", relatedDealId: 7 });
    await close.recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    for (const f of [F.conversion, F.calibrate, F.team, F.referral, F.pattern]) expect(f).not.toHaveBeenCalled();
    expect(telemetry()).toHaveLength(1);
  });

  it("another org's deal_won row for the same deal id does not count", async () => {
    F.h!.fake.rows("outcome_telemetry").push({ id: 1, organizationId: 99, outcomeType: "deal_won", relatedDealId: 7 });
    await close.recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    expect(F.conversion).toHaveBeenCalledTimes(1);
  });

  it("leaving closed retracts the commission and the training row", async () => {
    F.h!.fake.rows("deals")[0].status = "in_escrow"; // the undo committed
    await close.recordDealReopen(42, 7, "in_escrow");
    expect(F.retractCommission).toHaveBeenCalledWith(42, 7, "Deal left closed (now in escrow)");
    expect(F.retractTraining).toHaveBeenCalledWith(42, "deal:key-42-7", expect.anything());
    // Vacuity: the retraction ran under the per-deal lock — and its body opened no second connection.
    expect(F.h!.fake.lockLog).toContain("acquire deal_training:42:7");
    expect(F.h!.fake.globalDbUnderLock).toEqual([]);
  });

  it("the undo through the repository reaches it (recordDealTransitionEvidence → recordDealReopen)", async () => {
    const { recordDealTransitionEvidence } = await import("../../server/services/dealLifecycleEvents");
    F.h!.fake.rows("deals")[0].status = "in_escrow";
    recordDealTransitionEvidence(42, { status: "closed" }, { id: 7, status: "in_escrow" });
    await vi.waitFor(() => expect(F.retractCommission).toHaveBeenCalledWith(42, 7, "Deal left closed (now in escrow)"));
  });
});

describe("finding 3 — a sample-data deal's close has no effects", () => {
  it("a deal on a SAMPLE- parcel: nothing runs — no first_deal_closed, telemetry, calibration, post, conversion", async () => {
    F.h!.fake.rows("properties")[0].apn = "SAMPLE-0001";
    await close.recordDealClose(42, { status: "in_escrow" }, deal(), { userId: "user-1" });
    await close.recordDealClose(42, { status: "offer_sent" }, deal({ status: "cancelled" }));
    await settle();
    for (const f of ALL()) expect(f).not.toHaveBeenCalled();
    expect(F.h!.fake.rows("outcome_telemetry")).toEqual([]);
  });

  it("the same deal on a real parcel runs them (the guard is the APN, not the deal)", async () => {
    await close.recordDealClose(42, { status: "in_escrow" }, deal(), { userId: "user-1" });
    await settle();
    expect(F.activation).toHaveBeenCalledWith(expect.objectContaining({ eventName: "first_deal_closed" }));
    expect(telemetry()).toHaveLength(1);
  });

  it("another org's SAMPLE- parcel with the same id does not make this deal sample", async () => {
    F.h!.fake.rows("properties").splice(0, 1, { id: 3, organizationId: 99, apn: "SAMPLE-0001" }, { id: 3, organizationId: 42, apn: "045-1", sellerId: 11 });
    await close.recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    expect(telemetry()).toHaveLength(1);
  });
});

describe("finding 5 — a reopen's retraction cannot land on a deal that is closed again", () => {
  it("close → undo → close: the undo's late retraction finds the deal closed and leaves the row", async () => {
    // The deal is closed NOW (the re-close committed before the undo's hook ran).
    await close.recordDealReopen(42, 7, "in_escrow");
    expect(F.retractTraining).not.toHaveBeenCalled();
    // …and it was decided under the per-deal training lock.
    expect(F.h!.fake.lockLog).toEqual(["acquire deal_training:42:7", "release deal_training:42:7"]);
  });

  it("Close & Carry's retraction stays unconditional (a carried sale is closed AND not a cash comp)", async () => {
    expect(await close.retractClosedSaleTraining(42, 7)).toBe(true);
    expect(F.retractTraining).toHaveBeenCalledTimes(1);
  });
});

describe("re-audit — the claim, the purge, the network and a transient read", () => {
  it("a close hook that runs after the undo committed claims no win (finding 2)", async () => {
    F.h!.fake.rows("deals")[0].status = "in_escrow";
    await close.recordDealClose(42, { status: "in_escrow" }, deal());
    await settle();
    expect(telemetry()).toEqual([]);
    for (const f of [F.conversion, F.calibrate, F.team, F.referral, F.pattern]) expect(f).not.toHaveBeenCalled();
  });

  it("a reopen withdraws the deal's staged network entry (finding 2)", async () => {
    F.h!.fake.rows("deals")[0].status = "in_escrow";
    await close.recordDealReopen(42, 7, "in_escrow");
    expect(F.withdraw).toHaveBeenCalledWith(42, 7);
  });

  it("a retention purge retracts the comp and the network entry but keeps the owed commission (finding 9)", async () => {
    const { DEAL_PURGED } = await import("../../server/services/dealLifecycleEvents");
    F.h!.fake.rows("deals").splice(0, 1); // hard-deleted
    await close.recordDealReopen(42, 7, DEAL_PURGED);
    expect(F.retractTraining).toHaveBeenCalledTimes(1);
    expect(F.withdraw).toHaveBeenCalledWith(42, 7);
    expect(F.retractCommission).not.toHaveBeenCalled();
    // A user delete is still "the sale is gone": its commission is retracted.
    await close.recordDealReopen(42, 7, "deleted");
    expect(F.retractCommission).toHaveBeenCalledWith(42, 7, "Deal left closed (now deleted)");
  });

  describe("the sample-lineage read (finding 3)", () => {
    /** Make the next `n` reads of `properties` through the global db reject. */
    const failPropertyReads = (n: number) => {
      const db = F.h!.db as { select: (p?: unknown) => { from: (t: unknown) => unknown } };
      const orig = db.select;
      let left = n;
      db.select = (p?: unknown) => {
        const chain = orig(p);
        return {
          from: (t: unknown) => {
            if (getTableName(t as never) !== "properties" || left <= 0) return chain.from(t);
            left--;
            const failing: Record<string, unknown> = {};
            failing.where = () => failing;
            failing.limit = () => Promise.reject(new Error("timeout exceeded when trying to connect"));
            return failing;
          },
        };
      };
      return () => (db.select = orig);
    };

    it("one transient failure is retried, and the close runs", async () => {
      const restore = failPropertyReads(1);
      try {
        await close.recordDealClose(42, { status: "in_escrow" }, deal());
        await settle();
      } finally {
        restore();
      }
      expect(telemetry()).toHaveLength(1);
      expect(F.logError).not.toHaveBeenCalled();
    });

    it("a second failure records nothing and logs an ERROR naming the deal", async () => {
      const restore = failPropertyReads(2);
      try {
        await close.recordDealClose(42, { status: "in_escrow" }, deal());
        await settle();
      } finally {
        restore();
      }
      for (const f of ALL()) expect(f).not.toHaveBeenCalled();
      expect(F.logError).toHaveBeenCalledWith(
        expect.stringMatching(/NO close effects recorded/),
        expect.objectContaining({ metadata: expect.objectContaining({ orgId: 42, dealId: 7 }) }),
      );
    });
  });
});
