/**
 * A check that cannot run is not a check that passed.
 *
 * THE DEFECT
 * ──────────
 * `agentActionExecutors.executeAction` is the function behind every real side
 * effect the company-agent fleet produces — 28 registered executors including a
 * live retention email, a trial extension, and a feature unlock. Its only
 * pre-execution gate is the confidence cascade, and the whole gate was wrapped
 * in:
 *
 *     } catch {
 *       // Cascade check failure is non-blocking — proceed with execution
 *     }
 *
 * So an unavailable cascade service was permission. The sibling module
 * `executionEngine.ts` had already learned this and says it in capitals at its
 * own safety gates, replacing every such catch with an `unevaluable()`
 * violation. The lesson was applied in one file and not the other.
 *
 * The same ten lines carried a second one: `const orgId = ctx.input.orgId || 0`.
 * The cascade is evaluated FOR A TENANT, and `|| 0` invented org 0 — a value
 * this repository treats as a forbidden sentinel elsewhere — so an action with
 * no organization resolved its cascade against a tenant that does not exist and
 * the answer was read as a pass.
 *
 * WHAT IS ASSERTED
 * ────────────────
 * Both refusals, and the two directions that keep the refusal honest: a working
 * cascade must still let an approved action through, and a NON-significant
 * action must not be dragged into a gate that never applied to it. Without that
 * last case a fix that simply refused everything would pass the rest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
// Aliased: this file already binds `resolve` to the cascade mock.
import { resolve as resolvePath } from "node:path";

const resolve = vi.fn();
vi.mock("../../server/services/confidenceCascadeV14", () => ({
  confidenceCascadeService: { resolve: (...a: unknown[]) => resolve(...a) },
}));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mod = await import("../../server/services/agentActionExecutors");
const { executeAction, isSignificantAction, _CASCADE_EXEMPT_ACTIONS } = mod as unknown as {
  executeAction: (ctx: Record<string, unknown>) => Promise<{ success: boolean; detail?: string }>;
  isSignificantAction?: (n: string) => boolean;
  _CASCADE_EXEMPT_ACTIONS: ReadonlySet<string>;
};

/**
 * An action that IS significant and DOES have a registered executor.
 *
 * Both halves matter: a name with no executor returns early with "No executor",
 * never reaching the cascade, and a name that is not significant skips the gate
 * entirely — either would make every assertion below pass without touching the
 * code under test.
 */
const SIGNIFICANT = "send_retention_email";

function ctx(over: Record<string, unknown> = {}) {
  return {
    agentCodename: "sophie_csm",
    actionName: SIGNIFICANT,
    input: { orgId: 7 },
    ...over,
  };
}

