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
