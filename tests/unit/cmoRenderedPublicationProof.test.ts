import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { getTableName } from "drizzle-orm";
const h = vi.hoisted(() => ({ script: vi.fn(), brand: vi.fn(), insert: vi.fn(), update: vi.fn(), read: vi.fn(), spawn: vi.fn(), readyRows: [] as any[], row: {} as any }));
vi.mock("../../server/db", () => ({ db: { query: { cmoScripts: { findFirst: h.script }, brandProfiles: { findFirst: h.brand } }, insert: h.insert, update: h.update } }));
vi.mock("child_process", () => ({ spawn: h.spawn }));
vi.mock("../../server/integrations/stockAssets", () => ({ fetchStockClips: async () => [], recordAssetUsage: vi.fn() }));
vi.mock("../../server/integrations/elevenLabs", () => ({ generateVoiceover: async () => ({ costCents: 0, storagePath: "local:voice.mp3" }) }));
vi.mock("../../server/services/cmo/storage", () => ({ getStorage: () => ({ read: h.read, url: async () => "/fixture.mp3" }), renderKey: (id: string, file: string) => `${id}/${file}` }));
vi.mock("../../server/services/cmo/costTracker", () => ({ emptyBreakdown: () => ({ totalCents: 0 }), addCost: (cost: unknown) => cost, chargeBudget: vi.fn(), estimateRenderCostCents: () => 0 }));
import { renderScriptToBundle } from "../../server/services/cmo/renderOrchestrator";
const bytes = Buffer.from("actual-render-output-fixture");
beforeEach(() => {
  vi.resetAllMocks(); h.readyRows = [];
  h.script.mockResolvedValue({ id: "script", brandProfileId: 1, status: "scored", generationCostCents: 0, scoringCostCents: 0, brollQueries: [], voiceId: "fixture", hook: "Reviewed hook", body: "Reviewed body", cta: "Sign up", hookArchetype: "fixture", funnelStage: "cold", lengthTargetSec: 15 });
  h.brand.mockResolvedValue({ id: 1, slug: "acreos", displayName: "AcreOS", voice: {}, funnelStages: { cold: { ctaUrl: "https://acreos.io/frozen" } }, brandKit: { primaryColor: "black", secondaryColor: "white", fonts: { display: "sans", body: "sans" } } });
  h.read.mockResolvedValue(bytes);
  h.insert.mockImplementation(table => ({ values: (value: any) => ({ returning: async () => {
    if (getTableName(table) === "cmo_ad_renders") { h.row = value; return [value]; }
    return [{ ...value, id: 1 }];
  } }) }));
  h.update.mockImplementation(table => ({ set: (value: any) => ({ where: () => {
    if (getTableName(table) === "cmo_ad_renders" && value.status === "ready") h.readyRows.push(value);
    return { returning: async () => [{ ...h.row, ...value }] };
  } }) }));
  h.spawn.mockImplementation(() => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: (event: string, cb: (code: number) => void) => { if (event === "close") queueMicrotask(() => cb(0)); } }));
});
it("the actual producer persists the render byte digest and the same CTA baked into Remotion", async () => {
  const result = await renderScriptToBundle({ scriptId: "script", aspectRatios: ["9:16"] });
  const props = JSON.parse(h.spawn.mock.calls[0][1].find((arg: string) => arg.startsWith("--props=")).slice(8));
  const proof = h.readyRows[0].manifestJson.publication;
  expect(proof.video).toEqual({ sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length });
  expect(proof.copy.ctaUrl).toBe(props.ctaUrl); expect(props.ctaUrl).toBe("https://acreos.io/frozen");
  expect(proof.copy.primaryText).toBe("Reviewed body"); expect(result.renders).toHaveLength(1);
});
it("never makes unreadable output ready or creates an approval bundle", async () => {
  h.read.mockRejectedValue(new Error("missing output"));
  await expect(renderScriptToBundle({ scriptId: "script", aspectRatios: ["9:16"] })).rejects.toThrow("all aspect ratios failed");
  expect(h.readyRows).toHaveLength(0);
  expect(h.insert.mock.calls.map(([table]) => getTableName(table))).toEqual(["cmo_ad_renders"]);
});
