/**
 * DEFECT-0258 (1) / W10.4 contract item 3 — the training-row race.
 *
 * A close records its sale in transaction_training (keyed deal:<dealKey>);
 * Close & Carry, run after the close, retracts that row because a carried
 * sale is seller-financed, not a cash price. The close used to read its
 * evidence and insert on separate connections, unlocked and asynchronously,
 * with `onConflictDoUpdate({ isOutlier: false })`. So:
 *
 *   close reads evidence (no note yet) → carry creates the note → carry
 *   retracts (no row yet, or the row) → close inserts / overwrites with
 *   isOutlier: false  ⇒  a seller-financed contract total is a live cash comp.
 *
 * Now the evidence read + insert are ONE transaction under a per-deal advisory
 * lock that the carry's retraction also takes, and a retracted row is never
 * un-retracted by an insert. This file drives that exact interleaving through
 * the real dealClose + acreOSValuation code over a fake handle whose advisory
 * lock is a real mutex and whose ON CONFLICT … WHERE is evaluated.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { notes } from "@shared/schema";

const F = vi.hoisted(() => ({
  h: null as null | ReturnType<typeof import("../helpers/fakeDealsDb").createFakeDb>,
  gate: null as null | Promise<void>,
  executors: [] as unknown[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// The close's other consequences are not under test here (dealCloseEffects).
vi.mock("../../server/services/outcomeCalibrationLoop", () => ({ onDealClosed: async () => undefined }));
vi.mock("../../server/services/referralReward", () => ({ recordReferralShareMoment: async () => undefined }));
vi.mock("../../server/services/mlSnapshots", () => ({ recordSnapshotAsync: () => undefined, pairOutcomeAsync: () => undefined }));
vi.mock("../../server/services/teamWebhookDispatcher", () => ({ dispatchTeamEvent: async () => undefined }));
vi.mock("../../server/services/commissionService", () => ({
  hasCommissionConfig: async () => false,
  recordDealCommission: async () => undefined,
  retractDealCommission: async () => ({ removed: 0, flagged: 0 }),
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: { recordConversion: async () => undefined } }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => undefined }));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: { dealDiscovered: async () => undefined, dealClosed: async () => undefined, dealUpdated: async () => undefined },
}));
vi.mock("../../server/services/dealPatternCloning", () => ({ dealPatternCloningService: { recordPatternFromClosedDeal: async () => undefined } }));
vi.mock("../../server/services/gradientBoosting", () => ({
  GradientBoostingRegressor: { fromJSON: () => null },
  extractLandFeatures: (x: unknown) => x,
  LAND_FEATURE_NAMES: [],
}));
vi.mock("../../server/db", async () => {
  const { createFakeDb } = await import("../helpers/fakeDealsDb");
  F.h = createFakeDb();
  return { db: F.h.db, withTransaction: F.h.withTransaction };
});
// The evidence rule's financing check, modelled on the real one (a note
// carried from this deal = seller-financed), reading through the executor it
// is GIVEN — so a read on the wrong connection reads the wrong state.
vi.mock("../../server/services/marketNetworkContributor", () => ({
  closedSaleDealKey: (o: number, d: number) => `key-${o}-${d}`,
  contributeClosedDealToNetwork: async () => ({ contributed: false, reason: "not under test" }),
  closedSaleEvidence: async (dealId: number, orgId: number, executor: any) => {
    F.executors.push(executor);
    const financed = await executor
      .select()
      .from(notes)
      .where(and(eq(notes.organizationId, orgId), eq(notes.originatingDealId, dealId)))
      .limit(1);
    if (F.gate) await F.gate; // the window between the evidence read and the insert
    if (financed.length > 0) return { ok: false, reason: "Seller-financed: the contract total is not a cash sale price" };
    return {
      ok: true, dealKey: `key-${orgId}-${dealId}`, price: 60000, acres: 20, county: "Llano", state: "TX",
      zoning: null, closingDate: new Date("2026-09-30T00:00:00Z"), propertyId: 3,
    };
  },
}));

type Close = typeof import("../../server/services/dealClose");
let close: Close;
const training = () => F.h!.fake.rows("transaction_training");
const carryNote = () => F.h!.fake.rows("notes").push({ id: 501, organizationId: 42, originatingDealId: 7, propertyId: 3 });
const tick = () => new Promise((r) => setTimeout(r, 10));
/**
 * The per-deal TRAINING lock's log. The close also takes a per-deal deal_won
 * lock first (the once-per-deal claim, W10.4 audit finding 2) — a different
 * key, not under test here.
 */
