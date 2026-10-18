/**
 * Who pays for a Pax turn — founder decisions 2026-10-12 and 2026-10-17
 * (docs/company/founder-decisions-2026-10-12.md).
 *
 *   - Inside a paid plan's included Pax (message cap AND shared monthly AI
 *     allowance) a turn takes no credits. Credits or the org's own key only
 *     after the allowance; trial behaviour unchanged.
 *   - Past the allowance, purchased credits fund a Pax turn as well as an own
 *     key — only a Pax turn; unmetered AI features are still walled.
 *   - Background ai_chat work (campaign optimizer, lead-nurturer batch) follows
 *     the same rule, and its spend counts toward the allowance.
 *
 * WHAT IS PINNED (each was a live defect at some point on this branch):
 *   1. The rule (lanes), through paxTurnFunding.
 *   2. Real routes: an included or own-key turn takes nothing; a credit-lane
 *      turn is charged BEFORE the AI call, atomically, so concurrent turns
 *      cannot ride one balance; an undelivered turn is refunded.
 *   3. The wall: the credit pass-through is opt-in for Pax-turn routes only;
 *      every refusal names only what works.
 *   4. Background jobs through the REAL optimizer: charged only on the credit
 *      lane, refunded when the AI did not answer, recorded so the spend counts.
 *   5. The population (law 3): every ai_chat charge in server/ is the one
 *      helper, conditional on the funding answer being "credits"; every caller
 *      of that helper passes paxTurnFunding's answer and settles.
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
  gate: { allowed: true, mode: "platform", current: 0, threshold: 5000, unit: "cents", warning: false, byokAvailable: true, byokActive: false, tier: "pro" } as Record<string, unknown>,
  capAllowed: true,
  balance: 0,
  trialActive: false,
  charges: [] as string[],
  refunds: [] as number[],
  records: [] as Array<{ autoDeduct: boolean; meta: Record<string, unknown> }>,
  aiCalls: [] as Array<Record<string, unknown>>,
  aiFail: false,
  campaigns: [] as Array<Record<string, unknown>>,
  dueLeads: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([h.org]) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
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
    async deductOrFundFromTrial(_org: number, cents: number) {
      // The conditional debit is atomic in Postgres; here a synchronous
      // check-and-decrement stands in for it.
      if (h.balance >= cents) {
        h.balance -= cents;
        h.charges.push("balance");
        return "balance";
      }
      if (h.trialActive) {
        h.charges.push("trial");
        return "trial";
      }
      return null;
    }
    async getBalance() {
      return h.balance;
    }
    async trialAllowanceRemaining() {
      return h.trialActive ? 500 : null;
    }
    async evaluateCredits(_o: number, cents: number) {
      return h.balance >= cents ? { allowed: true, lane: "balance" } : { allowed: false, lane: h.trialActive ? "trial" : "balance" };
    }
    async addCredits(_o: number, cents: number) {
      h.refunds.push(cents);
      h.balance += cents;
      return {};
    }
  }
  const usageMeteringService = {
    calculateCost: async () => 2,
    recordUsage: async (_o: number, _t: string, _q: number, meta: Record<string, unknown>, autoDeduct = true) => {
      h.records.push({ autoDeduct, meta });
      return { record: null, deducted: false, insufficientCredits: false };
    },
  };
  return { ...actual, CreditService, usageMeteringService };
});
vi.mock("../../server/services/byok/aiByok", () => ({ resolveAiByokClient: async () => null, getActiveAiByokChannel: async () => null }));
vi.mock("../../server/storage", () => ({
  storage: {
    getCampaignsNeedingOptimization: async () => h.campaigns,
    createCampaignOptimization: async () => ({}),
    // leadNurturer.processLeadsForOrg (the batch follow-up run)
    setJobStatus: async () => undefined,
    getJobCursor: async () => null,
    getLeadsNeedingScoring: async () => [],
    updateJobCursor: async () => undefined,
    getLeadsDueForFollowUp: async () => h.dueLeads,
    createLeadActivity: async () => ({}),
  },
  db: {},
}));
vi.mock("../../server/services/agentLlmTraces", () => ({ logAgentTrace: async () => undefined }));
vi.mock("../../server/services/voiceLearning", () => ({ voiceLearningService: { getProfile: async () => null } }));
vi.mock("../../server/services/paxModelTier", () => ({
  pickPaxModelForOrg: async () => ({ tier: "pro", isDowngraded: false, model: "m" }),
  PAX_MODEL_HAIKU: "h",
}));
vi.mock("../../server/services/realtimeAlerts", () => ({ realtimeAlertsService: {} }));
vi.mock("../../server/services/certification", () => ({ certificationService: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: {} }));
vi.mock("../../server/utils/openaiClient", () => ({ requireOpenAIClient: () => ({}), getOpenAIClient: () => ({}) }));
// The metered call runs the REAL allowance enforcement for customer calls, so
// a route's Pax-turn scope and mark are exercised end to end.
vi.mock("../../server/services/aiSpendGuard", () => ({
  meteredChatCompletion: async (_c: unknown, _p: unknown, meta: { orgId?: number; origin?: string }) => {
    h.aiCalls.push(meta as Record<string, unknown>);
    if (meta?.origin === "customer" && meta.orgId != null) {
      const { enforceAiAllowance } = await import("../../server/services/aiAllowance");
      await enforceAiAllowance(meta.orgId);
    }
    if (h.aiFail) throw new Error("provider down");
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            reply: "ok",
            actionPath: null,
            actionLabel: null,
            suggestions: [{ type: "content", suggestion: "s", reasoning: "r", priority: "high" }],
          }),
        },
      }],
    };
  },
}));

import { TIER_LIMITS } from "@shared/billing/tier-limits";
import { paxTurnFunding } from "../../server/services/paxTurnFunding";

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 7 * DAY);
const PRO_ALLOWANCE = TIER_LIMITS.pro.aiAllowanceCents!;

function resetState() {
  h.org = { subscriptionTier: "pro", trialEndsAt: null };
  h.gate = { ...h.gate, allowed: true, mode: "platform", current: 0, threshold: PRO_ALLOWANCE, byokAvailable: true };
  h.capAllowed = true;
  h.balance = 0;
  h.trialActive = false;
  h.charges = [];
  h.refunds = [];
  h.records = [];
  h.aiCalls = [];
  h.aiFail = false;
  h.dueLeads = [];
}
const pastAllowance = () => ({ ...h.gate, allowed: false, reason: "byok_required", mode: "platform", current: PRO_ALLOWANCE, threshold: PRO_ALLOWANCE });
async function resetAllowanceCache() {
  const { __resetAiAllowanceCacheForTests } = await import("../../server/services/aiAllowance");
  __resetAiAllowanceCacheForTests();
}

/** The rule, through the production entry point with its inputs supplied. */
async function lane(input: {
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

describe("the rule: which Pax turns are included", () => {
  const under = (t: "starter" | "pro" | "scale") => ({ mode: "platform" as const, threshold: TIER_LIMITS[t].aiAllowanceCents, current: 0 });
  const spent = (t: "starter" | "pro" | "scale") => ({ mode: "platform" as const, threshold: TIER_LIMITS[t].aiAllowanceCents, current: TIER_LIMITS[t].aiAllowanceCents! });

  it("a paid plan outside its trial, under the cap and the allowance, is included", async () => {
    for (const t of ["starter", "pro", "scale"] as const) {
      expect(await lane({ gate: under(t), subscriptionTier: t, trialEndsAt: null, withinMessageCap: true }), t).toBe("included");
    }
    expect(await lane({ gate: { mode: "platform", threshold: null, current: 99_999 }, subscriptionTier: "enterprise", trialEndsAt: null, withinMessageCap: true })).toBe("included");
    expect(await lane({ gate: under("pro"), subscriptionTier: "operator", trialEndsAt: null, withinMessageCap: true })).toBe("included");
  });

  it("past the allowance, past the cap, in a trial, or on Free, the credit lane applies", async () => {
    expect(await lane({ gate: spent("pro"), subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("credits");
    expect(await lane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: false })).toBe("credits");
    expect(await lane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: future(), withinMessageCap: true })).toBe("credits");
    expect(await lane({ gate: { mode: "platform", threshold: null, current: 0 }, subscriptionTier: "free", trialEndsAt: null, withinMessageCap: true })).toBe("credits");
    expect(await lane({ gate: under("pro"), subscriptionTier: "pro", trialEndsAt: new Date(Date.now() - DAY), withinMessageCap: true })).toBe("included");
  });

  it("founder and BYOK turns keep their own lanes", async () => {
    expect(await lane({ gate: { mode: "founder", threshold: null, current: 0 }, subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("founder");
    expect(await lane({ gate: { mode: "byok", threshold: PRO_ALLOWANCE, current: 99_999 }, subscriptionTier: "pro", trialEndsAt: null, withinMessageCap: true })).toBe("byok");
  });

  it("the allowance boundary is the wall's own predicate", () => {
    expect(stripped("server/services/paxTurnFunding.ts")).toMatch(/from "\.\/aiAllowanceRule"/);
    expect(stripped("server/services/usageLimits.ts")).toMatch(/const blocked = isAiAllowanceSpent\(/);
    expect(stripped("server/services/aiAllowance.ts")).toMatch(/const exhausted = isAiAllowanceSpent\(/);
  });
});

function stripped(p: string): string {
  return stripComments(fs.readFileSync(p, "utf8"));
}

// ── A real Pax route: /realtime/ask ─────────────────────────────────────────

async function realtimeApp() {
  const { default: router } = await import("../../server/routes-realtime");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.organization = { id: 7, subscriptionTier: h.org.subscriptionTier };
    req.organizationId = 7;
    next();
  });
  app.use("/realtime", router);
  return app;
}
const ask = async () => request(await realtimeApp()).post("/realtime/ask").send({ message: "how many leads?" });

describe("a real Pax route: /realtime/ask", () => {
  beforeEach(async () => {
    resetState();
    await resetAllowanceCache();
  });

  it("an included turn on Pro with no purchased credits is answered and takes nothing", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("ok");
    expect(h.charges).toEqual([]);
    expect(h.records.map((r) => r.autoDeduct)).toEqual([false]);
  });

  it("an own-key (BYOK) turn takes no credits, even with a balance", async () => {
    h.gate = { ...h.gate, mode: "byok", byokActive: true };
    h.balance = 100;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.charges).toEqual([]);
    expect(h.balance).toBe(100);
  });

  it("past the allowance with a balance: charged before the AI call, answered on the platform key", async () => {
    h.gate = pastAllowance();
    h.balance = 100;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.charges).toEqual(["balance"]);
    expect(h.balance).toBe(98);
    expect(h.refunds).toEqual([]);
    // After the request, a non-turn call for the same org is still walled.
    await resetAllowanceCache();
    const { enforceAiAllowance } = await import("../../server/services/aiAllowance");
    expect(await enforceAiAllowance(7).catch((e) => e)).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });
  });

  it("past the allowance with no balance: refused before any AI call, naming the way forward", async () => {
    h.gate = pastAllowance();
    const res = await ask();
    expect(res.status).toBe(402);
    expect(res.body.message).toMatch(/Add credits/);
    expect(h.aiCalls).toEqual([]);
  });

  it("a turn the AI fails to deliver is refunded", async () => {
    h.gate = pastAllowance();
    h.balance = 100;
    h.aiFail = true;
    const res = await ask();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(h.charges).toEqual(["balance"]);
    expect(h.refunds).toEqual([2]);
    expect(h.balance).toBe(100);
  });

  it("concurrent credit-lane turns on a one-turn balance: exactly one is charged and answered", async () => {
    h.gate = pastAllowance();
    h.balance = 2;
    const app = await realtimeApp();
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post("/realtime/ask").send({ message: "hi" })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 402)).toHaveLength(3);
    expect(h.charges).toEqual(["balance"]);
    expect(h.balance).toBe(0);
    expect(h.aiCalls).toHaveLength(1);
  });

  it("past the plan's message cap the credit lane applies", async () => {
    h.capAllowed = false;
    h.balance = 100;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.charges).toEqual(["balance"]);
  });

  it("a trial turn stays on the credit lane (trial behaviour unchanged)", async () => {
    h.org = { subscriptionTier: "pro", trialEndsAt: future() };
    h.trialActive = true;
    const res = await ask();
    expect(res.status).toBe(200);
    expect(h.charges).toEqual(["trial"]);
  });
});

