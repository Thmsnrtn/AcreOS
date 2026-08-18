/**
 * Trust may only be granted by evidence the agent did not author.
 *
 * ── WHY THIS IS NOT A SCORING DETAIL ────────────────────────────────────────
 * `agentAuthorityGate.checkAuthority` promotes a level-2 action ("recommend and
 * wait") to level 1, and level 1 to level 0 (FULL AUTONOMY), on `trustScore`
 * alone. Whatever raises that number decides what the system may do without
 * asking. Two of the three dimensions that raise it let the agent raise it by
 * itself.
 *
 * ── DIMENSION 2 — THE EXECUTION LOG ─────────────────────────────────────────
 * `+1` when `agentActionLog.outcome = 'success'` covered ≥80% of an agent's
 * actions that day. That column is the actor's own receipt: eight of the ten
 * sites that write it write the literal `"success"` at ISSUE time —
 * `predictiveAutoscaler` writes it beside `output: { scheduled: true }` and
 * `durationMs: 0` — and the tenth writes `result.success`, "the executor did
 * not throw". A 3-day streak then multiplied the gain by 1.5.
 *
 * The file already carried the argument against itself. Dimension 3 was added
 * "NEW in v5" under the comment "Real outcome verification: did the action
 * actually HELP?", reading `outcomeVerificationQueue`, whose verifiers check
 * actual database state. Dimension 2 was left granting the same +1.
 *
 * ── DIMENSION 1 — auto_resolved ─────────────────────────────────────────────
 * Accuracy counted `status = 'approved' OR status = 'auto_resolved'` over ALL
 * items. `auto_resolved` means the autonomous executor closed it with no human
 * involved, so an agent that never escalated scored 100% and gained trust —
 * downward pressure on escalation, the same defect found in
 * `outcomeVerificationLoop` pointing the other way.
 *
 * ── WHERE IT CAME FROM ──────────────────────────────────────────────────────
 * Foundry §18 — learning does not create authority. Third and most consequential
 * instance in this branch, after the outcome verifier (entry 12) and the
 * autopilot efficacy vote (entry 13). This is the one that actually moves
 * authority.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trustDeltaFrom, type TrustEvidence } from "../../server/services/trustDelta";

const NONE: TrustEvidence = {
  humanApproved: 0,
  humanRejected: 0,
  autoResolved: 0,
  overridden: 0,
  selfReportedActions: 0,
  selfReportedFailures: 0,
  verifiedPositive: 0,
  verifiedNegative: 0,
};
const ev = (over: Partial<TrustEvidence>): TrustEvidence => ({ ...NONE, ...over });

/** The default `trust.promotion_accuracy_gate` is 0.9. */
const GATE = 90;

describe("the agent's own execution log cannot raise trust", () => {
  it("A PERFECT DAY OF SELF-REPORTED SUCCESSES GRANTS NOTHING", () => {
    // The exact shape that used to grant +1, and then ×1.5 on a streak.
    const r = trustDeltaFrom(ev({ selfReportedActions: 50, selfReportedFailures: 0 }), GATE);
    expect(r.delta, "an agent earned authority by asserting its own success").toBe(0);
  });

  it("the actions are still REPORTED, marked as not scored", () => {
    // Silence would be worse: a human reading the trust log should see the
    // activity and see that it did not count.
    const r = trustDeltaFrom(ev({ selfReportedActions: 50 }), GATE);
    expect(r.reasons.join(" ")).toMatch(/execution is not an outcome/);
  });

  it("A RUN OF FAILURES STILL COSTS TRUST — the asymmetry is deliberate", () => {
    // A failed action is conclusive: it did not do what it set out to do. A
    // succeeded one proves only that it ran. Removing this for symmetry would
    // throw away a real signal.
    expect(trustDeltaFrom(ev({ selfReportedActions: 10, selfReportedFailures: 5 }), GATE).delta).toBe(-1);
  });
});