const trainingLocks = () => F.h!.fake.lockLog.filter((l) => l.endsWith(" deal_training:42:7"));
const releases = () => trainingLocks().filter((l) => l.startsWith("release")).length;

/**
 * The close, through its one real entry point (the repository hook's
 * recordDealClose): a won disposition whose training write is fire-and-forget.
 * Resolves once the training transaction has ended (its lock released).
 */
async function close7(): Promise<void> {
  const before = releases();
  await close.recordDealClose(42, { status: "in_escrow" }, {
    id: 7, organizationId: 42, status: "closed", type: "disposition", propertyId: 3, acceptedAmount: "60000",
  });
  await vi.waitFor(() => expect(releases()).toBeGreaterThan(before));
}
/** Close & Carry's retraction path (routes-notes retractCarriedDealSale → this). */
const carryRetract = () => close.retractClosedSaleTraining(42, 7);

beforeAll(async () => {
  close = await import("../../server/services/dealClose");
  await import("../../server/services/dealLifecycleEvents");
  await import("../../server/services/acreOSValuation");
  // Load the close's lazily-imported modules once (see oneCloseWriter.test.ts).
  await Promise.all([
    import("../../server/services/outcomeCalibrationLoop"),
    import("../../server/services/referralReward"),
    import("../../server/services/mlSnapshots"),
    import("../../server/services/teamWebhookDispatcher"),
    import("../../server/services/commissionService"),
    import("../../server/services/leadScoring"),
    import("../../server/services/activation"),
    import("../../server/services/dealPatternCloning"),
    // The sample-lineage marker (recordDealClose loads it lazily).
    import("../../server/services/onboarding/sampleSeeder"),
    import("../../server/services/marketNetworkContributor"),
  ]);
});

beforeEach(() => {
  F.h!.fake.reset();
  F.gate = null;
  F.executors = [];
});

describe("the close's training insert and Close & Carry's retraction serialize on one per-deal lock", () => {
  it("carry lands in the close's evidence→insert window: the retraction waits, then wins", async () => {
    let open!: () => void;
    F.gate = new Promise<void>((r) => (open = r));

    const closing = close7(); // reads evidence: no note yet — then pauses
    await vi.waitFor(() => expect(F.executors).toHaveLength(1));
    carryNote(); // Close & Carry commits the note…
    const retracting = carryRetract(); // …and retracts
    await tick();

    // The retraction is BLOCKED on the close's lock — it has not run against an empty table.
    expect(trainingLocks()).toEqual(["acquire deal_training:42:7"]);
    expect(training()).toEqual([]);

    open();
    await closing;
    expect(await retracting).toBe(true);
    expect(trainingLocks()).toEqual([
      "acquire deal_training:42:7",
      "release deal_training:42:7",
      "acquire deal_training:42:7",
      "release deal_training:42:7",
    ]);
    expect(training()).toHaveLength(1);
    expect(training()[0]).toMatchObject({ transactionHash: "deal:key-42-7", isOutlier: true, dataQuality: "low" });
  });

  it("the evidence is read on the locked transaction, never beside it", async () => {
    await close7();
    expect(F.executors).toHaveLength(1);
    expect(F.executors[0]).not.toBe(F.h!.db);
  });

  it("carry first: the close's locked evidence read sees the note and records nothing", async () => {
    carryNote();
    expect(await carryRetract()).toBe(false); // nothing to retract yet
    await close7();
    expect(training()).toEqual([]);
  });
});

