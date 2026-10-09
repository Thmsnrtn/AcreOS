/**
 * A plan-limit refusal is not described as a rate limit.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `usageLimitGate` answered every plan cap through `Errors.limitExceeded`,
 * whose top-level message is the rate-limit voice: "You're sending requests
 * faster than the system can handle. Wait a few seconds and try again." A
 * Free org at its 50th lead was told to slow down and retry — advice that can
 * never work, because a plan cap does not clear by waiting. The client then
 * classified the 429 as `rate_limited` and its mutation toast ("Slow down /
 * You're moving too fast") replaced the upgrade toast. Six route handlers also
 * re-checked the cap inline and answered with a raw `res.status(429)` whose
 * body had no error code at all.
 *
 * ── WHAT IS PINNED ──────────────────────────────────────────────────────────
 *   1. THROUGH THE REAL GATE, for every tier and every metered resource with a
 *      cap: the refusal carries `PLAN_LIMIT_REACHED` (not `LIMIT_EXCEEDED`),
 *      its message is not in the rate-limit voice, and the numbers in it are
 *      the plan table's — current plan's cap and the next plan's allowance.
 *   2. A REAL rate limit keeps its own copy and code.
 *   3. THE POPULATION: every production file that checks a plan cap inline
 *      answers through `refusePlanLimit` — derived from the source, with a
 *      floor so a parse that goes blind cannot pass.
 *   4. THE CLIENT renders the server's sentence with an upgrade action and
 *      does not call it "Slow down".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const mockCheckUsageLimit = vi.fn();
vi.mock("../../server/services/usageLimits", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../server/services/usageLimits");
  return { ...actual, checkUsageLimit: (...args: unknown[]) => mockCheckUsageLimit(...args) };
});

import { usageLimitGate } from "../../server/middleware/usageLimitGate";
import { Errors } from "../../server/utils/errors";
import {
  TIER_LIMITS,
  TIER_UPGRADE_LADDER,
  nextPaidTier,
  type ResourceType,
  type SubscriptionTier,
} from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";
import { refusalFromBody } from "../../client/src/lib/refusal";
import { getErrorMessage, getErrorTitle, isRetryableError } from "../../client/src/lib/error-utils";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

/** The rate-limit voice, in every phrasing the server or client has used. */
const RATE_LIMIT_VOICE = /faster than|too many requests|slow down|moving too fast|wait a few|try again (shortly|in a)/i;

const RESOURCES: ResourceType[] = ["leads", "properties", "notes", "ai_requests", "campaigns"];

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as null | { error: string; message: string; details: Record<string, unknown> },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data as typeof res.body;
      return res;
    },
    getHeader: () => undefined,
  };
  return res;
}

/** Display names, read from the pricing table (Free has none there). */
function planName(tier: SubscriptionTier): string {
  if (tier === "free") return "Free";
  if (tier === "enterprise") return "Enterprise";
  return TIER_PRICES_CENTS[tier].displayName;
}

const n = (v: number) => v.toLocaleString("en-US");

async function refuseAt(tier: SubscriptionTier, resourceType: ResourceType) {
  const limit = TIER_LIMITS[tier][resourceType] as number;
  mockCheckUsageLimit.mockResolvedValue({ allowed: false, current: limit, limit, resourceType, tier });
  const res = mockRes();
  const next = vi.fn();
  await usageLimitGate(resourceType)({ organizationId: 7, isFounder: false } as never, res as never, next);
  expect(next, `${tier}/${resourceType}: the gate let a capped request through`).not.toHaveBeenCalled();
  return res;
}

/** Every (tier, resource) the plan table caps — the population of case 1. */
const CAPPED = TIER_UPGRADE_LADDER.flatMap((tier) =>
  RESOURCES.filter((r) => TIER_LIMITS[tier][r] !== null).map((r) => ({ tier, r })),
);

beforeEach(() => mockCheckUsageLimit.mockReset());

describe("through the real gate, every plan cap is a plan-limit refusal", () => {
  it("vacuity: the plan table caps something on every self-serve tier", () => {
    // free+starter cap all five, pro caps four, scale caps Pax messages.
    expect(CAPPED.length, "the derived population shrank — did TIER_LIMITS change shape?").toBeGreaterThanOrEqual(14);
    for (const tier of TIER_UPGRADE_LADDER) {
      expect(CAPPED.some((c) => c.tier === tier), `${tier} contributes no capped resource`).toBe(true);
    }
  });

  it.each(CAPPED)("$tier / $r — distinct code, not the rate-limit voice, plan-table numbers", async ({ tier, r }) => {
    const res = await refuseAt(tier, r);
    const body = res.body!;
    expect(res.statusCode).toBe(429);
    expect(body.error).toBe("PLAN_LIMIT_REACHED");
    expect(body.error).not.toBe("LIMIT_EXCEEDED");
    expect(body.message).not.toMatch(RATE_LIMIT_VOICE);

    const limit = TIER_LIMITS[tier][r] as number;
    expect(body.message, "names the current plan").toContain(planName(tier));
    if (limit === 0) expect(body.message).toContain("aren't included on");
    else expect(body.message, "quotes the current plan's cap from TIER_LIMITS").toContain(n(limit));

    const target = nextPaidTier(tier);
    if (target) {
      const nextLimit = TIER_LIMITS[target][r];
      expect(body.message, "names the plan that lifts the cap").toContain(planName(target));
      if (nextLimit === null) expect(body.message).toMatch(/has no .+ limit/);
      else expect(body.message, "quotes the next plan's allowance from TIER_LIMITS").toContain(`allows ${n(nextLimit)}`);
      expect(body.details.upgradeUrl).toBe(`/settings#billing?tier=${target}`);
    } else {
      expect(body.message).toContain("highest self-serve plan");
      expect(body.details.upgradeUrl).toBe("/settings#billing");
    }

    // `details` keeps its contract — the banner and toast read these.
    expect(body.details).toMatchObject({
      resourceType: r,
      currentTier: tier,
      currentCount: limit,
      currentLimit: limit,
      nextTier: target,
      nextTierLimit: target ? TIER_LIMITS[target][r] : null,
    });
  });

  it("reads exactly as intended for the canonical example", async () => {
    const res = await refuseAt("free", "leads");
    expect(res.body!.message).toBe(
      `You've reached ${n(TIER_LIMITS.free.leads!)} leads on Free. Starter allows ${n(TIER_LIMITS.starter.leads!)} leads.`,
    );
  });

  it("a Free org's first campaign is refused with what unlocks it, not a dead end", async () => {
    const res = await refuseAt("free", "campaigns");
    expect(TIER_LIMITS.free.campaigns).toBe(0);
    expect(res.body!.message).toBe(
      `Campaigns aren't included on Free. Starter allows ${n(TIER_LIMITS.starter.campaigns!)} campaigns.`,
    );
  });
});

