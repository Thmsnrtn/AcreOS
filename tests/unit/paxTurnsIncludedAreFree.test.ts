/**
 * Included Pax turns are free — founder decision 2026-10-12
 * (docs/company/founder-decisions-2026-10-12.md).
 *
 * THE DEFECT. Every platform-key Pax turn required and charged 2¢ of
 * PURCHASED credits. A paid org past its trial with no own AI key and no
 * purchased credits was refused Pax while inside its plan's included messages
 * and its shared monthly AI allowance (decision C, 2026-10-08).
 *
 * WHAT IS PINNED.
 *   1. The rule (paxTurnLane) — included only for a paid plan, outside the
 *      trial window, under the message cap AND under the allowance, where the
 *      allowance test is the SAME predicate the wall uses (isAiAllowanceSpent).
 *   2. A real route (/realtime/ask): an included turn is served with no credit
 *      check and no charge; a trial turn still goes through the credit lane.
 *   3. The population (law 3): every `ai_chat` credit charge site in server/
 *      is registered here. A customer-turn site must sit under a function that
 *      consults paxTurnFunding; a background site must say why it is outside
 *      the decision. An unregistered site is red, and so is a registered site
 *      that has disappeared (the parser stopped matching, or it moved).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import express from "express";
import request from "supertest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";
import { listServerSources, parseSource, rel, ownerFunctionName } from "../helpers/serverPopulation";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({
  org: { subscriptionTier: "pro", trialEndsAt: null as Date | null },
  gate: { allowed: true, mode: "platform", current: 0, threshold: 2250, unit: "cents", warning: false, byokAvailable: true, byokActive: false, tier: "pro" } as Record<string, unknown>,
  capAllowed: true,
  balance: 0,
  credit: { evaluate: 0, charge: 0 },
  recorded: [] as boolean[],
  campaigns: [] as Array<{ id: number }>,
}));

vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([h.org]) }) }) },
  withTransaction: async () => undefined,
}));
vi.mock("../../server/services/usageLimits", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkAiTurnGate: async () => h.gate,
  aiMessageCapAllows: async () => h.capAllowed,
}));
vi.mock("../../server/services/credits", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  class CreditService {
    async evaluateCredits(_org: number, cents: number) {
      h.credit.evaluate++;
      return h.balance >= cents ? { allowed: true, lane: "balance" } : { allowed: false, lane: "balance" };
    }
    async getBalance() {
      return h.balance;
    }
    async deductOrFundFromTrial() {
      h.credit.charge++;
      return "balance";
    }
  }
  const usageMeteringService = {
    calculateCost: async () => 2,
    recordUsage: async (_o: number, _t: string, _q: number, _m: unknown, autoDeduct = true) => {
      h.recorded.push(autoDeduct);
      return { record: null, deducted: autoDeduct, insufficientCredits: false };
    },
  };
  return { ...actual, CreditService, usageMeteringService };
});
vi.mock("../../server/services/byok/aiByok", () => ({ resolveAiByokClient: async () => null, getActiveAiByokChannel: async () => null }));
vi.mock("../../server/storage", () => ({ storage: { getCampaignsNeedingOptimization: async () => h.campaigns }, db: {} }));
vi.mock("../../server/services/voiceLearning", () => ({ voiceLearningService: {} }));
vi.mock("../../server/services/realtimeAlerts", () => ({ realtimeAlertsService: {} }));
vi.mock("../../server/services/certification", () => ({ certificationService: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: {} }));
vi.mock("../../server/utils/openaiClient", () => ({ requireOpenAIClient: () => ({}), getOpenAIClient: () => ({}) }));
// The metered call runs the REAL allowance enforcement, so a route's Pax-turn
// scope and mark are exercised end to end.
vi.mock("../../server/services/aiSpendGuard", () => ({
  meteredChatCompletion: async (_c: unknown, _p: unknown, meta: { orgId?: number; origin?: string }) => {
    if (meta?.origin === "customer" && meta.orgId != null) {
      const { enforceAiAllowance } = await import("../../server/services/aiAllowance");
      await enforceAiAllowance(meta.orgId);
    }
    return { choices: [{ message: { content: '{"reply":"ok","actionPath":null,"actionLabel":null}' } }] };
  },
}));

import { TIER_LIMITS } from "@shared/billing/tier-limits";
import { paxTurnFunding } from "../../server/services/paxTurnFunding";

/** The rule, through the production entry point with its inputs supplied. */
async function paxTurnLane(input: {
  gate: { mode: "founder" | "byok" | "platform"; threshold: number | null; current: number };
  subscriptionTier: string;
  trialEndsAt: Date | null;
  withinMessageCap: boolean;
}) {
  h.org = { subscriptionTier: input.subscriptionTier, trialEndsAt: input.trialEndsAt };
  return paxTurnFunding(7, {
    gate: { ...input.gate, allowed: true, unit: "cents", warning: false, byokAvailable: true, byokActive: input.gate.mode === "byok", tier: "pro" } as never,
    usage: { allowed: input.withinMessageCap } as never,
  });
}

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * DAY);

