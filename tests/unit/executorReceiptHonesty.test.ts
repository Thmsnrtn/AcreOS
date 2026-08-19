/**
 * A receipt must not claim more than the effect achieved.
 *
 * THE DEFECT
 * ──────────
 * Two of the 28 company-agent executors returned `success: true` with a receipt
 * describing an effect they never produced.
 *
 *   forge_revenue:apply_discount
 *     → "Discount offer created: 20% off for 3 months for <org>"
 *     No Stripe coupon, no billing change, no row anywhere. Its own comment said
 *     the coupon "requires Stripe API key" while the receipt claimed the effect
 *     regardless — and `verifyAfterMs: 30 days` then scheduled the outcome loop
 *     to verify a discount that was never applied.
 *
 *   sentinel_devops:toggle_data_source
 *     → 'Data source "X" enabled'
 *     No write, no config change, no call. The receipt WAS the implementation.
 *
 * Both are reachable by the founder through the decisions inbox and the CEO
 * command bridge, so the reader who acted on the lie was the founder. And
 * `apply_discount` broke a second rule: pricing changes are founder-only
 * forever, so an agent applying one is not a missing feature — it is a boundary.
 *
 * WHAT IS ASSERTED
 * ────────────────
 * The forbidden BEHAVIOUR is "reports success for an effect it did not have",
 * so the assertions are about the returned result, driven through the real
 * `executeAction` dispatcher. Re-spelling the receipt fails; renaming a variable
 * does not.
 *
 * The other direction is asserted too, and it is the one that keeps this honest:
 * executors that DO perform their effect must still report success, or a fix
 * that made everything refuse would satisfy every case above while disabling the
 * fleet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cascade = vi.fn(async () => ({ status: "resolved", finalConfidence: 90 }));
vi.mock("../../server/services/confidenceCascadeV14", () => ({
  confidenceCascadeService: { resolve: cascade },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const orgRow = { id: 7, name: "Test Org" };
vi.mock("../../server/db", () => ({
  db: {
    query: { organizations: { findFirst: vi.fn(async () => orgRow) } },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const mod = await import("../../server/services/agentActionExecutors");
const { executeAction } = mod as unknown as {
  executeAction: (ctx: Record<string, unknown>) => Promise<{ success: boolean; detail?: string; metrics?: Record<string, unknown> }>;
};

function run(agentCodename: string, actionName: string, input: Record<string, unknown>) {
  return executeAction({ agentCodename, actionName, input: { orgId: 7, ...input } });
}

/** The two that lied, and the phrase each used to lie with. */
const FABRICATORS = [
  { agent: "forge_revenue", action: "apply_discount", input: { percentOff: 20, durationMonths: 3 }, claimed: /created|applied/i },
  { agent: "sentinel_devops", action: "toggle_data_source", input: { sourceName: "attom", enabled: true }, claimed: /^Data source "attom" enabled$/ },
];

describe("an executor that changes nothing reports nothing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("vacuity: both executors are registered and reachable", async () => {
    for (const f of FABRICATORS) {
      const r = await run(f.agent, f.action, f.input);
      expect(r.detail, `${f.agent}:${f.action} has no executor`).not.toMatch(/No executor/i);
    }
  });

  it("refuses instead of reporting an effect it did not have", async () => {
    for (const f of FABRICATORS) {
      const r = await run(f.agent, f.action, f.input);
      expect(r.success, `${f.agent}:${f.action} still reports success`).toBe(false);
      expect(r.detail, `${f.agent}:${f.action}`).toMatch(/refus/i);
      expect(r.metrics?.applied, `${f.agent}:${f.action} must say it applied nothing`).toBe(false);
    }
  });

  it("does not schedule a verification of something that did not happen", async () => {
    // `verifyAfterMs` feeds the outcome loop. Scheduling a 30-day check on a
    // discount that was never applied means the loop grades a fiction and the
    // agent's trust score moves on it.
    for (const f of FABRICATORS) {
      const r = await run(f.agent, f.action, f.input) as { verifyAfterMs?: number };
      expect(r.verifyAfterMs, `${f.agent}:${f.action} scheduled verification`).toBeUndefined();
    }
  });

  it("says where the authority actually lives, rather than only saying no", async () => {
    // A refusal nobody can act on is a dead end. apply_discount names the
    // escalation path because pricing is owner-only forever, not unbuilt — and
    // it says "owner-only" rather than naming the founder, because
    // aiPromptLeakage.test.ts forbids founder POV in strings this file emits.
    const r = await run("forge_revenue", "apply_discount", { percentOff: 20, durationMonths: 3 });
    expect(r.detail).toMatch(/owner-only/i);
    expect(r.detail).toMatch(/escalate_to_founder/);
    // And it must say the effect did NOT happen, not merely that it was denied.
    expect(r.detail).toMatch(/no coupon, no billing change and no record/i);
  });

  it("keeps the governance envelope it already had", async () => {
    // The percentOff/durationMonths caps predate this change and encode a real
    // decision about how large a discount may ever be. A refusal that swallowed
    // them would lose that.
    const over = await run("forge_revenue", "apply_discount", { percentOff: 50, durationMonths: 1 });
    expect(over.detail).toMatch(/max discount is 30%/);
    const long = await run("forge_revenue", "apply_discount", { percentOff: 10, durationMonths: 12 });
    expect(long.detail).toMatch(/max discount duration is 3 months/);
  });
});

