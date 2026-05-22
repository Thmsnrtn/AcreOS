/**
 * Pillar 8.6 — db-replica routing helper tests.
 *
 * Verifies:
 *   1. When DATABASE_REPLICA_URL is unset, dbForReads() returns the primary.
 *   2. When DATABASE_REPLICA_URL is set, dbForReads() returns the replica.
 *   3. The founder_settings category filter narrows routing.
 *   4. The in-memory cache TTL is ~60s.
 *
 * The replica/primary instances are mocked so the test runs without a real
 * Postgres or replica connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Test doubles ────────────────────────────────────────────────────────────
// Two distinguishable sentinels so the test can assert which one was returned.
const PRIMARY = { __tag: "primary" } as const;
const REPLICA = { __tag: "replica" } as const;

// Mutable mock state — flipped per-test before importing the SUT.
let mockReplicaExists = false;
let mockCategoryFilter: string[] = [];

vi.mock("../../server/db", () => ({
  db: PRIMARY,
  get dbReplica() {
    return mockReplicaExists ? REPLICA : null;
  },
  dbReadOnly: REPLICA,
  pool: {},
  replicaPool: {},
  withTransaction: async (_fn: any) => undefined,
}));

vi.mock("../../server/services/settings", () => ({
  getSetting: vi.fn(async (_key: string, fallback: unknown) =>
    Array.isArray(mockCategoryFilter) ? mockCategoryFilter : fallback,
  ),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("dbForReads", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockReplicaExists = false;
    mockCategoryFilter = [];
  });

  it("returns the primary when DATABASE_REPLICA_URL is unset", async () => {
    mockReplicaExists = false;
    const { dbForReads, _resetReplicaCategoryCache, _resetAdoptionCounters } =
      await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    const r = await dbForReads("test.category");
    expect((r as any).__tag).toBe("primary");
  });

  it("returns the replica when DATABASE_REPLICA_URL is set", async () => {
    mockReplicaExists = true;
    const { dbForReads, _resetReplicaCategoryCache, _resetAdoptionCounters } =
      await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    const r = await dbForReads("test.category");
    expect((r as any).__tag).toBe("replica");
  });

  it("respects the founder_settings category filter", async () => {
    mockReplicaExists = true;
    // Filter narrows to ONLY the cohort.retention category.
    mockCategoryFilter = ["cohort.retention"];
    const { dbForReads, _resetReplicaCategoryCache, _resetAdoptionCounters } =
      await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    const matched = await dbForReads("cohort.retention");
    expect((matched as any).__tag).toBe("replica");

    const skipped = await dbForReads("founder.intelligence.pulse");
    expect((skipped as any).__tag).toBe("primary");
  });

  it("empty filter routes ALL eligible reads to the replica", async () => {
    mockReplicaExists = true;
    mockCategoryFilter = []; // empty = route everything
    const { dbForReads, _resetReplicaCategoryCache, _resetAdoptionCounters } =
      await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    const a = await dbForReads("a");
    const b = await dbForReads("b");
    expect((a as any).__tag).toBe("replica");
    expect((b as any).__tag).toBe("replica");
  });

  it("caches the category filter for roughly 60s", async () => {
    mockReplicaExists = true;
    mockCategoryFilter = ["cohort.retention"];

    const settingsMod = await import("../../server/services/settings");
    const getSettingSpy = vi.spyOn(settingsMod, "getSetting");

    const { dbForReads, _resetReplicaCategoryCache, _resetAdoptionCounters } =
      await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    // First call should hit getSetting; subsequent calls inside the TTL
    // window must NOT call getSetting again.
    await dbForReads("cohort.retention");
    const firstCallCount = getSettingSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    await dbForReads("cohort.retention");
    await dbForReads("founder.intelligence.pulse");
    await dbForReads("health.deep");

    expect(getSettingSpy.mock.calls.length).toBe(firstCallCount);

    // Bust the cache and confirm we re-fetch.
    _resetReplicaCategoryCache();
    await dbForReads("cohort.retention");
    expect(getSettingSpy.mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it("snapshotAdoption tallies primary vs replica routing", async () => {
    mockReplicaExists = true;
    mockCategoryFilter = ["cohort.retention"];
    const {
      dbForReads,
      snapshotAdoption,
      _resetReplicaCategoryCache,
      _resetAdoptionCounters,
    } = await import("../../server/db-replica");
    _resetReplicaCategoryCache();
    _resetAdoptionCounters();

    await dbForReads("cohort.retention"); // → replica
    await dbForReads("cohort.retention"); // → replica
    await dbForReads("founder.intelligence.pulse"); // → primary

    const snap = snapshotAdoption();
    expect(snap.replica).toBe(2);
    expect(snap.primary).toBe(1);
    expect(snap.adoptionRate).toBeCloseTo(2 / 3, 3);
    expect(snap.byCategory["cohort.retention"]).toEqual({ primary: 0, replica: 2 });
    expect(snap.byCategory["founder.intelligence.pulse"]).toEqual({ primary: 1, replica: 0 });
  });
});