describe("the rule: which Pax turns are included", () => {
  const under = (tier: "starter" | "pro" | "scale") => ({ mode: "platform" as const, threshold: TIER_LIMITS[tier].aiAllowanceCents, current: 0 });
  const spent = (tier: "starter" | "pro" | "scale") => ({ mode: "platform" as const, threshold: TIER_LIMITS[tier].aiAllowanceCents, current: TIER_LIMITS[tier].aiAllowanceCents! });

  it("a paid plan outside its trial, under the cap and the allowance, is included", async () => {
    for (const t of ["starter", "pro", "scale"] as const) {
      expect(await paxTurnLane({ gate: under(t), subscriptionTier: t, trialEndsAt: null, withinMessageCap: true }), t).toBe("included");
    }
    // Enterprise has no allowance wall: under its cap every turn is included.
    expect(await paxTurnLane({ gate: { mode: "platform", threshold: null, current: 99_999 }, subscriptionTier: "enterprise", trialEndsAt: null, withinMessageCap: true })).toBe("included");
    // A legacy tier name folds to the plan it bills as.
    expect(await paxTurnLane({ gate: under("pro"), subscriptionTier: "operator", trialEndsAt: null, withinMessageCap: true })).toBe("included");
  });

  it("past the allowance, past the cap, in a trial, or on Free, the credit lane applies", async () => {
    expect(await paxTurnLane({ gate: spent("pro"), subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("credits");
    expect(await paxTurnLane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: false })).toBe("credits");
    expect(await paxTurnLane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: future(), withinMessageCap: true })).toBe("credits");
    expect(await paxTurnLane({ gate: { mode: "platform", threshold: null, current: 0 }, subscriptionTier: "free", trialEndsAt: null, withinMessageCap: true })).toBe("credits");
    // An expired trial is no longer a trial.
    expect(await paxTurnLane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: new Date(Date.now() - DAY), withinMessageCap: true })).toBe("included");
  });

  it("founder and BYOK turns keep their own lanes", async () => {
    expect(await paxTurnLane({ gate: { mode: "founder", threshold: null, current: 0 }, subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("founder");
    expect(await paxTurnLane({ gate: { mode: "byok", threshold: 2250, current: 9_999 }, subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("byok");
  });

  it("the allowance boundary is the wall's own predicate", () => {
    const src = stripped("server/services/paxTurnFunding.ts");
    expect(src).toMatch(/isAiAllowanceSpent\(/);
    expect(stripped("server/services/usageLimits.ts")).toMatch(/const blocked = isAiAllowanceSpent\(/);
    expect(stripped("server/services/paxTurnFunding.ts")).toMatch(/from "\.\/aiAllowanceRule"/);
    expect(stripped("server/services/aiAllowance.ts")).toMatch(/const exhausted = isAiAllowanceSpent\(/);
  });
});

function stripped(p: string): string {
  return stripComments(fs.readFileSync(p, "utf8"));
}

describe("a real Pax route: /realtime/ask", () => {
  beforeEach(async () => {
    h.credit = { evaluate: 0, charge: 0 };
    h.balance = 0;
    h.capAllowed = true;
    h.org = { subscriptionTier: "pro", trialEndsAt: null };
    h.gate = { ...h.gate, mode: "platform", current: 0, threshold: TIER_LIMITS.pro.aiAllowanceCents, allowed: true };
    const { __resetAiAllowanceCacheForTests } = await import("../../server/services/aiAllowance");
    __resetAiAllowanceCacheForTests();
  });

  async function ask() {
    const { default: router } = await import("../../server/routes-realtime");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.organization = { id: 7, subscriptionTier: h.org.subscriptionTier };
      req.organizationId = 7;
      next();
    });
    app.use("/realtime", router);
    return request(app).post("/realtime/ask").send({ message: "how many leads?" });
  }

  it("an included turn on Pro with no purchased credits is answered, with no credit check and no charge", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("ok");
    expect(h.credit).toEqual({ evaluate: 0, charge: 0 });
  });

  it("past the allowance the credit lane applies, and its refusal names the way forward", async () => {
    h.gate = { ...h.gate, current: TIER_LIMITS.pro.aiAllowanceCents };
    const res = await ask();
    expect(h.credit.evaluate).toBe(1);
    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/Add credits/);
    expect(res.body.details.nextStep.href).toMatch(/^\/settings/);
  });

  it("past the plan's message cap the credit lane applies", async () => {
    h.capAllowed = false;
    h.balance = 100;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.credit.evaluate).toBe(1);
  });

  it("a trial turn stays on the credit lane (trial behaviour unchanged)", async () => {
    h.org = { subscriptionTier: "pro", trialEndsAt: future() };
    h.balance = 100;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.credit.evaluate).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.credit.charge).toBe(1);
  });
});

