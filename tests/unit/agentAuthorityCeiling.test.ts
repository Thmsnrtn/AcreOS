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

/** Every hard stop, so the guard cannot be satisfied by one representative. */
const FOUNDER_ONLY = [
  "modify_pricing_plans",
  "legal_document_change",
  "process_refund_over_500",
  "regulatory_filing",
  "change_payment_processor",
  "database_migration",
];

describe("a temporary delegation does not convey a founder-only action", () => {
  it("refuses every NEVER_PROMOTE action even with an active delegation to level 0", async () => {
    delegation = { hasDelegation: true, toLevel: 0, reason: "founder away" };

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