describe("auto-resolution is neither correctness nor error", () => {
  it("A DAY OF NOTHING BUT AUTO-RESOLVED ITEMS MOVES TRUST NEITHER WAY", () => {
    const r = trustDeltaFrom(ev({ autoResolved: 40 }), GATE);
    expect(r.delta, "never escalating earned trust").toBe(0);
    expect(r.accuracyRate, "an unadjudicated day produced an accuracy figure").toBeNull();
  });

  it("does not drag a real accuracy figure down either", () => {
    // The mirror-image error. Excluding auto-resolution from the numerator but
    // leaving it in the denominator would punish an agent for working.
    const r = trustDeltaFrom(ev({ humanApproved: 10, humanRejected: 0, autoResolved: 90 }), GATE);
    expect(r.accuracyRate).toBe(100);
    expect(r.delta).toBe(1);
  });

  it("records the auto-resolved count so the gap is visible", () => {
    expect(trustDeltaFrom(ev({ autoResolved: 7 }), GATE).reasons.join(" "))
      .toMatch(/7 auto-resolved \(not scored/);
  });
});

describe("what CAN raise trust", () => {
  it("a human approving decisions", () => {
    expect(trustDeltaFrom(ev({ humanApproved: 9, humanRejected: 1 }), GATE).delta).toBe(1);
  });

  it("an independently VERIFIED outcome", () => {
    // Dimension 3, unchanged — outcomeVerifiers check real database state.
    expect(trustDeltaFrom(ev({ verifiedPositive: 2 }), GATE).delta).toBe(2);
    expect(trustDeltaFrom(ev({ verifiedPositive: 9 }), GATE).delta).toBe(2); // capped
  });

  it("and both still lose it: overrides, rejections, verified failures", () => {
    expect(trustDeltaFrom(ev({ overridden: 3 }), GATE).delta).toBe(-3);
    expect(trustDeltaFrom(ev({ humanApproved: 1, humanRejected: 9 }), GATE).delta).toBe(-1);
    expect(trustDeltaFrom(ev({ verifiedNegative: 2 }), GATE).delta).toBe(-2);
  });

  it("VACUITY GUARD — the rule can produce a positive delta at all", () => {
    // If `trustDeltaFrom` were broken to always return 0, every assertion in
    // the first two describes would pass and the trust system would be dead.
    expect(trustDeltaFrom(ev({ humanApproved: 10, verifiedPositive: 2 }), GATE).delta).toBeGreaterThan(0);
  });
});

describe("the rule is the one production uses", () => {
  const strip = (raw: string): string =>
    raw.split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
      .join("\n");
  const code = strip(
    fs.readFileSync(path.resolve(__dirname, "../../server/services/trustEvolution.ts"), "utf8"),
  );

  it("runTrustEvolution computes its delta through trustDeltaFrom", () => {
    // A pure rule with no production caller proves nothing about the product
    // (CLAUDE.md, second law). This is the adoption check — and it looks
    // INSIDE runTrustEvolution, not across the file.
    //
    // The first draft asserted `code.toContain("trustDeltaFrom(")`, which the
    // function's own `export function trustDeltaFrom(` satisfies. Replacing the
    // call site with an inline lambda left it green: the identifier was
    // present, the adoption was not. That is the same first-law failure this
    // branch already hit once, in featureFlagControlScope.
    const at = code.indexOf("export async function runTrustEvolution");
    expect(at, "runTrustEvolution is gone — re-adjudicate this check").toBeGreaterThan(0);
    const body = code.slice(at);
    expect(
      body,
      "runTrustEvolution no longer computes its delta through the shared rule",
    ).toContain("trustDeltaFrom(");
  });

  it("NO self-reported success count is read back into the delta path", () => {
    // The semantic check: not "the old line is gone" but "the quantity that
    // caused it is no longer available to be scored". The query no longer
    // selects a success count at all.
    expect(
      code,
      "the execution log's success count is being read again — that is the receipt " +
        "that used to grant authority",
    ).not.toMatch(/filter \(where outcome = 'success'\)/);
  });

  it("auto_resolved is not folded in with approved", () => {
    expect(
      code,
      "auto-resolution is being counted as a human approval again",
    ).not.toMatch(/status = 'approved' or status = 'auto_resolved'/);
  });
});