// ── Population: every ai_chat credit charge site in server/ ────────────────

/**
 * file::owner → how many ai_chat credit charges sit there. EVERY site adopts
 * the rule (founder decision 2026-10-17 moved the background jobs in too):
 * each must sit under a function that calls paxTurnFunding.
 */
const PAX_CHARGE_SITES: Record<string, { count: number }> = {
  "server/routes-ai.ts::registerAIRoutes": { count: 2 },
  "server/routes-deals.ts::registerDealRoutes": { count: 1 },
  "server/routes-realtime.ts::<module>": { count: 1 },
  "server/routes-leads.ts::registerLeadRoutes": { count: 1 },
  "server/services/campaignOptimizer.ts::processOrganizationCampaigns": { count: 1 },
  "server/services/leadNurturer.ts::processLeadsForOrg": { count: 1 },
};

function isAiChatCharge(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
  const args = call.arguments;
  if (name === "recordUsage") {
    return args.length >= 2 && ts.isStringLiteralLike(args[1]) && args[1].text === "ai_chat";
  }
  if (name === "deductOrFundFromTrial" || name === "deductCredits") {
    const meta = args[3];
    return !!meta && ts.isObjectLiteralExpression(meta) && meta.properties.some(
      (p) => ts.isPropertyAssignment(p) && p.name.getText() === "actionType" && ts.isStringLiteralLike(p.initializer) && p.initializer.text === "ai_chat",
    );
  }
  return false;
}

function consultsFunding(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body) {
      let found = false;
      const walk = (m: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && m.expression.text === "paxTurnFunding") found = true;
        else ts.forEachChild(m, walk);
      };
      walk(n.body);
      if (found) return true;
    }
  }
  return false;
}

function chargeSites(file: string, text: string): Array<{ key: string; funded: boolean }> {
  const sf = parseSource(file, text);
  const out: Array<{ key: string; funded: boolean }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && isAiChatCharge(n)) out.push({ key: `${file}::${ownerFunctionName(n)}`, funded: consultsFunding(n, sf) });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("every ai_chat credit charge in server/ is registered and decided", () => {
  it("canaries", () => {
    const bare = chargeSites("x.ts", `export function f(o){ return svc.recordUsage(o, "ai_chat", 1, {}); }`);
    expect(bare).toEqual([{ key: "x.ts::f", funded: false }]);
    const funded = chargeSites("x.ts", `export async function f(o){ const l = await paxTurnFunding(o); res.on("finish", () => c.deductOrFundFromTrial(o, 2, "x", { actionType: "ai_chat" })); }`);
    expect(funded).toEqual([{ key: "x.ts::f", funded: true }]);
    // Another action type, and a comment, are not Pax charges.
    expect(chargeSites("x.ts", `function f(o){ svc.recordUsage(o, "pdf_generated", 1); } // recordUsage(o, "ai_chat")`)).toEqual([]);
  });

  it("over every non-test server source", () => {
    const files = listServerSources();
    expect(files.length, "population floor").toBeGreaterThan(1000);
    const found = new Map<string, { count: number; unfunded: number }>();
    for (const f of files) {
      for (const s of chargeSites(rel(f), fs.readFileSync(f, "utf8"))) {
        const e = found.get(s.key) ?? { count: 0, unfunded: 0 };
        e.count++;
        if (!s.funded) e.unfunded++;
        found.set(s.key, e);
      }
    }
    const unregistered = [...found.keys()].filter((k) => !(k in PAX_CHARGE_SITES));
    expect(unregistered, "a new ai_chat credit charge site — decide its lane and register it").toEqual([]);
    for (const [key, reg] of Object.entries(PAX_CHARGE_SITES)) {
      const got = found.get(key);
      expect(got?.count ?? 0, `${key}: registered site not found (vacuity)`).toBe(reg.count);
      expect(got!.unfunded, `${key}: an ai_chat credit charge that does not consult paxTurnFunding`).toBe(0);
    }
  });
});

