import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ budget: vi.fn(), insert: vi.fn(), values: vi.fn(), generate: vi.fn(), persist: vi.fn(), score: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: h.budget }) }), insert: h.insert } }));
vi.mock("../../server/services/cmo/brandProfiles", () => ({ getAcreosBrandProfile: async () => ({ id: 1, autoGenerationEnabled: true }), seedAcreosBrandProfile: vi.fn() }));
vi.mock("../../server/services/cmo/scriptGenerator", () => ({ generateScripts: h.generate, persistScripts: h.persist }));
vi.mock("../../server/services/cmo/scriptScorer", () => ({ scoreScript: h.score }));
import { generateBundle } from "../../server/services/agents/cmoAgent";
const brief = { intent: "Research parcels", count: 1, funnelStage: "cold" as const, source: "manual_request" as const, generationJobId: 42 };
beforeEach(() => {
  vi.resetAllMocks(); h.insert.mockReturnValue({ values: h.values });
  h.budget.mockResolvedValue([{ spendTodayCents: 0, dailyCapCents: 100 }]);
  h.generate.mockResolvedValue({ scripts: [], model: "fixture", costCents: 2 });
  h.persist.mockResolvedValue([{ id: "script-1", status: "draft" }]);
  h.score.mockResolvedValue({ passed: true, script: { id: "script-1" }, costCents: 1 });
});
describe("CMO operating budget and job lineage", () => {
  it("refuses absent budget configuration before any provider call", async () => {
    h.budget.mockResolvedValue([]);
    expect(await generateBundle(brief)).toMatchObject({ blockedBy: "operating_budget_unavailable", renderJobsQueued: 0, totalCostCents: 0 });
    expect(h.generate).not.toHaveBeenCalled(); expect(h.insert).not.toHaveBeenCalled();
  });
  it("refuses an exhausted daily cap before any provider call", async () => {
    h.budget.mockResolvedValue([{ spendTodayCents: 100, dailyCapCents: 100 }]);
    expect(await generateBundle(brief)).toMatchObject({ blockedBy: "daily_budget_exceeded" });
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("does not turn a failed budget read into permission to spend", async () => {
    h.budget.mockRejectedValue(new Error("database unavailable"));
    await expect(generateBundle(brief)).rejects.toThrow("database unavailable");
    expect(h.generate).not.toHaveBeenCalled();
  });
  it("carries the worker's accepted request identity into each render job", async () => {
    expect(await generateBundle(brief)).toMatchObject({ scriptsGenerated: 1, renderJobsQueued: 1, totalCostCents: 3 });
    expect(h.values).toHaveBeenCalledWith(expect.objectContaining({ eventType: "cmo.render-script", payload: expect.objectContaining({ generationJobId: 42, scriptId: "script-1" }) }));
  });
});
