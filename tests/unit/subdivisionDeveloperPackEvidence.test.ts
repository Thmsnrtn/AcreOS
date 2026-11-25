/**
 * Developer bar-(b) items 1+2 — static evidence for the shared subdivision desk.
 *
 * The desk (server/routes-subdivision-decision.ts) records under TWO literal
 * packs on one handler: "subdivider" and "developer", both citing the
 * `subdivision_feasibility` engine, which declares both verticals. These
 * tests pin, through the same parser the readiness gate uses
 * (tests/support/verticalEvidence.ts):
 *   1. the REAL route file credits BOTH packs — two literal call sites, each
 *      citing the declaring engine, neither review date hard-null;
 *   2. MUTATION CANARY: a "developer" pack citing an engine that does NOT
 *      declare developer is uncredited (the static half of the canary; the
 *      runtime half — the kit refuses it before any write — lives in
 *      subdivisionFeasibility.test.ts);
 *   3. MUTATION CANARY: a computed pack value is uncredited, even when the
 *      variable's initializer is the string "developer" — a `let`, a
 *      parameter, or any non-literal expression is evidence of nothing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzeRouteSource, creditVerticals, engineVerticals } from "../support/verticalEvidence";

const ROOT = path.resolve(__dirname, "../..");
const engines = engineVerticals();
const NO_CONSTANTS = new Map<string, string>();

const IMPORTS = `import { recordScenario } from "./services/economics/scenarioStore";
import { recordDecision } from "./services/decisions/decisionStore";
import { recordUnderwrittenDecision } from "./services/underwriting/verticalDecision";
`;
const facts = (body: string) => analyzeRouteSource("server/routes-x.ts", IMPORTS + body, NO_CONSTANTS);
const credit = (f: ReturnType<typeof facts>) =>
  creditVerticals([{ file: "server/routes-x.ts", facts: f, reachable: f.decisions.map(() => true) }], engines);

describe("developer bar-(b) — the engine declaration (item 1)", () => {
  it("subdivision_feasibility declares subdivider + developer and is gradeable (it produces profit)", () => {
    expect(engines.get("subdivision_feasibility")).toEqual({ verticals: ["subdivider", "developer"], gradeable: true });
  });
});

describe("developer bar-(b) — the real desk route credits both packs (item 2)", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/routes-subdivision-decision.ts"), "utf8");
  const f = analyzeRouteSource("server/routes-subdivision-decision.ts", src, NO_CONSTANTS);

  it("has exactly two kit call sites: the literal 'subdivider' and 'developer' packs, each citing subdivision_feasibility", () => {
    expect(f.decisions).toHaveLength(2);
    expect(f.decisions.map((d) => d.pack).sort()).toEqual(["developer", "subdivider"]);
    for (const d of f.decisions) {
      expect(d.citedEngineIds).toEqual(["subdivision_feasibility"]);
      expect(d.handlerPath).toBe("/api/subdivision/decide");
      expect(d.reviewHardNull).toBe(false);
    }
    expect(f.scenarioEngineIds).toEqual(["subdivision_feasibility", "subdivision_feasibility"]);
  });

  it("both packs credit + grade through the engine rule on the real file's facts", () => {
    const c = creditVerticals(
      [{ file: "server/routes-subdivision-decision.ts", facts: f, reachable: f.decisions.map(() => true) }],
      engines,
    );
    expect(c.deciding.has("developer")).toBe(true);
    expect(c.deciding.has("subdivider")).toBe(true);
    expect(c.gradeable.has("developer")).toBe(true);
    expect(c.gradeable.has("subdivider")).toBe(true);
    expect(c.engineDecidedBy.get("developer")).toEqual(["server/routes-subdivision-decision.ts"]);
  });
});

describe("developer bar-(b) — mutation canaries", () => {
  it("canary: a 'developer' pack citing a non-declaring engine (flip_mao) is uncredited", () => {
    const f = facts(`router.post("/x", async () => {
      await recordUnderwrittenDecision(o, { engineId: "flip_mao", strategyPackId: "developer", reviewDueAt: d });
    });`);
    expect(f.decisions[0]).toMatchObject({ pack: "developer", citedEngineIds: ["flip_mao"] });
    const c = credit(f);
    expect(c.deciding.has("developer")).toBe(false);
    expect(c.gradeable.has("developer")).toBe(false);
  });

  it("canary: a computed pack value is uncredited — variable, ternary and call results are not literals", () => {
    const computed = facts(`router.post("/x", async () => {
      const pack = orgType === "developer" ? "developer" : "subdivider";
      await recordUnderwrittenDecision(o, { engineId: "subdivision_feasibility", strategyPackId: pack, reviewDueAt: d });
    });`);
    expect(computed.decisions[0].pack).toBeNull();
    expect(credit(computed).deciding.has("developer")).toBe(false);
    expect(credit(computed).deciding.has("subdivider")).toBe(false);

    const viaCall = facts(`router.post("/x", async () => {
      await recordUnderwrittenDecision(o, { engineId: "subdivision_feasibility", strategyPackId: pickPack(), reviewDueAt: d });
    });`);
    expect(viaCall.decisions[0].pack).toBeNull();
    expect(credit(viaCall).deciding.size).toBe(0);
  });

  it("canary: the cross-handler shape stays uncredited — a developer decision citing another handler's scenario credits nothing", () => {
    const f = facts(`router.post("/a", async () => { const s = await recordScenario(o, { engineId: "subdivision_feasibility" }); });
      router.post("/b", async () => {
        const s = await recordScenario(o, { engineId: "land_deal" });
        await recordDecision(o, { strategyPackId: "developer", reviewDueAt: d }, new Date(), [s.id]);
      });`);
    expect(f.decisions[0].citedEngineIds).toEqual(["land_deal"]);
    expect(credit(f).deciding.has("developer")).toBe(false);
  });
});