// ── Settlement failures are never silent ──────────────────────────────────

async function settleFailures(counter: { get: () => Promise<{ values: Array<{ labels: Record<string, unknown>; value: number }> }> }, stage: string) {
  const { values } = await counter.get();
  return values.find((v) => v.labels.stage === stage)?.value ?? 0;
}

describe("settlement", () => {
  beforeEach(resetState);

  it("a refund that fails is logged at error level and counted", async () => {
    const { settlePaxTurn } = await import("../../server/services/paxTurnFunding");
    const { CreditService } = await import("../../server/services/credits");
    const spy = vi.spyOn(CreditService.prototype as never, "addCredits" as never).mockRejectedValueOnce(new Error("db down") as never);
    const { logger } = await import("../../server/utils/logger");
    const err = vi.spyOn(logger, "error");
    const { paxTurnSettleFailuresTotal } = await import("../../server/metrics");
    const before = await settleFailures(paxTurnSettleFailuresTotal, "refund");
    await settlePaxTurn({ organizationId: 7, lane: "credits", cents: 2, fundedBy: "balance" }, { delivered: false, reason: "x" });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/refund of an undelivered turn failed/), expect.anything(), expect.anything());
    expect(await settleFailures(paxTurnSettleFailuresTotal, "refund")).toBe(before + 1);
    spy.mockRestore();
    err.mockRestore();
  });

  it("a usage record that fails after a delivered turn is logged at error level and counted", async () => {
    const { settlePaxTurn } = await import("../../server/services/paxTurnFunding");
    const { usageMeteringService } = await import("../../server/services/credits");
    const spy = vi.spyOn(usageMeteringService as never, "recordUsage" as never).mockRejectedValueOnce(new Error("db down") as never);
    const { logger } = await import("../../server/utils/logger");
    const err = vi.spyOn(logger, "error");
    const { paxTurnSettleFailuresTotal } = await import("../../server/metrics");
    const before = await settleFailures(paxTurnSettleFailuresTotal, "record");
    await settlePaxTurn({ organizationId: 7, lane: "credits", cents: 2, fundedBy: "balance" }, { delivered: true });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/usage record failed/), expect.anything(), expect.anything());
    expect(await settleFailures(paxTurnSettleFailuresTotal, "record")).toBe(before + 1);
    spy.mockRestore();
    err.mockRestore();
  });

  it("an undelivered turn that was never charged is not refunded", async () => {
    const { settlePaxTurn } = await import("../../server/services/paxTurnFunding");
    await settlePaxTurn({ organizationId: 7, lane: "included", cents: 2, fundedBy: null }, { delivered: false });
    await settlePaxTurn({ organizationId: 7, lane: "byok", cents: 2, fundedBy: null }, { delivered: false });
    expect(h.refunds).toEqual([]);
  });
});