describe("a real rate limit keeps the rate-limit copy", () => {
  it("Errors.limitExceeded with throttle details says to wait, under LIMIT_EXCEEDED", () => {
    const res = mockRes();
    Errors.limitExceeded(res as never, { retryAfterSeconds: 30, lane: "email" });
    expect(res.statusCode).toBe(429);
    expect(res.body!.error).toBe("LIMIT_EXCEEDED");
    // The stack's limitExceededMessage names the wait when it knows it.
    expect(res.body!.message).toMatch(/faster than/);
    expect(res.body!.message).toMatch(/Wait 30 seconds/);
  });

  it("a non-plan allowance that describes itself is not overwritten by the rate-limit voice", () => {
    const res = mockRes();
    Errors.limitExceeded(res as never, { reason: "daily_budget_exhausted", message: "You've hit today's AI budget." });
    expect(res.body!.message).toBe("You've hit today's AI budget.");
  });
});

describe("population: every inline plan-cap check answers through refusePlanLimit", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  }
  const CALL = /\bcheckUsageLimit\s*\(/g;
  const HAS_CALL = /\bcheckUsageLimit\s*\(/;
  const callers = walk(path.join(ROOT, "server"))
    .map((abs) => ({ rel: path.relative(ROOT, abs), src: stripComments(fs.readFileSync(abs, "utf8")) }))
    .filter(({ rel }) => rel !== path.join("server", "services", "usageLimits.ts"))
    .filter(({ src }) => HAS_CALL.test(src));

  it("vacuity: finds the gate and the inline checkers", () => {
    const names = callers.map((c) => c.rel).sort();
    // Known members, named so a parse that stops matching one reads as a
    // failure here rather than as that file being clean.
    for (const known of ["middleware/usageLimitGate.ts", "routes-properties.ts", "routes-leads.ts", "routes-finance.ts", "routes-ai.ts", "routes-deals.ts"]) {
      expect(names, `${known} is no longer read`).toContain(path.join("server", known));
    }
    expect(callers.length, `only found: ${names.join(", ")}`).toBeGreaterThanOrEqual(6);
  });

  it("no caller answers a plan cap with a raw 429 or the rate-limit helper", () => {
    const offenders: string[] = [];
    for (const { rel, src } of callers) {
      const checks = src.match(CALL)?.length ?? 0;
      const refusals = src.match(/\brefusePlanLimit\s*\(/g)?.length ?? 0;
      if (rel.endsWith("usageLimitGate.ts")) continue; // defines refusePlanLimit and calls it once
      if (refusals < checks) offenders.push(`${rel}: ${checks} checkUsageLimit call(s), ${refusals} refusePlanLimit`);
      if (/res\.status\(\s*429\s*\)/.test(src)) offenders.push(`${rel}: raw res.status(429)`);
    }
    expect(offenders.join("\n"), "a plan cap answered outside refusePlanLimit").toBe("");
  });
});

describe("the client renders the plan-limit refusal as one", () => {
  it("shows the server's sentence with an upgrade action, never 'Slow down'", async () => {
    const res = await refuseAt("starter", "leads");
    const body = res.body!;
    const view = refusalFromBody(body);
    expect(view, "the client did not recognise a PLAN_LIMIT_REACHED body").not.toBeNull();
    expect(view!.description).toBe(body.message);
    expect(view!.title).toBe("Lead limit reached on Starter");
    expect(view!.action).toEqual({ label: "See Pro", href: "/settings#billing?tier=pro" });

    // The generic classifier (inline error renderers, the mutation toast).
    const err = Object.assign(new Error(`429: ${body.message}`), { status: 429, body });
    expect(getErrorTitle(err)).toBe("Plan limit reached");
    expect(getErrorTitle(err)).not.toMatch(RATE_LIMIT_VOICE);
    expect(getErrorMessage(err)).toBe(body.message);
    expect(isRetryableError(err), "retrying a plan cap cannot succeed").toBe(false);
  });

  it("a real rate limit still reads as one on the client", () => {
    const err = Object.assign(new Error("429: Rate limit exceeded."), {
      status: 429,
      body: { error: "rate_limit_exceeded", message: "Rate limit exceeded." },
    });
    expect(refusalFromBody(err.body)).toBeNull();
    expect(getErrorTitle(err)).toBe("Slow down");
  });
});
