/**
 * Unit tests for the optimistic-mutation factory's internal patch+rollback
 * logic. We exercise `patchListCaches` directly against a real QueryClient
 * — that's where all the cache-shape edge cases live (flat arrays vs.
 * paginated `{ data: [...] }`, detail caches, multi-key snapshots). The
 * full hook is exercised in app code (use-leads, use-deals, etc); these
 * tests pin the cache mutation contract.
 */

import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  patchDetailCache,
  patchListCaches,
} from "../../client/src/lib/optimistic-mutation";

type Snapshot = [readonly unknown[], unknown];

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("patchListCaches — flat array cache", () => {
  it("patches the matching row by id and snapshots the prior value", () => {
    const qc = makeClient();
    qc.setQueryData(["/api/leads"], [
      { id: 1, name: "Alpha", stage: "new" },
      { id: 2, name: "Bravo", stage: "new" },
    ]);

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/leads"]], 2, { stage: "contacted" }, snapshots);

    expect(qc.getQueryData(["/api/leads"])).toEqual([
      { id: 1, name: "Alpha", stage: "new" },
      { id: 2, name: "Bravo", stage: "contacted" },
    ]);
    expect(snapshots).toHaveLength(1);
    // Rollback restores the original.
    for (const [key, value] of snapshots) qc.setQueryData(key, value);
    expect(qc.getQueryData(["/api/leads"])).toEqual([
      { id: 1, name: "Alpha", stage: "new" },
      { id: 2, name: "Bravo", stage: "new" },
    ]);
  });

  it("is a no-op when no row matches the id", () => {
    const qc = makeClient();
    const original = [{ id: 1, name: "Alpha" }];
    qc.setQueryData(["/api/leads"], original);

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/leads"]], 999, { name: "X" }, snapshots);

    // We still snapshot the key (cancel/restore semantics), but data is
    // identical row-wise.
    expect(qc.getQueryData(["/api/leads"])).toEqual([{ id: 1, name: "Alpha" }]);
    expect(snapshots).toHaveLength(1);
  });
});

describe("patchListCaches — paginated { data: [] } cache", () => {
  it("patches inside the data array and preserves siblings", () => {
    const qc = makeClient();
    qc.setQueryData(["/api/leads", "paginated", 1, 10], {
      data: [
        { id: 1, name: "Alpha" },
        { id: 2, name: "Bravo" },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/leads"]], 1, { name: "Alpha-renamed" }, snapshots);

    const updated = qc.getQueryData<{ data: any[]; total: number }>([
      "/api/leads",
      "paginated",
      1,
      10,
    ])!;
    expect(updated.data[0]).toEqual({ id: 1, name: "Alpha-renamed" });
    expect(updated.data[1]).toEqual({ id: 2, name: "Bravo" });
    expect(updated.total).toBe(2);
  });
});

describe("patchListCaches — multi-key prefix walk", () => {
  it("touches every cache whose key starts with the prefix", () => {
    const qc = makeClient();
    qc.setQueryData(["/api/deals"], [{ id: 7, stage: "negotiation" }]);
    qc.setQueryData(["/api/deals", "paginated", 1, 50], {
      data: [{ id: 7, stage: "negotiation" }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/deals"]], 7, { stage: "closed_won" }, snapshots);

    expect(qc.getQueryData(["/api/deals"])).toEqual([
      { id: 7, stage: "closed_won" },
    ]);
    expect(
      (qc.getQueryData(["/api/deals", "paginated", 1, 50]) as any).data[0].stage,
    ).toBe("closed_won");
    // One snapshot per cache key we touched.
    expect(snapshots).toHaveLength(2);
  });

  it("rolls back every touched cache when the snapshots are replayed", () => {
    const qc = makeClient();
    const flat = [{ id: 7, stage: "negotiation" }];
    const paged = {
      data: [{ id: 7, stage: "negotiation" }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    };
    qc.setQueryData(["/api/deals"], flat);
    qc.setQueryData(["/api/deals", "paginated", 1, 50], paged);

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/deals"]], 7, { stage: "closed_won" }, snapshots);
    // Now rollback.
    for (const [key, value] of snapshots) qc.setQueryData(key, value);

    expect(qc.getQueryData(["/api/deals"])).toEqual(flat);
    expect(qc.getQueryData(["/api/deals", "paginated", 1, 50])).toEqual(paged);
  });
});

describe("patchListCaches — single-entity-as-value fallback", () => {
  it("patches a cache that happens to be a single object with matching id", () => {
    const qc = makeClient();
    qc.setQueryData(["/api/deals", 42], { id: 42, stage: "negotiation" });

    const snapshots: Snapshot[] = [];
    // Using the prefix walks the [42] cache too.
    patchListCaches(qc, [["/api/deals"]], 42, { stage: "closed_won" }, snapshots);

    expect(qc.getQueryData(["/api/deals", 42])).toEqual({
      id: 42,
      stage: "closed_won",
    });
  });
});

describe("patchDetailCache — detail key overlapping a list prefix", () => {
  // Regression: useUpdateDeal's config (listKeys [["/api/deals"]] +
  // detailKey ["/api/deals", id]) made the prefix walk capture the detail
  // entry first; the detail pass then snapshotted the *already-patched*
  // value, so replaying snapshots in order restored pre-patch and then
  // re-applied the failed optimistic state.
  it("does not double-snapshot when the prefix walk already captured the key", () => {
    const qc = makeClient();
    const original = { id: 42, stage: "negotiation" };
    qc.setQueryData(["/api/deals", 42], original);

    const snapshots: Snapshot[] = [];
    patchListCaches(qc, [["/api/deals"]], 42, { stage: "closed_won" }, snapshots);
    patchDetailCache(qc, ["/api/deals", 42], { stage: "closed_won" }, snapshots);

    // Exactly one snapshot for the detail key — the pre-patch value.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0][1]).toEqual(original);

    // Rollback (replayed in order, as onError does) restores pre-patch.
    for (const [key, value] of snapshots) qc.setQueryData(key, value);
    expect(qc.getQueryData(["/api/deals", 42])).toEqual(original);
  });

  it("still snapshots+patches a detail key the prefix walk did not touch", () => {
    const qc = makeClient();
    const original = { id: 7, name: "Alpha", stage: "new" };
    qc.setQueryData(["/api/leads/detail", 7], original);

    const snapshots: Snapshot[] = [];
    patchDetailCache(qc, ["/api/leads/detail", 7], { stage: "contacted" }, snapshots);

    expect(qc.getQueryData(["/api/leads/detail", 7])).toEqual({
      id: 7,
      name: "Alpha",
      stage: "contacted",
    });
    expect(snapshots).toEqual([[["/api/leads/detail", 7], original]]);
  });

  it("is a no-op when the detail cache is empty", () => {
    const qc = makeClient();
    const snapshots: Snapshot[] = [];
    patchDetailCache(qc, ["/api/leads/detail", 99], { stage: "x" }, snapshots);
    expect(snapshots).toHaveLength(0);
    expect(qc.getQueryData(["/api/leads/detail", 99])).toBeUndefined();
  });
});