// ── Past the allowance: purchased credits fund a Pax turn (2026-10-17) ─────

/** Run `fn` inside one Pax-turn scope, exactly as a route mounting paxTurnScope() does. */
async function inScope<T>(fn: () => Promise<T>): Promise<T> {
  const { paxTurnScope } = await import("../../server/services/paxTurnContext");
  return new Promise((resolve, reject) => paxTurnScope()(null, null, () => { fn().then(resolve, reject); }));
}

describe("the allowance wall accepts purchased credits as well as an own key", () => {
  const spentGate = () => ({
    ...h.gate,
    allowed: false,
    reason: "byok_required",
    mode: "platform",
    current: TIER_LIMITS.pro.aiAllowanceCents,
    threshold: TIER_LIMITS.pro.aiAllowanceCents,
    byokAvailable: true,
  });

  async function throughGate(byokAvailable = true) {
    h.gate = { ...spentGate(), byokAvailable };
    const { aiByokThresholdGate } = await import("../../server/middleware/usageLimitGate");
    const app = express();
    app.use((req: any, _res, next) => {
      req.organizationId = 7;
      next();
    });
    app.post("/turn", aiByokThresholdGate(), (_req, res) => res.json({ passed: true }));
    return request(app).post("/turn");
  }

  it("a balance that covers a turn passes the chat wall", async () => {
    h.balance = 100;
    const res = await throughGate();
    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
  });

  it("with no balance the wall refuses and names both ways forward", async () => {
    h.balance = 0;
    const res = await throughGate();
    expect(res.status).toBe(429);
    expect(res.body.details.reason).toBe("byok_required");
    expect(res.body.details.message).toMatch(/Add credits, or connect your own/);
    expect(res.body.details.addCreditsUrl).toBe("/settings#account");
    expect(res.body.details.byokSettingsUrl).toBe("/settings/byok");
  });

  it("a plan without its own-key option is told only what works: add credits", async () => {
    h.balance = 0;
    const res = await throughGate(false);
    expect(res.status).toBe(429);
    expect(res.body.details.message).toMatch(/Add credits to keep going/);
    expect(res.body.details.message).not.toMatch(/own Anthropic/);
  });

  it("per-call enforcement: a balance-paid Pax turn runs on the platform key; nothing else gets through", async () => {
    const { enforceAiAllowance, __resetAiAllowanceCacheForTests } = await import("../../server/services/aiAllowance");
    const { markPaxTurn } = await import("../../server/services/paxTurnContext");
    h.gate = spentGate();

    __resetAiAllowanceCacheForTests();
    await expect(inScope(async () => { markPaxTurn(7, true); return enforceAiAllowance(7); })).resolves.toBeNull();

    // A Pax turn the balance did not pay: refused, naming credits and the key.
    __resetAiAllowanceCacheForTests();
    const unpaid = await inScope(async () => { markPaxTurn(7, false); return enforceAiAllowance(7).catch((e) => e); });
    expect(unpaid).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", creditsFundThisCall: true, addCreditsUrl: "/settings#account" });
    expect((unpaid as Error).message).toMatch(/Add credits, or connect your own/);

    // A non-turn AI call past the allowance (no meter of its own): credits are
    // not offered, because they would not fund it.
    __resetAiAllowanceCacheForTests();
    // (org 9: an org no case in this file marks.)
    const other = await enforceAiAllowance(9).catch((e) => e);
    expect(other).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", creditsFundThisCall: false });
    expect((other as Error).message).not.toMatch(/Add credits/);

    // A mark for another org is not this org's mark.
    __resetAiAllowanceCacheForTests();
    const otherOrg = await inScope(async () => { markPaxTurn(8, true); return enforceAiAllowance(9).catch((e) => e); });
    expect(otherOrg).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });

    // Without a scope, a mark is a no-op: the wall stays shut (fails closed).
    __resetAiAllowanceCacheForTests();
    markPaxTurn(9, true);
    expect(await enforceAiAllowance(9).catch((e) => e)).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });
  });

  it("a real Pax route past the allowance: a balance-paid turn is answered and charged — and the mark does not outlive the request", async () => {
    const { __resetAiAllowanceCacheForTests, enforceAiAllowance } = await import("../../server/services/aiAllowance");
    __resetAiAllowanceCacheForTests();
    h.credit = { evaluate: 0, charge: 0 };
    h.org = { subscriptionTier: "pro", trialEndsAt: null };
    h.gate = spentGate();
    h.balance = 100;
    const { default: router } = await import("../../server/routes-realtime");
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.organization = { id: 7, subscriptionTier: "pro" };
      req.organizationId = 7;
      next();
    });
    app.use("/realtime", router);
    const res = await request(app).post("/realtime/ask").send({ message: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("ok");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.credit).toEqual({ evaluate: 1, charge: 1 });
    // After the request, a non-turn call for the same org is still walled.
    __resetAiAllowanceCacheForTests();
    expect(await enforceAiAllowance(7).catch((e) => e)).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });
    // With no balance the same route refuses, naming the way forward.
    h.balance = 0;
    const refused = await request(app).post("/realtime/ask").send({ message: "hi" });
    expect(refused.status).toBe(402);
    expect(refused.body.message).toMatch(/Add credits/);
  });
});

