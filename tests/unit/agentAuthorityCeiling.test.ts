/**
 * No grant may raise a founder-only action, and a learned score may not
 * substitute for the founder's placement.
 *
 * ── THREE DEFECTS, ONE GATE ─────────────────────────────────────────────────
 * `checkAuthority` decides what an autonomous agent may do. It is live:
 * `executeWithAuthority` runs inside `agentProactiveEngine` and
 * `agentReactionEngine`, and temporary delegations are granted from a founder
 * route (`routes-founder-intelligence.ts:3982`).
 *
 * 1. A DELEGATION CONVEYED THE HARD STOPS. The temporary-delegation block sat
 *    ABOVE the NEVER_PROMOTE list and returned `allowed: true` at the delegated
 *    level for ANY action — so "I'm away, act for me" silently conveyed
 *    modify_pricing_plans, legal_document_change, process_refund_over_500 and
 *    regulatory_filing. Those are founder-only forever in CLAUDE.md's DO-NOT-DO
 *    list. A ceiling only one branch can see is not a ceiling.
 *
 * 2. TWO PROMOTIONS IN ONE CALL. The trust-promotion block used back-to-back
 *    `if`s, so an action the founder placed at level 2 ("recommend and wait")
 *    could go 2 → 1 → 0 in a single call and reach FULL AUTONOMY on a learned
 *    score. The comments describe two separate single promotions.
 *
 * 3. UNCLASSIFIED WAS PROMOTABLE. An action in none of the founder's four lists
 *    falls to level 2 — the right safe default — but level 2 is exactly the
 *    promotable band. So omission meant both "the founder allowed this at level
 *    2" and "nobody has classified this", and the second was read as the first.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry, `9ddc688` ("the pause-exempt capability let its caller choose the
 * recipient") and `ac17a1f` ("omission meant both 'institutional' and 'somebody
 * forgot'"). The invariants: a ceiling is a property of the ACTION CLASS not of
 * whoever issues the grant, and an omitted declaration must not read as a
 * deliberate one. AcreOS's own hard-stop list is the mechanism; no Foundry noun
 * crossed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const AGENT = { codename: "atlas", status: "active", trustScore: 95 };

let delegation: { hasDelegation: boolean; toLevel?: number; reason?: string } = {
  hasDelegation: false,
};
let authorityConfig: Record<string, string[]> = {};

vi.mock("../../server/db", () => ({
  db: {
    query: {
      companyAgents: { findFirst: vi.fn(async () => ({ ...AGENT, authorityConfig })) },
    },
  },
}));

vi.mock("../../server/services/temporaryDelegation", () => ({
  checkTemporaryDelegation: vi.fn(async () => delegation),
}));

async function check(action: string) {
  vi.resetModules();
  const mod = await import("../../server/services/agentAuthorityGate");
  return mod.checkAuthority("atlas", action);
}

beforeEach(() => {
  delegation = { hasDelegation: false };
  authorityConfig = {
    level0Actions: [],
    level1Actions: [],
    level2Actions: ["send_followup"],
    level3Actions: [],
  };
});

/**
 * Every NEVER_PROMOTE action, EXTRACTED from the gate's own source rather than
 * hand-copied. The previous version of this list claimed "every hard stop" and
 * carried 6 of what were then 15 ids — so when the list grew (the two
 * customer-data-deletion ids added 2026-08-28 after the cross-lane coverage map
 * found the class entirely missing), a copy here would not have known. For a
 * `const [...] as const` of string literals the source IS the runtime value;
 * the extraction is shared with hardStopLaneCoverage.test.ts and vacuity-guarded
 * below — an extraction returning nothing fails loudly instead of driving zero
 * actions and passing.
 */
// From the LIGHT helper, not the coverage test file: importing that test
// dragged autonomousDecisionExecutor's whole module graph into this worker
// on top of the mocked authority-gate graph, and the fork OOM'd at the 2 GB
// default heap. The helper imports only the pure hard-stops module and fs.
import { extractNeverPromoteActions } from "../helpers/neverPromoteActions";
const FOUNDER_ONLY = extractNeverPromoteActions();

describe("a temporary delegation does not convey a founder-only action", () => {
  it("refuses every NEVER_PROMOTE action even with an active delegation to level 0", async () => {
    delegation = { hasDelegation: true, toLevel: 0, reason: "founder away" };

    // Vacuity: an extraction that broke would drive zero actions and pass.
    expect(FOUNDER_ONLY.length).toBeGreaterThanOrEqual(15);
    expect(FOUNDER_ONLY).toContain("delete_customer_data");

    for (const action of FOUNDER_ONLY) {
      const res = await check(action);
      expect(res.allowed, `delegation conveyed ${action}`).toBe(false);
      expect(res.effectiveLevel, `${action} was granted a non-refusing level`).toBe(3);
      expect(res.reason).toMatch(/founder-only/i);
    }
  });

  it("still honours a delegation for an ordinary action", async () => {
    // The guard must narrow the delegation, not disable it — otherwise the fix
    // would quietly remove a feature the founder uses.
    delegation = { hasDelegation: true, toLevel: 1, reason: "founder away" };
    const res = await check("send_followup");
    expect(res.allowed).toBe(true);
    expect(res.effectiveLevel).toBe(1);
  });
});

