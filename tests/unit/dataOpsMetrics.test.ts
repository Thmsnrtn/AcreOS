/**
 * D2g — data-sourcing ops metrics: the pure folds the endpoint serves.
 * The endpoint's mount and token discipline: dataOpsMetrics.endpoint.test.ts.
 * The answering-layer vocabulary (population law): dataOpsMetrics.layerVocabulary.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  foldCoverageByState,
  foldFallThrough,
  foldReleaseInventory,
  foldRemapRates,
  foldStatewideBuilds,
  foldWarehouseCost,
  RELEASE_INVENTORY_NOT_BUILT,
  type LayerCount,
} from "../../server/services/ops/dataOpsMetrics";

const row = (answeringLayer: string | null, n: number, over: Partial<LayerCount> = {}): LayerCount => ({
  answeringLayer,
  success: true,
  cached: answeringLayer === "cache",
  probe: false,
  n,
  ...over,
});

describe("paid fall-through per 1,000 answers served", () => {
  it("counts only vendor-billed answers; BYOK and warehouse answers are not paid fall-through", () => {
    const f = foldFallThrough([row("open_data", 700), row("cache", 200), row("vendor", 50), row("vendor_byok", 50)], 30);
    expect(f.answersServed).toBe(1000);
    expect(f.paidPer1k).toBe(50);
    expect(f.byBucket).toEqual({ warehouse: 900, paid_platform: 50, paid_byok: 50 });
  });

  it("a FAILED vendor attempt served nothing: it is a failed attempt, not a paid answer, and not in the denominator", () => {
    const f = foldFallThrough([row("vendor", 10), row("vendor", 500, { success: false }), row("open_data", 990)], 30);
    expect(f.paidPer1k).toBe(10);
    expect(f.failedAttempts).toBe(500);
    expect(f.byLayer.vendor).toEqual({ answered: 10, failed: 500 });
  });

  it("canary probes are telemetry, not demand: counted apart and kept out of every rate", () => {
    const f = foldFallThrough([row("vendor", 10), row("open_data", 990), row(null, 40, { probe: true }), row("vendor", 4000, { probe: true })], 30);
    expect(f.probes).toBe(4040);
    expect(f.totalRows).toBe(5040);
    expect(f.paidPer1k).toBe(10);
    expect(f.unattributed.rows).toBe(0);
  });

  it("rows with no layer are unattributed (split by the writer's cached flag) and kept out of the rate", () => {
    const f = foldFallThrough([row(null, 9000), row(null, 300, { cached: true }), row("vendor", 10), row("open_data", 990)], 30);
    expect(f.unattributed).toEqual({ rows: 9300, cachedFlag: 300, notCachedFlag: 9000 });
    expect(f.paidPer1k).toBe(10);
  });

  it("a layer value with no bucket is reported in unknownLayers — never silently dropped, never in the rate", () => {
    const f = foldFallThrough([row("owned_release", 77), row("vendor", 10), row("open_data", 990)], 30);
    expect(f.unknownLayers).toEqual({ owned_release: 77 });
    expect(f.answersServed).toBe(1000);
    expect(f.totalRows).toBe(1077);
  });

  it("every row lands somewhere: buckets + failed + unattributed + unknown + probes = totalRows", () => {
    const f = foldFallThrough(
      [row("open_data", 5), row("cache", 6), row("vendor", 7), row("vendor_byok", 8), row("vendor", 9, { success: false }), row(null, 10), row("x", 11), row("vendor", 12, { probe: true })],
      7,
    );
    const unknown = Object.values(f.unknownLayers).reduce((a, b) => a + b, 0);
    expect(f.answersServed + f.failedAttempts + f.unattributed.rows + unknown + f.probes).toBe(f.totalRows);
    expect(f.totalRows).toBe(68);
  });

  it("no answers is a null rate, never 0", () => {
    expect(foldFallThrough([], 30).paidPer1k).toBeNull();
    expect(foldFallThrough([row(null, 50)], 30).paidPer1k).toBeNull();
  });
});

describe("warehouse cost per served lookup", () => {
  it("reports served answers and the target, and says the cost is not measured — never an estimate over a count", () => {
    const w = foldWarehouseCost(foldFallThrough([row("open_data", 30), row("cache", 12), row("vendor", 5), row("cache", 3, { success: false }), row(null, 9, { cached: true })], 30));
    expect(w).toMatchObject({ warehouseServedLookups: 42, cacheFlaggedWithoutLayer: 9, targetUsd: 0.001, costPerLookupUsd: null });
    expect(w.why).toMatch(/not measured/);
  });
});

describe("coverage by state — a stated denominator, no invented totals", () => {
  const rows = [
    { state: "FL", status: "complete", counties: 3, parcelsStored: 120_000 },
    { state: "FL", status: "processing", counties: 1, parcelsStored: 4_000 },
    { state: "FL", status: "pending", counties: 2, parcelsStored: 0 },
    { state: "FL", status: null, counties: 10, parcelsStored: 0 },
    { state: "NC", status: "refused", counties: 1, parcelsStored: 0 },
    { state: "NC", status: "failed", counties: 1, parcelsStored: 0 },
    { state: "NC", status: "archived", counties: 2, parcelsStored: 5 },
  ];
  it("owned / known / parcels per state; known = counties the queue has a row for", () => {
    const by = foldCoverageByState(rows);
    expect(by.map((s) => s.state)).toEqual(["FL", "NC"]);
    expect(by[0]).toEqual({ state: "FL", countiesOwned: 3, countiesKnown: 16, inProgress: 3, refused: 0, failed: 0, neverRequested: 10, otherStatus: 0, parcelsStored: 124_000 });
  });
  it("a status outside the pipeline lifecycle is counted in otherStatus, and every county is in exactly one bucket", () => {
    const nc = foldCoverageByState(rows).find((s) => s.state === "NC")!;
    expect(nc).toMatchObject({ countiesOwned: 0, refused: 1, failed: 1, otherStatus: 2, countiesKnown: 4, parcelsStored: 5 });
    for (const s of foldCoverageByState(rows)) {
      expect(s.countiesOwned + s.inProgress + s.refused + s.failed + s.neverRequested + s.otherStatus).toBe(s.countiesKnown);
    }
  });
  it("no rows is no states — never a zero-filled list of states nobody asked about", () => {
    expect(foldCoverageByState([])).toEqual([]);
  });
});

describe("release inventory (D2b)", () => {
  const rel = (name: string, createdAt: string, current = false) => ({ releaseId: `SYNTHETIC-${name}`, name, createdAt, current, countyCount: 4, parcelCount: 1000 });
  it("absent store reads not_built with its reason — not an empty list", () => {
    expect(RELEASE_INVENTORY_NOT_BUILT).toEqual({ status: "not_built", why: "no release store exists yet (D2b)" });
    expect(RELEASE_INVENTORY_NOT_BUILT).not.toHaveProperty("releases");
  });
  it("with a store: newest first, the current release, malformed names reported", () => {
    const inv = foldReleaseInventory([rel("v2026.09.1", "2026-09-02T00:00:00Z"), rel("v2026.10.2", "2026-10-20T00:00:00Z", true), rel("2026-10-3", "2026-10-22T00:00:00Z")]);
    if (inv.status !== "reported") throw new Error("expected reported");
    expect(inv.releaseCount).toBe(3);
    expect(inv.releases.map((r) => r.name)).toEqual(["2026-10-3", "v2026.10.2", "v2026.09.1"]);
    expect(inv.current?.name).toBe("v2026.10.2");
    expect(inv.currentConflict).toBe(false);
    expect(inv.malformedNames).toEqual(["2026-10-3"]);
  });
  it("two releases flagged current is a conflict, reported — never resolved by picking one", () => {
    const inv = foldReleaseInventory([rel("v2026.10.1", "2026-10-01T00:00:00Z", true), rel("v2026.10.2", "2026-10-02T00:00:00Z", true)]);
    expect(inv).toMatchObject({ status: "reported", current: null, currentConflict: true });
  });
  it("a store with no releases reports zero explicitly — distinct from not_built", () => {
    expect(foldReleaseInventory([])).toMatchObject({ status: "reported", releaseCount: 0, current: null });
  });
});

describe("adapter remap rates and statewide build status", () => {
  const rows = [
    { jobName: "fl_statewide_cadastral_v1", status: "failure", observation: { kind: "statewide_cadastral_drift", remap: { outcome: "rejected" } } },
    { jobName: "fl_statewide_cadastral_v1", status: "success", observation: { remap: { outcome: "promoted" }, outcome: { status: "dry_run_only" }, summary: { county: "55", normalized: 5000, peakRssMb: 220 } } },
    { jobName: "fl_statewide_cadastral_v1", status: "success", observation: { remap: null, outcome: { status: "dry_run_only" }, summary: { county: "55", normalized: 5000, peakRssMb: 210 } } },
    { jobName: "nc_statewide_cadastral_v1", status: "success", observation: { remap: null, outcome: { status: "dry_run_only" }, summary: { county: "Wake", normalized: 100, peakRssMb: 190 } } },
  ];
  it("per job: runs, attempts by outcome, promotion rate", () => {
    const fl = foldRemapRates(rows).find((j) => j.jobName === "fl_statewide_cadastral_v1")!;
    expect(fl).toMatchObject({ runs: 3, attempts: 2, promoted: 1, rejected: 1, noProposal: 0, promotionRate: 0.333, latestOutcome: "rejected" });
    expect(foldRemapRates(rows).find((j) => j.jobName === "nc_statewide_cadastral_v1")?.promotionRate).toBe(0);
  });
  it("latest build per job (rows newest first); a failed run reads 'failed', not its last good outcome", () => {
    const b = foldStatewideBuilds(rows);
    expect(b.find((x) => x.jobName === "fl_statewide_cadastral_v1")).toMatchObject({ lastRunStatus: "failure", outcome: "failed" });
    expect(b.find((x) => x.jobName === "nc_statewide_cadastral_v1")).toMatchObject({ outcome: "dry_run_only", county: "Wake", normalized: 100 });
  });
});