describe("a retracted row stays retracted after a late insert", () => {
  it("a re-fired close sees the note under the lock and does nothing", async () => {
    await close7();
    carryNote();
    await carryRetract();
    await close7();
    expect(training()).toHaveLength(1);
    expect(training()[0]).toMatchObject({ isOutlier: true, dataQuality: "low" });
  });

  it("even an insert that bypasses the evidence (the old unlocked shape) cannot un-retract it", async () => {
    await close7();
    await carryRetract();
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    await acreOSValuation.recordTransactionForTraining(
      "42",
      {
        propertyId: "3", salePrice: 99000, saleDate: new Date(), acres: 20, pricePerAcre: 4950,
        location: { state: "TX", county: "Llano", zipCode: "", latitude: 0, longitude: 0 },
        characteristics: {},
        marketConditions: { quarterlyInterestRate: 0, localUnemploymentRate: 0, populationGrowth: 0, nearbyDevelopment: false },
      },
      "medium",
      { dedupeKey: "deal:key-42-7" },
    );
    expect(training()).toHaveLength(1);
    expect(training()[0]).toMatchObject({ isOutlier: true, dataQuality: "low", salePrice: "60000" });
  });

  it("a LIVE row still takes a keyed re-insert's current figures (only retraction is final)", async () => {
    await close7();
    const { acreOSValuation } = await import("../../server/services/acreOSValuation");
    await acreOSValuation.recordTransactionForTraining(
      "42",
      {
        propertyId: "3", salePrice: 64000, saleDate: new Date(), acres: 20, pricePerAcre: 3200,
        location: { state: "TX", county: "Llano", zipCode: "", latitude: 0, longitude: 0 },
        characteristics: {},
        marketConditions: { quarterlyInterestRate: 0, localUnemploymentRate: 0, populationGrowth: 0, nearbyDevelopment: false },
      },
      "medium",
      { dedupeKey: "deal:key-42-7" },
    );
    expect(training()[0]).toMatchObject({ salePrice: "64000", pricePerAcre: "3200" });
    expect(training()[0].isOutlier ?? false).toBe(false);
  });
});

describe("a reopened deal genuinely closed again gets its comp back (reaffirmed under the lock)", () => {
  it("bulk undo (closed → in_escrow) retracts; the re-close re-reads evidence under the lock and the comp is live again", async () => {
    const { dealRepo } = await import("../../server/storage/dealRepo");
    const self = { _autoGenerateClosingChecklist: async () => undefined } as never;
    F.h!.fake.rows("deals").push({
      id: 7, organizationId: 42, status: "in_escrow", type: "disposition", propertyId: 3, acceptedAmount: "60000",
    });
    // The first close, through the repository (its hook runs recordDealClose).
    await dealRepo.updateDeal.call(self, 7, { status: "closed" }, undefined, 42);
    await vi.waitFor(() => expect(training()).toHaveLength(1));
    expect(training()[0].isOutlier ?? false).toBe(false);

    // Reopened by mistake — the bulk undo's backward move — which retracts.
    await dealRepo.updateDeal.call(self, 7, { status: "in_escrow" }, undefined, 42, { backwardUndo: true });
    await vi.waitFor(() => expect(training()[0]).toMatchObject({ isOutlier: true, dataQuality: "low" }));

    // Closed again for real: the evidence qualifies NOW, read under the lock.
    await dealRepo.updateDeal.call(self, 7, { status: "closed" }, undefined, 42);
    await vi.waitFor(() => expect(training()[0]).toMatchObject({ isOutlier: false, dataQuality: "medium" }));
    expect(training()).toHaveLength(1); // the same keyed row, not a second sale
  });
});