describe("a learned trust score does not replace the founder's placement", () => {
  it("promotes at most ONE level per call", async () => {
    // trustScore 95 clears both thresholds. Before the fix this went 2 → 1 → 0
    // in one call: "recommend and wait" became full autonomy on a learned score.
    const res = await check("send_followup");
    expect(res.requestedLevel).not.toBe(0);
    expect(res.effectiveLevel).not.toBe(0);
  });

  it("never promotes an action the founder never classified", async () => {
    // Falls to level 2 as the safe default, but must not then be promoted —
    // that is omission being read as permission.
    const res = await check("some_action_nobody_placed");
    expect(res.effectiveLevel).not.toBe(0);
    expect(res.effectiveLevel).not.toBe(1);
  });

  it("never promotes a founder-only action however high the trust score", async () => {
    for (const action of FOUNDER_ONLY) {
      const res = await check(action);
      expect(res.effectiveLevel, `${action} was promoted on trust`).not.toBe(0);
      expect(res.effectiveLevel, `${action} was promoted on trust`).not.toBe(1);
    }
  });
});

describe("a delegation does not convey an action nobody classified", () => {
  /**
   * The delegation branch returned the delegated level for ANY action,
   * `unclassified` included — the exact inference the promotion block below it
   * refuses to make, and states its reason for. The rule was written down in
   * one branch and not applied in the one above it.
   *
   * It is not academic. `agentProactiveEngine` emits `proactive:${behavior.id}`
   * and `agentReactionEngine` emits `reaction:${rule.id}`; no roster entry's
   * level0/1/2/3Actions contains a colon, so EVERY live call through this gate
   * is unclassified. One blanket delegation flipped the whole fleet — and at
   * level 0 silently, since executeWithAuthority notifies only at level 1.
   */
  const LIVE_ACTION_SHAPES = [
    "proactive:churn_watch",
    "reaction:forge_churn_to_sophie",
    "queue_director_goal",
    "some_action_nobody_added_to_the_roster",
  ];

  it("vacuity: these really are unclassified under the roster used here", async () => {
    // authorityConfig lists only send_followup, so each of these is absent from
    // every level. If one were ever added the case below would pass for the
    // wrong reason.
    for (const action of LIVE_ACTION_SHAPES) {
      for (const level of Object.values(authorityConfig)) {
        expect(level, `${action} is classified after all`).not.toContain(action);
      }
    }
  });

  it("holds an unclassified action at recommend-and-wait despite a level-0 delegation", async () => {
    delegation = { hasDelegation: true, toLevel: 0, reason: "founder away" };
    for (const action of LIVE_ACTION_SHAPES) {
      const res = await check(action);
      expect(res.effectiveLevel, `delegation elevated unclassified "${action}"`).toBe(2);
      expect(res.downgraded, action).toBe(true);
      expect(res.reason).toMatch(/not classified/i);
    }
  });

  it("narrows the delegation, it does not refuse it", async () => {
    // The action still runs — at level 2, recommend-and-wait — so the grant
    // keeps working. A guard that returned allowed:false here would break the
    // proactive and reaction engines outright rather than governing them.
    delegation = { hasDelegation: true, toLevel: 0, reason: "founder away" };
    const res = await check("proactive:churn_watch");
    expect(res.allowed).toBe(true);
  });

  it("a CLASSIFIED action still gets the full delegated level", async () => {
    // The other direction, and the reason this is a narrowing rather than a ban:
    // everything the founder actually placed is still elevated.
    delegation = { hasDelegation: true, toLevel: 0, reason: "founder away" };
    const res = await check("send_followup");
    expect(res.effectiveLevel).toBe(0);
    expect(res.downgraded).toBe(false);
  });
});

describe("the remedy the safety gates recommend is actually permitted", () => {
  /**
   * `executionEngine.validateSafetyGates` tells a refused caller, in three
   * separate places, to "use escalate_to_founder". It is a registered executor.
   * It appeared in no tier's allowedActions, so `isActionAllowed` refused it at
   * every trust score including Director's — the system recommended the one
   * action it would not permit.
   *
   * Asking a human for permission is the opposite of acting, so it cannot itself
   * require authority.
   */
  it("every tier permits escalate_to_founder, including Observer", async () => {
    const { trustAuthorityEscalation } = await import(
      "../../server/services/trustAuthorityEscalation"
    );
    // Scores chosen to land in each of the four bands, plus the edges.
    for (const score of [0, 50, 59, 60, 74, 75, 89, 90, 100]) {
      expect(
        trustAuthorityEscalation.isActionAllowed(score, "escalate_to_founder"),
        `trust ${score} (${trustAuthorityEscalation.getTier(score).label}) cannot escalate`,
      ).toBe(true);
    }
  });

  it("vacuity: those scores really do span every tier", async () => {
    const { trustAuthorityEscalation } = await import(
      "../../server/services/trustAuthorityEscalation"
    );
    const labels = new Set(
      [0, 60, 75, 90].map((s) => trustAuthorityEscalation.getTier(s).label),
    );
    expect(labels.size, "the tier table collapsed to fewer bands").toBe(4);
  });

  it("the escalation is not a back door — Observer still cannot act", async () => {
    // The other direction. Making one action universal must not make the tier
    // system permissive; the lowest tier still permits only what it did.
    const { trustAuthorityEscalation } = await import(
      "../../server/services/trustAuthorityEscalation"
    );
    for (const action of ["send_churn_intervention", "advance_deal_stage", "update_lead_status"]) {
      expect(
        trustAuthorityEscalation.isActionAllowed(0, action),
        `Observer was granted ${action}`,
      ).toBe(false);
    }
  });
});