describe("executors that DO act still say so", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a real effect still reports success", async () => {
    // The other direction. Without this, a change that refused everything would
    // pass every assertion above and silently disable the fleet.
    const r = await run("sentinel_devops", "clear_cache", { cacheKey: "parcels:tx" });
    expect(r.success, `clear_cache: ${r.detail}`).toBe(true);
    expect(r.detail).toMatch(/Cache cleared/);
  });
});

describe("no executor may report success for an effect it cannot have", () => {
  /**
   * The class, not the instances.
   *
   * Five of the 28 executors fabricated: apply_discount, toggle_data_source,
   * update_roadmap_priority, run_data_quality_check and run_compliance_check.
   * Two reported invented NUMBERS — "12 checks, 12 passed, 0 failed" and
   * "violations: 0" — which is worse than an invented sentence, because a
   * consumer cannot tell a fabricated zero from a measured one.
   *
   * At five out of twenty-eight this stopped being a pair of bugs. The register
   * below is DERIVED from the source at run time rather than listed here, so an
   * executor added tomorrow is covered the day it lands, and each candidate is
   * then DRIVEN through the real dispatcher — the assertion is about the result
   * it returns, not about the shape of its body.
   *
   * "Effect" is read generously on purpose: any database call, any mail or SMS
   * send, or any import of another service counts. A body with none of those
   * cannot have changed anything outside itself, so `success: true` from it is
   * a claim about the world made by code that never touched the world.
   */
  const SRC = readFileSync(
    resolve(__dirname, "../../server/services/agentActionExecutors.ts"), "utf8",
  );

  const EFFECT = /\bdb\.(insert|update|delete|query|select)\b|emailService|sendEmail|sendOrgSMS|await import\("\.\/[a-zA-Z]+"\)/;

  function executorBlocks(): Array<{ agent: string; action: string; body: string }> {
    const re = /registerExecutor\("([a-z_]+)",\s*"([a-z_]+)",\s*async \((?:ctx|_ctx)\) => \{([\s\S]*?)\n\}\);/g;
    const out: Array<{ agent: string; action: string; body: string }> = [];
    for (const m of SRC.matchAll(re)) out.push({ agent: m[1], action: m[2], body: m[3] });
    return out;
  }

  it("vacuity: the parser finds the real executor population", () => {
    // If the regex stopped matching — a formatting change, a rename — every
    // case below would pass over an empty list and certify nothing.
    const blocks = executorBlocks();
    expect(blocks.length, "executor parser found too few blocks").toBeGreaterThanOrEqual(25);
    // And it must find BOTH kinds, or the discrimination below is untested.
    const inert = blocks.filter((b) => !EFFECT.test(b.body));
    const acting = blocks.filter((b) => EFFECT.test(b.body));
    expect(acting.length, "no executor appears to act — the EFFECT regex broke").toBeGreaterThan(15);
    expect(inert.length, "no inert executor remains — update this test's premise").toBeGreaterThan(0);
  });

  it("every executor with no effect in its body refuses", async () => {
    const lying: string[] = [];
    for (const b of executorBlocks()) {
      if (EFFECT.test(b.body)) continue;
      const r = await run(b.agent, b.action, {
        sourceName: "x", featureId: 1, newPriority: "high", checkType: "general",
      });
      if (r.success) lying.push(`${b.agent}:${b.action} reported success having done nothing`);
    }
    expect(lying).toEqual([]);
  });

  it("and reports no measured number it did not measure", async () => {
    // The specific harm in run_data_quality_check and run_compliance_check: a
    // fabricated count is indistinguishable from a real one downstream.
    for (const [agent, action] of [
      ["crucible_qa", "run_data_quality_check"],
      ["shield_legal", "run_compliance_check"],
    ] as const) {
      const r = await run(agent, action, { checkType: "general" });
      expect(r.success, `${action}`).toBe(false);
      expect(JSON.stringify(r.metrics ?? {}), `${action} still reports a finding`)
        .not.toMatch(/"(passed|failed|violations)":\s*\d/);
      expect(r.detail, action).toMatch(/not evidence|ran none/i);
    }
  });
});