// ── The allowance wall ─────────────────────────────────────────────────────

describe("the allowance wall: credits fund Pax turns only, and refusals name only what works", () => {
  beforeEach(async () => {
    resetState();
    await resetAllowanceCache();
  });

  async function throughGate(opts: { creditsFundTurn?: boolean }, byokAvailable = true) {
    h.gate = { ...pastAllowance(), byokAvailable };
    const { aiByokThresholdGate } = await import("../../server/middleware/usageLimitGate");
    const app = express();
    app.use((req: any, _res, next) => {
      req.organizationId = 7;
      next();
    });
    app.post("/turn", aiByokThresholdGate(opts), (_req, res) => res.json({ passed: true }));
    return request(app).post("/turn");
  }

  it("a Pax-turn route (opted in): a covering balance passes", async () => {
    h.balance = 100;
    const res = await throughGate({ creditsFundTurn: true });
    expect(res.status).toBe(200);
  });

  it("a Pax-turn route with no balance: refused naming credits and the own key", async () => {
    const res = await throughGate({ creditsFundTurn: true });
    expect(res.status).toBe(429);
    expect(res.body.details.message).toMatch(/Add credits, or connect your own/);
    expect(res.body.details.addCreditsUrl).toBe("/settings#account");
  });

  it("a non-Pax route (default): credits never pass it and are never offered", async () => {
    h.balance = 100;
    const res = await throughGate({});
    expect(res.status).toBe(429);
    expect(res.body.details.message).not.toMatch(/credits/i);
    expect(res.body.details.addCreditsUrl).toBeUndefined();
  });

  it("no own-key option: a Pax turn is told only 'add credits'", async () => {
    const res = await throughGate({ creditsFundTurn: true }, false);
    expect(res.body.details.message).toMatch(/Add credits to keep going/);
    expect(res.body.details.message).not.toMatch(/own Anthropic/);
  });

  it("only the Pax-turn routes opt in", () => {
    const files = listServerSources().map((f) => ({ rel: rel(f), src: stripComments(fs.readFileSync(f, "utf8")) }));
    const optIn = files.filter((f) => /aiByokThresholdGate\(\s*\{\s*creditsFundTurn:\s*true/.test(f.src)).map((f) => f.rel).sort();
    expect(optIn).toEqual(["server/routes-ai.ts", "server/routes-leads.ts"]);
    const docIntel = stripped("server/routes-document-intelligence.ts");
    expect(docIntel).toMatch(/aiByokThresholdGate\(\)/);
  });

  it("per-call enforcement: a balance-paid Pax turn runs on the platform key; nothing else gets through", async () => {
    const { enforceAiAllowance, __resetAiAllowanceCacheForTests } = await import("../../server/services/aiAllowance");
    const { markPaxTurn } = await import("../../server/services/paxTurnContext");
    h.gate = pastAllowance();
    const inScope = async <T,>(fn: () => Promise<T>) => {
      const { paxTurnScope } = await import("../../server/services/paxTurnContext");
      return new Promise<T>((resolve, reject) => paxTurnScope()(null, null, () => { fn().then(resolve, reject); }));
    };
    __resetAiAllowanceCacheForTests();
    await expect(inScope(async () => { markPaxTurn(7, true); return enforceAiAllowance(7); })).resolves.toBeNull();
    __resetAiAllowanceCacheForTests();
    const unpaid = await inScope(async () => { markPaxTurn(7, false); return enforceAiAllowance(7).catch((e) => e); });
    expect(unpaid).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", creditsFundThisCall: true });
    __resetAiAllowanceCacheForTests();
    const other = await enforceAiAllowance(9).catch((e) => e);
    expect(other).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", creditsFundThisCall: false });
    expect((other as Error).message).not.toMatch(/Add credits/);
    __resetAiAllowanceCacheForTests();
    markPaxTurn(9, true);
    expect(await enforceAiAllowance(9).catch((e) => e)).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED" });
  });

  it("detached work started inside a credit-funded turn does not inherit the mark", async () => {
    const { markPaxTurn, paxTurnScope, paxTurnMarkFor, detachedFromPaxTurn } = await import("../../server/services/paxTurnContext");
    const seen = await new Promise<{ inTurn: unknown; detached: unknown }>((resolve) =>
      paxTurnScope()(null, null, () => {
        markPaxTurn(7, true);
        const inTurn = paxTurnMarkFor(7);
        detachedFromPaxTurn(() => setImmediate(() => resolve({ inTurn, detached: paxTurnMarkFor(7) })));
      }),
    );
    expect(seen.inTurn).toEqual({ creditFunded: true });
    expect(seen.detached).toBeNull();
    // The Pax executive's fire-and-forget spawns are all detached.
    const exec = stripped("server/ai/executive.ts");
    const spawns = exec.match(/\b(setImmediate|process\.nextTick)\(/g) ?? [];
    const detached = exec.match(/detachedFromPaxTurn\(\(\) => (setImmediate|process\.nextTick)\(/g) ?? [];
    expect(spawns.length, "vacuity: the executive's spawns were found").toBeGreaterThanOrEqual(4);
    expect(detached.length).toBe(spawns.length);
  });
});

// ── Background AI jobs, through the REAL optimizer ─────────────────────────

describe("background AI jobs follow the rule and their spend counts", () => {
  beforeEach(async () => {
    resetState();
    h.campaigns = [{ id: 1, organizationId: 7, name: "c", type: "email", totalSent: 100 }];
    await resetAllowanceCache();
  });

  async function runOptimizer() {
    const { CampaignOptimizerService } = await import("../../server/services/campaignOptimizer");
    return new CampaignOptimizerService().processOrganizationCampaigns(7);
  }

  it("inside the allowance: no charge, and the AI call is recorded as allowance-metered background work", async () => {
    const r = await runOptimizer();
    expect(h.charges).toEqual([]);
    expect(r.creditsUsed).toBe(0);
    expect(h.aiCalls).toHaveLength(1);
    expect(h.aiCalls[0]).toMatchObject({ origin: "background", allowanceMetered: true });
  });

  it("past the allowance with credits: charged once and the AI actually answers", async () => {
    h.gate = pastAllowance();
    h.balance = 100;
    const r = await runOptimizer();
    expect(h.charges).toEqual(["balance"]);
    expect(h.refunds).toEqual([]);
    expect(r.creditsUsed).toBe(1);
    expect(r.processed).toBe(1);
    expect(h.aiCalls).toHaveLength(1);
  });

  it("past the allowance when the AI does not answer: the charge is refunded", async () => {
    h.gate = pastAllowance();
    h.balance = 100;
    h.aiFail = true;
    const r = await runOptimizer();
    expect(h.charges).toEqual(["balance"]);
    expect(h.refunds).toEqual([2]);
    expect(r.creditsUsed).toBe(0);
  });

  it("an owner-run optimization past the allowance answers with the wall's refusal, not a silent rules fallback", async () => {
    h.gate = pastAllowance();
    const { CampaignOptimizerService } = await import("../../server/services/campaignOptimizer");
    const err = await new CampaignOptimizerService()
      .optimizeCampaign(h.campaigns[0] as never, { origin: "customer" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "AI_ALLOWANCE_BYOK_REQUIRED", creditsFundThisCall: false });
    // And when the AI is simply unavailable, the answer says so.
    resetState();
    await resetAllowanceCache();
    h.aiFail = true;
    const r = await new CampaignOptimizerService().optimizeCampaign(h.campaigns[0] as never, { origin: "customer" });
    expect(r.source).toBe("rules");
    expect(stripped("server/routes-campaigns.ts")).toMatch(/source: result\.source/);
  });

  it("an own-key org's background run takes no credits", async () => {
    h.gate = { ...h.gate, mode: "byok", byokActive: true };
    h.balance = 100;
    await runOptimizer();
    expect(h.charges).toEqual([]);
  });

  async function runNurturer() {
    h.dueLeads = [{ id: 11, organizationId: 7, firstName: "A", lastName: "B", type: "seller", status: "new", nurturingStage: "warm" }];
    const { LeadNurturerService } = await import("../../server/services/leadNurturer");
    return new LeadNurturerService().processLeadsForOrg(7, {
      checkAging: false,
      controls: { paused: false, leadScoring: true, stance: "suggest", checkFailed: false, pausedUntil: null } as never,
    });
  }

  it("the lead-nurturer batch, inside the allowance: no charge, recorded as allowance-metered background work", async () => {
    const r = await runNurturer();
    expect(r.followUpsGenerated).toBe(1);
    expect(h.charges).toEqual([]);
    expect(r.creditsUsed).toBe(0);
    expect(h.aiCalls).toEqual([expect.objectContaining({ origin: "background", allowanceMetered: true })]);
  });

  it("the lead-nurturer batch past the allowance: charged once and the AI answers; refunded when it does not", async () => {
    h.gate = pastAllowance();
    h.balance = 100;
    const r = await runNurturer();
    expect(r.followUpsGenerated).toBe(1);
    expect(h.charges).toEqual(["balance"]);
    expect(r.creditsUsed).toBe(1);
    expect(h.refunds).toEqual([]);

    resetState();
    h.gate = pastAllowance();
    h.balance = 100;
    h.aiFail = true;
    const failed = await runNurturer();
    expect(failed.followUpsGenerated).toBe(0);
    expect(h.charges).toEqual(["balance"]);
    expect(h.refunds).toEqual([2]);
    expect(failed.creditsUsed).toBe(0);
  });

  it("an own-key org's lead-nurturer batch takes no credits", async () => {
    h.gate = { ...h.gate, mode: "byok", byokActive: true };
    h.balance = 100;
    await runNurturer();
    expect(h.charges).toEqual([]);
    expect(h.balance).toBe(100);
  });

  it("allowance-metered background spend is stored so the allowance sum counts it", async () => {
    const { storedAiOrigin, ALLOWANCE_COUNTED_ORIGINS } = await import("../../server/services/aiAllowanceRule");
    expect(ALLOWANCE_COUNTED_ORIGINS).toContain(storedAiOrigin("background", true));
    expect(ALLOWANCE_COUNTED_ORIGINS).toContain(storedAiOrigin("customer", false));
    expect(ALLOWANCE_COUNTED_ORIGINS).not.toContain(storedAiOrigin("background", false));
    expect(stripped("server/services/usageLimits.ts")).toMatch(/inArray\(aiTelemetryEvents\.origin, \[\.\.\.ALLOWANCE_COUNTED_ORIGINS\]\)/);
    expect(stripped("server/services/aiSpendGuard.ts")).toMatch(/storedAiOrigin\(input\.origin, input\.allowanceMetered\)/);
  });

  it("the owner-requested lead follow-up is a customer Pax turn with chat's gate stack", () => {
    const src = stripped("server/routes-leads.ts");
    const reg = src.slice(src.indexOf('"/api/leads/:id/nurture"'), src.indexOf("async (req", src.indexOf('"/api/leads/:id/nurture"')));
    for (const piece of ["aiLimiter", 'usageLimitGate("ai_requests")', "aiByokThresholdGate({ creditsFundTurn: true })", "paxTurnScope()"]) {
      expect(reg, piece).toContain(piece);
    }
    expect(src).toMatch(/generateFollowUp\(lead, \{ origin: "customer" \}\)/);
    expect(src).toMatch(/trackUsage\(org\.id, "ai_request"\)/);
    const nurturer = stripped("server/services/leadNurturer.ts");
    expect(nurturer).toMatch(/allowanceMetered: opts\.origin === "background"/);
    expect(nurturer).toMatch(/generateFollowUp\(lead, \{ origin: "background" \}\)/);
  });
});

// ── Population: every ai_chat charge, every reservation ────────────────────

/** file::owner → how many reservePaxTurn calls sit there. */
const RESERVATION_SITES: Record<string, number> = {
  "server/routes-ai.ts::registerAIRoutes": 2,
  "server/routes-deals.ts::registerDealRoutes": 1,
  "server/routes-realtime.ts::<module>": 1,
  "server/routes-leads.ts::registerLeadRoutes": 1,
  "server/services/campaignOptimizer.ts::processOrganizationCampaigns": 1,
  "server/services/leadNurturer.ts::processLeadsForOrg": 1,
};
const CHARGE_HELPER = "server/services/paxTurnFunding.ts";

function calleeName(call: ts.CallExpression): string {
  const c = call.expression;
  return ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : "";
}
function isAiChatChargeOrRecord(call: ts.CallExpression): "charge" | "record" | null {
  const name = calleeName(call);
  const args = call.arguments;
  if (name === "recordUsage" && args.length >= 2 && ts.isStringLiteralLike(args[1]) && args[1].text === "ai_chat") {
    return args[4] && args[4].kind === ts.SyntaxKind.FalseKeyword ? "record" : "charge";
  }
  if (name === "deductOrFundFromTrial" || name === "deductCredits") {
    const meta = args[3];
    const isAiChat = !!meta && ts.isObjectLiteralExpression(meta) && meta.properties.some(
      (p) => ts.isPropertyAssignment(p) && p.name.getText() === "actionType" && ts.isStringLiteralLike(p.initializer) && p.initializer.text === "ai_chat",
    );
    return isAiChat ? "charge" : null;
  }
  return null;
}
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return n;
  }
  return null;
}
/** The charge is reached only on the credit lane: an earlier `if (<lane> !== "credits") return` in its function. */
function guardedByCreditLane(node: ts.Node, sf: ts.SourceFile): boolean {
  const fn = enclosingFunction(node);
  if (!fn?.body || !ts.isBlock(fn.body)) return false;
  for (const st of fn.body.statements) {
    if (st.getStart(sf) >= node.getStart(sf)) break;
    if (
      ts.isIfStatement(st) &&
      ts.isBinaryExpression(st.expression) &&
      st.expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
      ts.isStringLiteralLike(st.expression.right) &&
      st.expression.right.text === "credits" &&
      /\breturn\b/.test(st.thenStatement.getText(sf))
    ) {
      return true;
    }
  }
  return false;
}
/** The lane passed to reservePaxTurn is paxTurnFunding's own answer, and the same function settles. */
function reservationIsDecided(call: ts.CallExpression, sf: ts.SourceFile): { decided: boolean; settles: boolean } {
  const arg = call.arguments[1];
  let decided = false;
  let settles = false;
  for (let n: ts.Node | undefined = call.parent; n; n = n.parent) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
      const walk = (m: ts.Node) => {
        if (
          arg && ts.isIdentifier(arg) && ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === arg.text &&
          m.initializer && /\bpaxTurnFunding\(/.test(m.initializer.getText(sf))
        ) decided = true;
        if (ts.isCallExpression(m) && calleeName(m) === "settlePaxTurn") settles = true;
        ts.forEachChild(m, walk);
      };
      walk(n);
      if (decided) break;
    }
  }
  return { decided, settles };
}

function scan(file: string, text: string) {
  const sf = parseSource(file, text);
  const out = { charges: [] as Array<{ site: string; guarded: boolean }>, records: [] as string[], reservations: [] as Array<{ site: string; decided: boolean; settles: boolean }> };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const kind = isAiChatChargeOrRecord(n);
      const site = `${file}::${ownerFunctionName(n)}`;
      if (kind === "charge") out.charges.push({ site, guarded: guardedByCreditLane(n, sf) });
      if (kind === "record") out.records.push(site);
      if (calleeName(n) === "reservePaxTurn") out.reservations.push({ site, ...reservationIsDecided(n, sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("every ai_chat charge is the one helper, and only on the credit lane", () => {
  it("canaries", () => {
    // A charge guarded by `!== "included"` (charges BYOK turns) is not a credit-lane guard.
    const byok = scan("x.ts", `async function f(o, lane){ if (lane === "included") return; await c.deductOrFundFromTrial(o, 2, "d", { actionType: "ai_chat" }); }`);
    expect(byok.charges).toEqual([{ site: "x.ts::f", guarded: false }]);
    const good = scan("x.ts", `async function f(o, lane){ if (lane !== "credits") { return 1; } await c.deductOrFundFromTrial(o, 2, "d", { actionType: "ai_chat" }); }`);
    expect(good.charges).toEqual([{ site: "x.ts::f", guarded: true }]);
    // A recordUsage that deducts is a charge; with `false` it is a record.
    expect(scan("x.ts", `function f(o){ s.recordUsage(o, "ai_chat", 1, {}, x !== "included"); }`).charges).toHaveLength(1);
    expect(scan("x.ts", `function f(o){ s.recordUsage(o, "ai_chat", 1, {}, false); }`).records).toHaveLength(1);
    // A reservation passing a literal lane is not decided by paxTurnFunding.
    expect(scan("x.ts", `async function f(o){ await reservePaxTurn(o, "credits", {}); }`).reservations[0]).toMatchObject({ decided: false, settles: false });
    expect(scan("x.ts", `async function f(o){ const l = await paxTurnFunding(o); const r = await reservePaxTurn(o, l, {}); await settlePaxTurn(r.charge, {}); }`).reservations[0])
      .toMatchObject({ decided: true, settles: true });
    // Comments are not calls.
    expect(scan("x.ts", `// c.deductOrFundFromTrial(o, 2, "d", { actionType: "ai_chat" })\nfunction f(){}`).charges).toEqual([]);
  });

  it("over every non-test server source", () => {
    const files = listServerSources();
    expect(files.length, "population floor").toBeGreaterThan(1000);
    const charges: Array<{ site: string; guarded: boolean }> = [];
    const records: string[] = [];
    const reservations = new Map<string, Array<{ decided: boolean; settles: boolean }>>();
    for (const f of files) {
      const r = scan(rel(f), fs.readFileSync(f, "utf8"));
      charges.push(...r.charges);
      records.push(...r.records);
      for (const x of r.reservations) reservations.set(x.site, [...(reservations.get(x.site) ?? []), x]);
    }
    // Charges: only the helper, and only past its credit-lane guard.
    expect(charges.filter((c) => !c.site.startsWith(`${CHARGE_HELPER}::`)), "an ai_chat charge outside the helper").toEqual([]);
    expect(charges.length, "vacuity: the helper's charge was found").toBeGreaterThanOrEqual(1);
    expect(charges.filter((c) => !c.guarded), "a charge not conditional on the credit lane").toEqual([]);
    // Usage records: only the helper's settle.
    expect(records.filter((s) => !s.startsWith(`${CHARGE_HELPER}::`)), "an ai_chat usage record outside settlePaxTurn").toEqual([]);
    // Reservations: registered, decided by paxTurnFunding, settled.
    const unregistered = [...reservations.keys()].filter((k) => !(k in RESERVATION_SITES));
    expect(unregistered, "a new reservePaxTurn caller — register it").toEqual([]);
    for (const [site, count] of Object.entries(RESERVATION_SITES)) {
      const got = reservations.get(site) ?? [];
      expect(got.length, `${site}: registered reservation not found (vacuity)`).toBe(count);
      for (const r of got) {
        expect(r.decided, `${site}: the lane is not paxTurnFunding's answer`).toBe(true);
        expect(r.settles, `${site}: a reservation that is never settled`).toBe(true);
      }
    }
  });

  it("every route that marks a Pax turn mounts the per-request scope (run, never enterWith)", () => {
    const files = listServerSources().map((f) => ({ rel: rel(f), src: stripComments(fs.readFileSync(f, "utf8")) }));
    const marking = files.filter((f) => /markTurn:\s*true/.test(f.src)).map((f) => f.rel).sort();
    expect(marking).toEqual(["server/routes-ai.ts", "server/routes-deals.ts", "server/routes-leads.ts", "server/routes-realtime.ts"]);
    for (const f of files.filter((x) => marking.includes(x.rel))) {
      const marks = f.src.match(/markTurn:\s*true/g)!.length;
      const scopes = f.src.match(/\bpaxTurnScope\(\)/g)?.length ?? 0;
      expect(scopes, `${f.rel}: ${marks} marked reservation(s), ${scopes} scope mount(s)`).toBeGreaterThanOrEqual(marks);
    }
    const ctx = stripped("server/services/paxTurnContext.ts");
    expect(ctx).toMatch(/store\.run\(/);
    expect(ctx).not.toMatch(/enterWith/);
  });
});
