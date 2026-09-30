/**
 * Audit of e3debe0 — a stage transition's evidence was recorded only by
 * `PUT /api/deals/:id`. A deal moved to offer_sent by a Kanban drag, a swipe,
 * a bulk move or Pax never counted as an offer made; a closed deal reopened by
 * any of them stayed a sale comp in the valuation corpus; and
 * `/api/deals/bulk-stage-update` emitted no stage change at all.
 *
 * The population is every `emitDealStageChanged(` call in server/, enumerated
 * from the source: each must be paired with `recordDealTransitionEvidence(`
 * over the same before/after, so a new stage-change path that skips the
 * evidence is the thing that fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const H = vi.hoisted(() => ({
  activation: [] as Array<Record<string, unknown>>,
  retracted: [] as Array<[number, string]>,
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitDealEvent: vi.fn(), emitDurableDealEvent: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: (a: Record<string, unknown>) => void H.activation.push(a),
}));
vi.mock("../../server/services/acreOSValuation", () => ({
  acreOSValuation: { retractTrainingTransaction: async (o: number, k: string) => void H.retracted.push([o, k]) },
}));
vi.mock("../../server/services/marketNetworkContributor", () => ({
  closedSaleDealKey: (o: number, d: number) => `key-${o}-${d}`,
}));

const ROOT = path.resolve(__dirname, "../..");
function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  H.activation = [];
  H.retracted = [];
});

describe("every stage-change path records the transition's evidence", () => {
  it("each emitDealStageChanged call is paired with recordDealTransitionEvidence over the same rows", () => {
    let sites = 0;
    const unpaired: string[] = [];
    for (const abs of serverFiles()) {
      if (abs.endsWith(path.join("services", "dealEvents.ts"))) continue;
      const src = stripComments(fs.readFileSync(abs, "utf8"));
      for (const m of src.matchAll(/emitDealStageChanged\(([^;]*?)\);/g)) {
        sites++;
        const args = m[1].replace(/\s+/g, " ").trim();
        const after = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 300);
        const paired = new RegExp(
          String.raw`^\s*recordDealTransitionEvidence\(\s*` + args.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*"),
        );
        if (!paired.test(after)) unpaired.push(`${path.relative(ROOT, abs)}: emitDealStageChanged(${args})`);
      }
    }
    // Vacuity: PUT, PATCH /stage, bulk-update, advance-stage, bulk-stage-update, Pax update_deal, Pax draft_offer.
    expect(sites).toBeGreaterThanOrEqual(7);
    expect(unpaired, unpaired.join("\n")).toEqual([]);
  });
});

describe("recordDealTransitionEvidence", () => {
  it("entering offer_sent records the first offer made", async () => {
    const { recordDealTransitionEvidence } = await import("../../server/services/dealEvents");
    recordDealTransitionEvidence(5, { id: 9, status: "negotiating" }, { id: 9, status: "offer_sent", offerAmount: "12000" }, "u1");
    await flush();
    expect(H.activation).toEqual([
      expect.objectContaining({ orgId: 5, userId: "u1", eventName: "first_offer_made", eventValue: { dealId: 9, offerAmount: "12000" } }),
    ]);
    expect(H.retracted).toEqual([]);
  });

  it("leaving closed retracts the sale the close recorded", async () => {
    const { recordDealTransitionEvidence } = await import("../../server/services/dealEvents");
    recordDealTransitionEvidence(5, { id: 9, status: "closed" }, { id: 9, status: "negotiating" });
    await flush();
    expect(H.retracted).toEqual([[5, "deal:key-5-9"]]);
    expect(H.activation).toEqual([]);
  });

  it("no transition, no evidence", async () => {
    const { recordDealTransitionEvidence } = await import("../../server/services/dealEvents");
    recordDealTransitionEvidence(5, { id: 9, status: "offer_sent" }, { id: 9, status: "offer_sent" });
    recordDealTransitionEvidence(5, null, { id: 9, status: "offer_sent" });
    await flush();
    expect(H.activation).toEqual([]);
    expect(H.retracted).toEqual([]);
  });
});