describe("the cascade gate refuses when it cannot answer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolve.mockResolvedValue({ status: "resolved", finalConfidence: 90 });
  });

  it("vacuity: the action under test really is gated and really has an executor", async () => {
    if (typeof isSignificantAction === "function") {
      expect(isSignificantAction(SIGNIFICANT), `${SIGNIFICANT} is not a significant action`).toBe(true);
    }
    // A missing executor short-circuits before the cascade; prove we get past it
    // by observing that the cascade was consulted at all.
    await executeAction(ctx());
    expect(resolve, "the cascade was never reached — pick a different action").toHaveBeenCalled();
  });

  it("refuses when the cascade throws, instead of proceeding", async () => {
    resolve.mockRejectedValue(new Error("cascade service unavailable"));
    const r = await executeAction(ctx());
    expect(r.success).toBe(false);
    expect(r.detail).toMatch(/could not be evaluated/i);
    expect(r.detail).toMatch(/cascade service unavailable/);
  });

  it("refuses when there is no organization, instead of inventing org 0", async () => {
    for (const input of [{}, { orgId: 0 }, { orgId: null }, { orgId: "7" }, { orgId: -1 }]) {
      const r = await executeAction(ctx({ input }));
      expect(r.success, `orgId ${JSON.stringify(input)} was accepted`).toBe(false);
      expect(r.detail).toMatch(/no organization/i);
    }
    expect(resolve, "the cascade was consulted for a tenant that does not exist")
      .not.toHaveBeenCalled();
  });

  it("still blocks what the cascade blocks, and escalates what it escalates", async () => {
    resolve.mockResolvedValue({ status: "governance-blocked", finalDecision: "policy X" });
    expect((await executeAction(ctx())).detail).toMatch(/blocked/i);

    resolve.mockResolvedValue({ status: "escalated", finalConfidence: 20, resolutionId: 9 });
    expect((await executeAction(ctx())).detail).toMatch(/founder approval/i);
  });

  it("does not gate an action the cascade never applied to", async () => {
    // The other direction. A refusal that swallowed everything would satisfy the
    // cases above while breaking every routine action.
    resolve.mockRejectedValue(new Error("cascade down"));
    const r = await executeAction(ctx({ actionName: "clear_cache", input: {} }));
    expect(r.detail ?? "").not.toMatch(/could not be evaluated|no organization/i);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("the cascade gate is exempt-by-name, not gated-by-name", () => {
  /**
   * The list used to be a 13-name SIGNIFICANT_ACTIONS allowlist, so an executor
   * added tomorrow skipped the cascade by default and nobody had to decide
   * that. It also got the substance wrong in both directions: `draft_social_post`
   * (drafts, sends nothing) was gated, while `pause_campaign` — which UPDATEs a
   * customer's live campaign — was not.
   *
   * The exempt set is checked against the REAL executor registry parsed from
   * source, so an exemption for an executor that no longer exists fails, and a
   * new executor cannot inherit an exemption nobody chose.
   */
  const SRC = readFileSync(
    resolvePath(__dirname, "../../server/services/agentActionExecutors.ts"), "utf8",
  );
  const registeredActions = [
    ...new Set([...SRC.matchAll(/registerExecutor\("[a-z_]+",\s*"([a-z_]+)"/g)].map((m) => m[1])),
  ];

  it("vacuity: the registry parse found the real executor population", () => {
    expect(registeredActions.length).toBeGreaterThanOrEqual(25);
  });

  it("a customer-visible state change is never exempt", () => {
    // The two the old allowlist missed, plus the sends it did cover — stated by
    // name because these are the ones whose exemption would cost a customer.
    for (const action of [
      "pause_campaign", "resolve_stale_ticket",
      "send_retention_email", "send_upgrade_nudge", "send_churn_rescue",
      "apply_discount", "extend_trial", "unlock_feature_temporarily",
    ]) {
      expect(registeredActions, `${action} is no longer a registered executor`).toContain(action);
      expect(isSignificantAction?.(action), `${action} skips the confidence cascade`).toBe(true);
    }
  });

  it("an action nobody has classified is significant by default", () => {
    // The polarity, stated directly. Under the old allowlist these were all
    // ungated; under the exempt set they are all gated until someone says
    // otherwise.
    for (const invented of ["send_wire", "delete_org", "publish_listing", ""]) {
      expect(isSignificantAction?.(invented), `"${invented}" was exempt`).toBe(true);
    }
  });

  it("no exemption names an executor that no longer exists", () => {
    const stale = [..._CASCADE_EXEMPT_ACTIONS].filter((a) => !registeredActions.includes(a));
    expect(stale, "exemptions for executors the registry no longer has").toEqual([]);
  });

  it("the exempt set stays small, and none of it reaches a customer", () => {
    // Every exemption is a place the cascade does not run. The list growing
    // quietly is how the gate stops meaning anything.
    expect(_CASCADE_EXEMPT_ACTIONS.size).toBeLessThanOrEqual(15);
    for (const a of _CASCADE_EXEMPT_ACTIONS) {
      expect(a, `${a} looks like an outbound action`).not.toMatch(/^send_|email|sms|publish/);
    }
  });
});
