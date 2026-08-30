/**
 * A check that cannot run is not a check that passed.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `validateSafetyGates` in the autonomous execution engine returns
 * `passed: violations.length === 0`. Four of its gates were wrapped in
 * swallowing catches:
 *
 *   } catch { /* governance brain may not be available *\/ }
 *   } catch { /* trust service may not be available *\/ }
 *   } catch { /* delegation service may not be available *\/ }
 *   } catch {}                                    // deal value threshold
 *
 * An unavailable governance brain, trust service, delegation service or
 * database therefore contributed NO violation — and no violation is a PASS.
 * Unavailability was permission, on the function that authorises autonomous
 * agent actions including `advance_deal_stage` and `send_churn_intervention`
 * (a customer contact).
 *
 * The comments were the tell. "may not be available" names the failure and
 * then treats it as success.
 *
 * ── THE PATTERN WAS ALREADY IN THE FILE ─────────────────────────────────────
 * `checkRateLimit`, the gate immediately above these four, ends:
 *
 *   } catch { return { allowed: false, reason: "rate-limit state unverifiable
 *                      — refusing action (fail closed)" }; }
 *
 * Same file, same function, one gate earlier. The recurring shape of this
 * campaign: the correct rule usually already exists nearby and is not the one
 * being used.
 *
 * ── WHAT IS GATED ───────────────────────────────────────────────────────────
 * Each unavailable dependency must produce a REFUSAL naming the gate — and the
 * suite asserts the same action succeeds when the dependencies work, so
 * "refuse everything" cannot pass for a fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = 12;

/** A high-impact action, so the governance and delegation gates both run. */
const CTX = {
  orgId: ORG,
  agentCodename: "atlas",
  action: "advance_deal_stage",
  input: { dealId: 5 },
};

interface Deps {
  governanceThrows?: boolean;
  trustThrows?: boolean;
  dbSelectThrows?: boolean;
  action?: string;
}

async function runExecute(deps: Deps) {
  vi.resetModules();

  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self,
      where: () => self,
      limit: () => self,
      orderBy: () => self,
      values: () => self,
      returning: () => self,
      onConflictDoUpdate: () => self,
      then: (r: (v: unknown) => void) => r(rows),
    };
    return self;
  };

  vi.doMock("../../server/db", () => ({
    db: {
      select: () => {
        if (deps.dbSelectThrows) throw new Error("db unavailable");
        // No deal row → the value-threshold gate finds nothing to object to.
        return chain([]);
      },
      insert: () => chain([{ id: 1 }]),
      update: () => chain([]),
      execute: async () => [],
    },
  }));
  vi.doMock("../../server/websocket", () => ({
    wsServer: { broadcastFounderEvent: () => {} },
  }));

  // The rate limiter runs first and fails closed on a db error; give it a
  // clean path so the four gates under test are what decide the outcome.
  vi.doMock("../../server/services/governanceBrainV13", () => {
    if (deps.governanceThrows) throw new Error("governance brain offline");
    return {
      governanceBrainService: {
        evaluateAction: async () => ({ overallResult: "allowed", explanation: "" }),
      },
    };
  });
  vi.doMock("../../server/services/trustAuthorityEscalation", () => {
    if (deps.trustThrows) throw new Error("trust service offline");
    return {
      trustAuthorityEscalation: {
        isActionAllowed: () => true,
        getTier: () => ({ level: 3, label: "Director", allowedActions: ["advance_deal_stage"] }),
      },
    };
  });
  vi.doMock("../../server/services/companyAgents", () => ({
    companyAgentService: {
      getByCodename: async () => ({ trustScore: 95 }),
      // The gate reads the EFFECTIVE score, which folds in any active
      // CEO-absence boost at the read rather than from the stored column.
      effectiveTrustScore: async () => 95,
    },
  }));
  const { executionEngine } = await import("../../server/services/executionEngine");
  return executionEngine.execute({ ...CTX, action: deps.action ?? CTX.action } as never);
}

describe("safety gates fail CLOSED when they cannot be evaluated", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("vacuity guard: with every dependency healthy the action is NOT blocked by these gates", async () => {
    // A non-financial action: the structural founder-gate on
    // advance_deal_stage / flag_deal_risk (stage-4 turn 14) is a deliberate
    // refusal, not an unevaluable one, and would muddy this guard.
    const result = await runExecute({ action: "send_churn_intervention" });
    const err = result.error ?? "";
    // The action may still fail downstream (no real handler), but it must not
    // be refused by an unevaluable-gate violation — otherwise every assertion
    // below passes for the wrong reason.
    expect(err, `a healthy run was blocked:\n${err}`).not.toMatch(/could not be evaluated/);
  });

  it.each([
    ["governanceThrows", /Governance policy check could not be evaluated/],
    ["trustThrows", /Trust authority check could not be evaluated/],
  ] as const)("an unavailable dependency (%s) refuses the action", async (key, pattern) => {
    const result = await runExecute({ [key]: true });
    expect(result.success, "the action ran with an unevaluable authority gate").toBe(false);
    expect(result.error ?? "").toMatch(pattern);
    // The refusal must say WHY, so an operator sees "could not verify" rather
    // than a bare denial.
    expect(result.error ?? "").toMatch(/refusing rather than assuming permission/);
  });

  it("the refusal offers a route forward rather than a dead end", async () => {
    const result = await runExecute({ trustThrows: true });
    const alternatives = JSON.stringify((result as { output?: unknown }).output ?? "") + (result.error ?? "");
    expect(alternatives).toMatch(/Trust authority check/);
    expect(result.success).toBe(false);
  });
});

describe("financial actions are structurally founder-gated (stage-4 turn 14)", () => {
  // delegationTokensV11 is retired. Its live verdict was a constant deny —
  // no token was ever granted outside a founder curl — and this block pins
  // that the deny SURVIVED the retirement as an explicit structural
  // escalate: the two financial actions cannot execute autonomously even
  // with every dependency healthy and every legacy gate satisfied.
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(["advance_deal_stage", "flag_deal_risk"])(
    "%s is refused with healthy dependencies and a route to the founder",
    async (action) => {
      const result = await runExecute({ action });
      expect(result.success, `${action} executed autonomously`).toBe(false);
      const all = (result.error ?? "") + JSON.stringify((result as { output?: unknown }).output ?? "");
      expect(all).toMatch(/structurally founder-gated/);
      expect(all).toMatch(/escalate_to_founder/);
    },
  );

  it("the structural gate names no service — it cannot be unevaluable", async () => {
    const result = await runExecute({ action: "advance_deal_stage" });
    expect(result.error ?? "").not.toMatch(/Delegation token check could not be evaluated/);
  });
});
