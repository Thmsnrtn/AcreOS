/**
 * A/B Test Engine — persistence tests (Wave A "Nothing lies", ruling #12(c)).
 *
 * The engine used to keep tests in a module-level Map and outcomes in a
 * module-level array. These tests pin the property that replaced it: state
 * lives in the storage seam, so a FRESH engine instance — the stand-in for a
 * restarted process or a second Fly machine — sees everything the previous
 * instance wrote, and significance is computed over the union of all of it.
 *
 * No DATABASE_URL here: the seam is exercised with an in-memory fake that
 * mimics the Postgres tables (including the SQL GROUP BY aggregation).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AbTestEngine,
  computeResults,
  getVariant,
  type AbTest,
  type AbTestStorage,
  type AbOutcome,
  type AbOutcomeTally,
} from "../../server/services/abTestEngine";

// ── In-memory stand-in for outreach_ab_tests / outreach_ab_outcomes ──────────
// Deliberately OUTSIDE any engine instance — it is the "database", shared by
// every engine that connects to it, exactly like the real tables.

function makeFakeStorage() {
  const tests = new Map<string, AbTest>();
  const outcomes: AbOutcome[] = [];
  let crossOrgProbes = 0;

  const storage: AbTestStorage = {
    async upsertTest(test) {
      tests.set(test.id, { ...test, variants: test.variants.map((v) => ({ ...v })) });
      return { ...tests.get(test.id)! };
    },
    async getTest(testId, orgId) {
      // orgId is REQUIRED as of 2026-09-04. It used to be optional, and the
      // omitted-argument call was how createTest asked its cross-org question
      // — indistinguishable, at every call site, from forgetting to scope a
      // read. The org filter here is now unconditional, exactly like the SQL.
      const t = tests.get(testId);
      if (!t) return undefined;
      if (t.orgId !== orgId) return undefined;
      return { ...t };
    },
    async findTestOwnerAnyOrg(testId) {
      crossOrgProbes += 1;
      const t = tests.get(testId);
      return t ? { ...t } : undefined;
    },
    async listTests(orgId) {
      return Array.from(tests.values()).filter((t) => t.orgId === orgId).map((t) => ({ ...t }));
    },
    async insertOutcome(outcome) {
      outcomes.push({ ...outcome });
    },
    async aggregateOutcomes(testId) {
      // Mirrors `GROUP BY variant_id, event` in SQL.
      const buckets = new Map<string, AbOutcomeTally>();
      for (const o of outcomes) {
        if (o.testId !== testId) continue;
        const key = `${o.variantId}\u0000${o.event}`;
        const existing = buckets.get(key);
        if (existing) existing.count += 1;
        else buckets.set(key, { variantId: o.variantId, event: o.event, count: 1 });
      }
      return Array.from(buckets.values());
    },
  };

  return {
    storage,
    rawOutcomeCount: () => outcomes.length,
    crossOrgProbeCount: () => crossOrgProbes,
  };
}

const VARIANTS = [
  { id: "a", name: "Control", description: "baseline subject", weight: 50 },
  { id: "b", name: "Challenger", description: "curiosity subject", weight: 50 },
];

describe("AbTestEngine — state survives re-instantiation", () => {
  let fake: ReturnType<typeof makeFakeStorage>;

  beforeEach(() => {
    fake = makeFakeStorage();
  });

  it("a fresh engine sees a test created by a previous engine", async () => {
    const first = new AbTestEngine(fake.storage);
    await first.createTest({ id: "subject-q3", name: "Subject line Q3", orgId: 7, variants: VARIANTS, metric: "conversion_rate" });

    // Simulate a restart / a second machine: brand-new engine, same DB.
    const second = new AbTestEngine(fake.storage);
    const found = await second.getTest("subject-q3", 7);

    expect(found).toBeDefined();
    expect(found!.name).toBe("Subject line Q3");
    expect(found!.orgId).toBe(7);
    expect(found!.status).toBe("active");
    expect(found!.variants).toHaveLength(2);
    expect(await second.listTests(7)).toHaveLength(1);
  });

  it("outcomes recorded by one engine are counted by another", async () => {
    const machineA = new AbTestEngine(fake.storage);
    const test = await machineA.createTest({
      id: "subject-q3",
      name: "Subject line Q3",
      orgId: 7,
      variants: VARIANTS,
      metric: "conversion_rate",
    });

    await machineA.recordOutcome({ testId: test.id, variantId: "a", leadId: 1, event: "sent", timestamp: new Date() });
    await machineA.recordOutcome({ testId: test.id, variantId: "a", leadId: 1, event: "opened", timestamp: new Date() });

    const machineB = new AbTestEngine(fake.storage);
    await machineB.recordOutcome({ testId: test.id, variantId: "b", leadId: 2, event: "sent", timestamp: new Date() });
    await machineB.recordOutcome({ testId: test.id, variantId: "b", leadId: 2, event: "converted", timestamp: new Date() });

    // A THIRD engine computes results — it must see all four events, not the
    // two that any single process happened to record.
    const machineC = new AbTestEngine(fake.storage);
    const results = await machineC.getResults(test);

    expect(results.totalSent).toBe(2);
    const a = results.variants.find((v) => v.id === "a")!;
    const b = results.variants.find((v) => v.id === "b")!;
    expect(a.sent).toBe(1);
    expect(a.opened).toBe(1);
    expect(b.sent).toBe(1);
    expect(b.converted).toBe(1);
    expect(fake.rawOutcomeCount()).toBe(4);
  });

  it("outcomes are events, not overwrites — repeated events accumulate", async () => {
    const engine = new AbTestEngine(fake.storage);
    const test = await engine.createTest({ id: "t", name: "T", orgId: 1, variants: VARIANTS, metric: "open_rate" });

    for (let leadId = 1; leadId <= 5; leadId++) {
      await engine.recordOutcome({ testId: test.id, variantId: "a", leadId, event: "sent", timestamp: new Date() });
    }

    const results = await new AbTestEngine(fake.storage).getResults(test);
    expect(results.variants.find((v) => v.id === "a")!.sent).toBe(5);
  });

  it("re-creating a test id owned by the same org overwrites it (Map.set semantics)", async () => {
    const engine = new AbTestEngine(fake.storage);
    await engine.createTest({ id: "t", name: "First", orgId: 3, variants: VARIANTS, metric: "open_rate" });
    await engine.createTest({ id: "t", name: "Second", orgId: 3, variants: VARIANTS, metric: "open_rate" });

    const found = await new AbTestEngine(fake.storage).getTest("t", 3);
    expect(found!.name).toBe("Second");
  });

  it("refuses to hijack a test id owned by another org", async () => {
    const engine = new AbTestEngine(fake.storage);
    await engine.createTest({ id: "t", name: "Org 3's test", orgId: 3, variants: VARIANTS, metric: "open_rate" });

    await expect(
      new AbTestEngine(fake.storage).createTest({ id: "t", name: "Org 9's test", orgId: 9, variants: VARIANTS, metric: "open_rate" }),
    ).rejects.toThrow(/already in use/);

    expect((await engine.getTest("t", 3))!.orgId).toBe(3);
    // The refusal is only possible via a read that crosses orgs — ids are
    // global, orgs are not. That read now has its own name on the storage
    // seam instead of riding an omitted argument to getTest, so this asserts
    // WHICH door createTest used, not merely that it refused.
    expect(
      fake.crossOrgProbeCount(),
      "createTest answered 'is this id taken by another org?' without going " +
        "through findTestOwnerAnyOrg. If it went back to getTest(id) with the " +
        "org argument dropped, the cross-org read is invisible again.",
    ).toBeGreaterThan(0);
  });

  it("org-scoped getTest hides another org's test", async () => {
    const engine = new AbTestEngine(fake.storage);
    await engine.createTest({ id: "t", name: "Org 3's test", orgId: 3, variants: VARIANTS, metric: "open_rate" });

    expect(await engine.getTest("t", 3)).toBeDefined();
    expect(await engine.getTest("t", 9)).toBeUndefined();
    expect(await engine.listTests(9)).toEqual([]);
  });
});

describe("computeResults — aggregation over SQL tallies", () => {
  const test: AbTest = {
    id: "t",
    name: "T",
    orgId: 1,
    variants: VARIANTS,
    metric: "conversion_rate",
    startedAt: new Date(),
    status: "active",
  };

  it("returns zeroed stats when nothing has been recorded (no fabricated numbers)", () => {
    const results = computeResults(test, []);
    expect(results.totalSent).toBe(0);
    expect(results.hasSignificantResult).toBe(false);
    expect(results.winnerDeclared).toBe(false);
    for (const v of results.variants) {
      expect(v.sent).toBe(0);
      expect(v.openRate).toBe(0);
      expect(v.conversionRate).toBe(0);
      expect(v.isWinner).toBe(false);
    }
  });

  it("declares a winner only past the minimum sample size", () => {
    const small: AbOutcomeTally[] = [
      { variantId: "a", event: "sent", count: 10 },
      { variantId: "a", event: "converted", count: 1 },
      { variantId: "b", event: "sent", count: 10 },
      { variantId: "b", event: "converted", count: 9 },
    ];
    const tiny = computeResults(test, small);
    expect(tiny.totalSent).toBe(20);
    expect(tiny.winnerDeclared).toBe(false);

    const large: AbOutcomeTally[] = [
      { variantId: "a", event: "sent", count: 500 },
      { variantId: "a", event: "converted", count: 25 },
      { variantId: "b", event: "sent", count: 500 },
      { variantId: "b", event: "converted", count: 125 },
    ];
    const big = computeResults(test, large);
    expect(big.totalSent).toBe(1000);
    expect(big.hasSignificantResult).toBe(true);
    expect(big.variants.find((v) => v.id === "b")!.isWinner).toBe(true);
  });

  it("ignores tallies for variants that are not on the test", () => {
    const results = computeResults(test, [
      { variantId: "a", event: "sent", count: 3 },
      { variantId: "ghost", event: "sent", count: 99 },
    ]);
    expect(results.totalSent).toBe(3);
    expect(results.variants.map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("getVariant — assignment stays deterministic and process-independent", () => {
  const test: AbTest = {
    id: "subject-q3",
    name: "T",
    orgId: 1,
    variants: VARIANTS,
    metric: "open_rate",
    startedAt: new Date(),
    status: "active",
  };

  it("gives the same lead the same variant every time", () => {
    for (const leadId of [1, 2, 42, 1000, 99999]) {
      const first = getVariant(test, leadId);
      expect(getVariant(test, leadId).id).toBe(first.id);
      expect(getVariant(test, leadId).id).toBe(first.id);
    }
  });

  it("splits leads across both variants", () => {
    const seen = new Set<string>();
    for (let leadId = 1; leadId <= 200; leadId++) seen.add(getVariant(test, leadId).id);
    expect(seen).toEqual(new Set(["a", "b"]));
  });
});
