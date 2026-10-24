/**
 * D2g — data-sourcing ops metrics: the folds the endpoint serves, and the
 * endpoint's mount (read-only, service-token gated, on the real registrar).
 */
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const loadMock = vi.fn(async () => ({ asOf: "x", fallThrough: { total: 0 } }));
vi.mock("../../server/services/ops/dataOpsMetrics", async (orig) => ({ ...(await orig<object>()), loadDataOpsMetrics: (...a: unknown[]) => loadMock(...(a as [])) }));

import { foldFallThrough, foldRemapRates, foldStatewideBuilds, foldWarehouseCost } from "../../server/services/ops/dataOpsMetrics";
import { registerOpsRoutes } from "../../server/routes-ops";

describe("paid fall-through per 1,000 lookups", () => {
  it("counts only vendor-billed answers; BYOK and warehouse answers are not paid fall-through", () => {
    const f = foldFallThrough(
      [
        { answeringLayer: "open_data", n: 700 },
        { answeringLayer: "cache", n: 200 },
        { answeringLayer: "vendor", n: 50 },
        { answeringLayer: "vendor_byok", n: 50 },
      ],
      30,
    );
    expect(f.total).toBe(1000);
    expect(f.paidPer1k).toBe(50);
  });

  it("pre-0287 rows with no layer are counted as unattributed and kept out of the rate", () => {
    const f = foldFallThrough([{ answeringLayer: null, n: 9000 }, { answeringLayer: "vendor", n: 10 }, { answeringLayer: "open_data", n: 990 }], 30);
    expect(f.unattributed).toBe(9000);
    expect(f.paidPer1k).toBe(10);
  });

  it("no lookups is a null rate, never 0", () => {
    expect(foldFallThrough([], 30).paidPer1k).toBeNull();
  });
});

describe("warehouse cost per served lookup", () => {
  it("reports served lookups and the target, and says the cost is not measured — never an estimate over a count", () => {
    const w = foldWarehouseCost(foldFallThrough([{ answeringLayer: "open_data", n: 30 }, { answeringLayer: "cache", n: 12 }, { answeringLayer: "vendor", n: 5 }], 30));
    expect(w).toMatchObject({ warehouseServedLookups: 42, targetUsd: 0.001, costPerLookupUsd: null });
    expect(w.why).toMatch(/not measured/);
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
    expect(fl).toMatchObject({ runs: 3, attempts: 2, promoted: 1, rejected: 1, noProposal: 0, promotionRate: 0.333 });
    expect(foldRemapRates(rows).find((j) => j.jobName === "nc_statewide_cadastral_v1")?.promotionRate).toBe(0);
  });
  it("latest build per job (rows newest first); a failed run reads 'failed', not its last good outcome", () => {
    const b = foldStatewideBuilds(rows);
    expect(b.find((x) => x.jobName === "fl_statewide_cadastral_v1")).toMatchObject({ lastRunStatus: "failure", outcome: "failed" });
    expect(b.find((x) => x.jobName === "nc_statewide_cadastral_v1")).toMatchObject({ outcome: "dry_run_only", county: "Wake", normalized: 100 });
  });
});

describe("GET /api/ops/data — mounted on the real registrar, token-gated, read-only", () => {
  const app = () => {
    const a = express();
    registerOpsRoutes(a);
    return a;
  };
  it("503 without a configured token; 401 with a wrong one; 200 with the right one", async () => {
    delete process.env.OPS_SERVICE_TOKEN;
    expect((await request(app()).get("/api/ops/data")).status).toBe(503);
    process.env.OPS_SERVICE_TOKEN = "t".repeat(40);
    expect((await request(app()).get("/api/ops/data").set("Authorization", "Bearer wrong")).status).toBe(401);
    const ok = await request(app()).get("/api/ops/data?days=7").set("Authorization", `Bearer ${"t".repeat(40)}`);
    expect(ok.status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith(expect.any(Date), 7);
    expect((await request(app()).post("/api/ops/data").set("Authorization", `Bearer ${"t".repeat(40)}`)).status).toBe(404);
    delete process.env.OPS_SERVICE_TOKEN;
  });
});