// ── Background ai_chat work follows the same rule (2026-10-17) ─────────────

describe("background AI jobs: no credit charge inside the included allowance, credits after", () => {
  beforeEach(() => {
    h.recorded = [];
    h.campaigns = [{ id: 1 }, { id: 2 }];
    h.org = { subscriptionTier: "pro", trialEndsAt: null };
    h.capAllowed = true;
  });

  async function runOptimizer() {
    const { CampaignOptimizerService } = await import("../../server/services/campaignOptimizer");
    const svc = new CampaignOptimizerService();
    vi.spyOn(svc, "optimizeCampaign").mockResolvedValue({ metrics: {}, score: 0, suggestions: [], savedOptimizations: 0 } as never);
    return svc.processOrganizationCampaigns(7);
  }

  it("inside the allowance: recorded without a charge, and no credits reported used", async () => {
    h.gate = { ...h.gate, allowed: true, mode: "platform", current: 0, threshold: TIER_LIMITS.pro.aiAllowanceCents };
    const r = await runOptimizer();
    expect(h.recorded).toEqual([false, false]);
    expect(r.creditsUsed).toBe(0);
  });

  it("past the allowance: each unit is charged", async () => {
    h.gate = { ...h.gate, allowed: false, mode: "platform", current: TIER_LIMITS.pro.aiAllowanceCents, threshold: TIER_LIMITS.pro.aiAllowanceCents };
    const r = await runOptimizer();
    expect(h.recorded).toEqual([true, true]);
    expect(r.creditsUsed).toBe(2);
  });
});

describe("every route that marks a Pax turn mounts the per-request scope", () => {
  it("markPaxTurn calls are matched by paxTurnScope() mounts, file by file", () => {
    const files = listServerSources().map((f) => ({ rel: rel(f), src: stripComments(fs.readFileSync(f, "utf8")) }));
    const marking = files.filter((f) => /\bmarkPaxTurn\(/.test(f.src) && !f.rel.endsWith("paxTurnContext.ts"));
    expect(marking.map((f) => f.rel).sort()).toEqual([
      "server/routes-ai.ts", "server/routes-deals.ts", "server/routes-leads.ts", "server/routes-realtime.ts",
    ]);
    for (const f of marking) {
      const marks = f.src.match(/\bmarkPaxTurn\(/g)!.length;
      const scopes = f.src.match(/\bpaxTurnScope\(\)/g)?.length ?? 0;
      expect(scopes, `${f.rel}: ${marks} markPaxTurn call(s), ${scopes} paxTurnScope() mount(s)`).toBeGreaterThanOrEqual(marks);
    }
    // The scope is run(), never enterWith (which leaks across requests).
    const ctx = stripComments(fs.readFileSync("server/services/paxTurnContext.ts", "utf8"));
    expect(ctx).toMatch(/store\.run\(/);
    expect(ctx).not.toMatch(/enterWith/);
  });
});
