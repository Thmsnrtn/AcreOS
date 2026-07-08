import { describe, it, expect } from "vitest";
import { parseSteerCommand, handleSteer, type SteerDeps } from "../../server/services/autopilot/steer";

describe("autopilot conversational steering — parse natural language safely", () => {
  it("pauses a domain on safety-first verbs", () => {
    expect(parseSteerCommand("pause growth")).toEqual({ kind: "pause_domain", domain: "growth" });
    expect(parseSteerCommand("stop support for now")).toEqual({ kind: "pause_domain", domain: "support" });
    expect(parseSteerCommand("hold the deploys")).toEqual({ kind: "pause_domain", domain: "deploy" });
  });

  it("trusts a domain to act more", () => {
    expect(parseSteerCommand("trust growth")).toEqual({ kind: "trust_domain", domain: "growth" });
    expect(parseSteerCommand("let support run on its own")).toEqual({ kind: "trust_domain", domain: "support" });
  });

  it("recognizes a standing order (a durable rule)", () => {
    expect(parseSteerCommand("never email anyone twice in a week")).toMatchObject({ kind: "set_standing_order" });
    expect(parseSteerCommand("don't run cold outreach")).toMatchObject({ kind: "set_standing_order" });
    expect(parseSteerCommand("always cite the source county")).toMatchObject({ kind: "set_standing_order" });
  });

  it("recognizes an intent (a north-star goal)", () => {
    expect(parseSteerCommand("focus on Texas tax-delinquent investors")).toMatchObject({
      kind: "set_intent",
      body: "focus on Texas tax-delinquent investors",
    });
    expect(parseSteerCommand("prioritize reaching $1k MRR")).toMatchObject({ kind: "set_intent" });
  });

  it("routes why / explain to the reasoning trace", () => {
    expect(parseSteerCommand("why did you do that?")).toEqual({ kind: "why" });
    expect(parseSteerCommand("explain your last move")).toEqual({ kind: "why" });
  });

  it("routes status questions, extracting a domain when named", () => {
    expect(parseSteerCommand("how's growth doing?")).toEqual({ kind: "status", domain: "growth" });
    expect(parseSteerCommand("what's the plan?")).toEqual({ kind: "status", domain: undefined });
    expect(parseSteerCommand("status")).toEqual({ kind: "status", domain: undefined });
  });

  it("HONESTY: an unrecognized command is 'unknown' — it never guesses a destructive action", () => {
    expect(parseSteerCommand("xyzzy frobnicate the thing")).toMatchObject({ kind: "unknown" });
    expect(parseSteerCommand("")).toMatchObject({ kind: "unknown" });
  });

  it("pauses the whole autopilot on company-scoped verbs", () => {
    expect(parseSteerCommand("pause the autopilot")).toEqual({ kind: "pause_all" });
    expect(parseSteerCommand("stop everything")).toEqual({ kind: "pause_all" });
    expect(parseSteerCommand("pause")).toEqual({ kind: "pause_all" });
  });

  it("resumes: whole-company resume, and domain resume re-grants via trust", () => {
    expect(parseSteerCommand("resume the autopilot")).toEqual({ kind: "resume_all" });
    expect(parseSteerCommand("unpause everything")).toEqual({ kind: "resume_all" });
    expect(parseSteerCommand("resume")).toEqual({ kind: "resume_all" });
    expect(parseSteerCommand("resume growth")).toEqual({ kind: "trust_domain", domain: "growth" });
  });

  it("routes spend / runway questions to the capital ledger", () => {
    expect(parseSteerCommand("what did we spend this week?")).toEqual({ kind: "spend" });
    expect(parseSteerCommand("what's our runway?")).toEqual({ kind: "spend" });
    expect(parseSteerCommand("how much have we spent on AI?")).toEqual({ kind: "spend" });
  });

  it("spend words inside a standing order still create the order", () => {
    expect(parseSteerCommand("never spend more than $5 a day on ads")).toMatchObject({
      kind: "set_standing_order",
    });
  });
});

describe("autopilot steering handlers — act through governed services", () => {
  const deps = (over: Partial<SteerDeps> = {}): SteerDeps => ({
    setDomainLevel: async () => undefined,
    getDomainLevel: async () => "draft",
    nextLevel: (l) => (l === "draft" ? "execute_gated" : null),
    createStandingOrder: async () => undefined,
    status: async () => "Status: all green.",
    why: async () => "Because the system was stable, I advanced growth.",
    listDomains: () => ["growth", "support", "deploy", "ops", "finance"],
    spend: async () => "Last 7 days: $1.23. Month-to-date: $4.56 of the $50 envelope (9% used, status green).",
    ...over,
  });

  it("pause routes through setDomainLevel(observe)", async () => {
    const calls: unknown[] = [];
    const r = await handleSteer({ kind: "pause_domain", domain: "growth" }, deps({
      setDomainLevel: async (d, l) => { calls.push([d, l]); },
    }));
    expect(calls[0]).toEqual(["growth", "observe"]);
    expect(r.reply).toMatch(/paused/i);
  });

  it("trust bumps to the next level, and reports already-max", async () => {
    const r = await handleSteer({ kind: "trust_domain", domain: "growth" }, deps());
    expect(r.action?.detail).toMatch(/execute_gated/);
    const maxed = await handleSteer({ kind: "trust_domain", domain: "growth" }, deps({ nextLevel: () => null }));
    expect(maxed.reply).toMatch(/already at full autonomy/i);
  });

  it("intent + standing order route to createStandingOrder with the right kind", async () => {
    const created: Array<{ kind: string }> = [];
    const d = deps({ createStandingOrder: async (i) => { created.push(i); } });
    await handleSteer({ kind: "set_intent", body: "focus on Texas" }, d);
    await handleSteer({ kind: "set_standing_order", body: "never spam" }, d);
    expect(created.map((c) => c.kind)).toEqual(["intent", "standing_order"]);
  });

  it("status + why read real state through their deps", async () => {
    expect((await handleSteer({ kind: "status" }, deps())).reply).toMatch(/all green/);
    expect((await handleSteer({ kind: "why" }, deps())).reply).toMatch(/advanced growth/);
  });

  it("pause_all sets every domain to observe; resume_all re-grants draft", async () => {
    const calls: Array<[string, string]> = [];
    const d = deps({ setDomainLevel: async (dom, l) => { calls.push([dom, l]); } });
    const paused = await handleSteer({ kind: "pause_all" }, d);
    expect(calls).toHaveLength(5);
    expect(calls.every(([, l]) => l === "observe")).toBe(true);
    expect(paused.reply).toMatch(/paused/i);

    calls.length = 0;
    const resumed = await handleSteer({ kind: "resume_all" }, d);
    expect(calls).toHaveLength(5);
    expect(calls.every(([, l]) => l === "draft")).toBe(true);
    expect(resumed.reply).toMatch(/back on/i);
  });

  it("spend reads the real ledger through its dep", async () => {
    const r = await handleSteer({ kind: "spend" }, deps());
    expect(r.reply).toMatch(/\$1\.23/);
    expect(r.reply).toMatch(/envelope/);
  });

  it("never throws — a failing dep degrades to a graceful reply", async () => {
    const r = await handleSteer({ kind: "pause_domain", domain: "growth" }, deps({
      setDomainLevel: async () => { throw new Error("db down"); },
    }));
    expect(r.reply).toMatch(/couldn't carry that out/i);
  });
});
