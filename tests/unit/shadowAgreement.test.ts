/**
 * Horizon A2 — shadow agreement (autonomy promotions by demonstrated agreement).
 *
 * Pins the SACRED LINE and the honesty contract:
 *   1. markShadowExperience is PURE and side-effect-free: it marks ONLY rows the
 *      AUTONOMY gate held back, never mutates its input, and namespaces the
 *      shadow join key ("shadow:…") apart from the real consequence keys
 *      ("invoice:…"/"email:…") so no webhook can ever credit — or fire autonomy
 *      feedback through — a shadow row.
 *   2. shadowAgreementFromRecords counts a pair ONLY when the real outcome
 *      resolved; pending pairs are excluded from the denominator and reported;
 *      below SHADOW_MIN_PAIRS the reading is insufficient; the misses list is
 *      the 3 most recent disagreements verbatim.
 *
 * All pure — no DB, no mocks (constitutional: statistics only from real
 * matched pairs, so the arithmetic itself must be pinnable without I/O).
 */
import { describe, expect, it } from "vitest";
import {
  markShadowExperience,
  shadowAgreementFromRecords,
  formatShadowAgreementLine,
  SHADOW_MIN_PAIRS,
  SHADOW_TARGET_PREFIX,
  SHADOW_WINDOW_WEEKS,
} from "../../server/services/autopilot/shadowAgreement";
import type { DecisionRecord } from "../../server/services/autopilot/decisionEval";
import { deriveTargetRef } from "../../server/services/autopilot/experienceLog";

const NOW = new Date("2026-07-14T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

// ── 1. Shadow marking (pure part of the write path) ─────────────────────────

describe("markShadowExperience — marks ONLY autonomy-gate holds, purely", () => {
  const trace = { narrative: "held it", senses: { mrr: 1 } };

  it("marks an OBSERVE block (suppressed by the autonomy gate) with shadow:true + shadowedCapability + namespaced targetRef", () => {
    const r = markShadowExperience({
      outcome: "suppressed",
      gateDecidedBy: "autonomy",
      moveKind: "recover_payments",
      reasoningTrace: trace,
      situationKey: "growth_target:42",
    });
    expect(r.isShadow).toBe(true);
    expect(r.reasoningTrace).toMatchObject({
      shadow: true,
      shadowedCapability: "recover_payments",
      narrative: "held it",
    });
    expect(r.targetRef).toBe("shadow:growth_target:42");
  });

  it("marks a DRAFT escalation (escalated by the autonomy gate) the same way", () => {
    const r = markShadowExperience({
      outcome: "escalated",
      gateDecidedBy: "autonomy",
      moveKind: "grow_owned_channels",
      reasoningTrace: trace,
      situationKey: "abc123",
    });
    expect(r.isShadow).toBe(true);
    expect(r.targetRef).toBe("shadow:abc123");
  });

  it("does NOT mark suppressions/escalations from any OTHER gate, nor acted/error outcomes", () => {
    for (const [outcome, gate] of [
      ["suppressed", "budget"],
      ["suppressed", "compliance"],
      ["escalated", "witnessed_send"],
      ["escalated", "risk"],
      ["escalated", "premortem"],
      ["acted", "autonomy"], // acted rows are real actions, never shadows
      ["error", "autonomy"],
      ["suppressed", null],
    ] as const) {
      const r = markShadowExperience({
        outcome,
        gateDecidedBy: gate,
        moveKind: "optimize",
        reasoningTrace: trace,
        situationKey: "k",
      });
      expect(r.isShadow).toBe(false);
      expect(r.targetRef).toBeNull();
      // The trace is passed through UNCHANGED — no shadow field appears.
      expect(r.reasoningTrace).toBe(trace);
      expect("shadow" in r.reasoningTrace).toBe(false);
    }
  });

  it("SACRED LINE: pure and side-effect-free — the input trace is never mutated; the result is data only", () => {
    const input = { narrative: "x", senses: { trials: 2 } };
    const frozen = JSON.stringify(input);
    const r = markShadowExperience({
      outcome: "suppressed",
      gateDecidedBy: "autonomy",
      moveKind: "resolve_incident",
      reasoningTrace: input,
      situationKey: "sit-1",
    });
    // New object, input untouched.
    expect(r.reasoningTrace).not.toBe(input);
    expect(JSON.stringify(input)).toBe(frozen);
    // The result carries NO fields the reward edge could consume.
    expect(r).not.toHaveProperty("successes");
    expect(r).not.toHaveProperty("failures");
    expect(r).not.toHaveProperty("dispatchId");
  });

  it("the shadow targetRef namespace is structurally disjoint from every real consequence key", () => {
    const shadow = markShadowExperience({
      outcome: "suppressed",
      gateDecidedBy: "autonomy",
      moveKind: "recover_payments",
      reasoningTrace: {},
      situationKey: "invoice-situation-9",
    }).targetRef!;
    expect(shadow.startsWith(SHADOW_TARGET_PREFIX)).toBe(true);
    // deriveTargetRef (the only producer of real consequence join keys) can
    // only ever emit "invoice:…" or "email:…" — a webhook crediting those can
    // never match a "shadow:…" row, so a shadow row can never receive a
    // consequence nor fire the autonomy feedback that rides on one.
    expect(deriveTargetRef("send_email", { to: "X@Y.com" })).toBe("email:x@y.com");
    expect(deriveTargetRef("anything", {}, "in_123")).toBe("invoice:in_123");
    expect(deriveTargetRef("anything", {})).toBeNull();
    for (const real of ["invoice:", "email:"]) {
      expect(shadow.startsWith(real)).toBe(false);
    }
  });

  it("no situation key → no targetRef (honest abstention, never an invented join)", () => {
    const r = markShadowExperience({
      outcome: "suppressed",
      gateDecidedBy: "autonomy",
      moveKind: "optimize",
      reasoningTrace: {},
      situationKey: null,
    });
    expect(r.isShadow).toBe(true);
    expect(r.targetRef).toBeNull();
  });
});

// ── 2. Agreement statistics ──────────────────────────────────────────────────

function shadowRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    moveKind: "recover_payments",
    domain: "finance",
    senses: { unique: Math.random() },
    predictedSuccess: null,
    vote: "success",
    at: daysAgo(1),
    shadow: { shadowedCapability: "recover_payments" },
    ...overrides,
  };
}

describe("shadowAgreementFromRecords — pairs only from RESOLVED outcomes", () => {
  it("counts matched only on resolved pairs; pending pairs are excluded from the denominator and reported", () => {
    const records = [
      ...Array.from({ length: 6 }, (_, i) => shadowRecord({ at: daysAgo(i + 1), vote: "success" })),
      shadowRecord({ at: daysAgo(8), vote: "failure" }),
      shadowRecord({ at: daysAgo(9), vote: "failure" }),
      // Unresolved — never in the denominator, reported as pending.
      shadowRecord({ at: daysAgo(2), vote: "pending" }),
      shadowRecord({ at: daysAgo(3), vote: "pending" }),
    ];
    const a = shadowAgreementFromRecords(records, { now: NOW });
    expect(a.total).toBe(8);
    expect(a.matched).toBe(6); // the shadow made the call on every row; wins agree, losses disagree
    expect(a.pendingPairs).toBe(2);
    expect(a.sufficient).toBe(true); // 8 >= SHADOW_MIN_PAIRS
  });

  it("ignores non-shadow records and rows outside the trailing window (or without a timestamp)", () => {
    const records = [
      shadowRecord({ vote: "success" }),
      // Not shadow-marked — a real acted decision.
      shadowRecord({ shadow: null, vote: "success" }),
      // Outside the 6-week window.
      shadowRecord({ at: daysAgo(SHADOW_WINDOW_WEEKS * 7 + 1), vote: "success" }),
      // No timestamp — cannot be honestly placed in the window.
      shadowRecord({ at: null, vote: "success" }),
    ];
    const a = shadowAgreementFromRecords(records, { now: NOW });
    expect(a.total).toBe(1);
    expect(a.matched).toBe(1);
    expect(a.pendingPairs).toBe(0);
  });

  it("MIN_PAIRS gate: below the honest minimum the reading is insufficient — never padded", () => {
    const records = Array.from({ length: SHADOW_MIN_PAIRS - 1 }, (_, i) =>
      shadowRecord({ at: daysAgo(i + 1), vote: "success" }),
    );
    const a = shadowAgreementFromRecords(records, { now: NOW });
    expect(a.total).toBe(SHADOW_MIN_PAIRS - 1);
    expect(a.sufficient).toBe(false);
  });

  it("misses are the 3 MOST RECENT disagreements, verbatim {when, moveKind, shadowCall, actualRuling}", () => {
    const records = [
      shadowRecord({ at: daysAgo(1), vote: "success" }),
      shadowRecord({ at: daysAgo(2), vote: "failure", moveKind: "convert_trials", shadow: { shadowedCapability: "convert_trials" } }),
      shadowRecord({ at: daysAgo(5), vote: "failure", moveKind: "retain_at_risk", shadow: { shadowedCapability: "retain_at_risk" } }),
      shadowRecord({ at: daysAgo(9), vote: "failure", moveKind: "recover_payments" }),
      shadowRecord({ at: daysAgo(20), vote: "failure", moveKind: "grow_owned_channels", shadow: { shadowedCapability: "grow_owned_channels" } }),
    ];
    const a = shadowAgreementFromRecords(records, { now: NOW });
    expect(a.misses).toHaveLength(3);
    expect(a.misses.map((m) => m.moveKind)).toEqual([
      "convert_trials",
      "retain_at_risk",
      "recover_payments",
    ]); // most recent first; the day-20 miss falls off the top-3
    expect(a.misses[0]).toMatchObject({
      when: daysAgo(2).toISOString(),
      shadowCall: "convert_trials",
    });
    expect(a.misses[0].actualRuling).toContain("failure");
    // total counts all 5 resolved; matched only the win.
    expect(a.total).toBe(5);
    expect(a.matched).toBe(1);
  });

  it("empty input → honest zeros, insufficient, no misses", () => {
    const a = shadowAgreementFromRecords([], { now: NOW });
    expect(a).toMatchObject({ matched: 0, total: 0, pendingPairs: 0, sufficient: false, misses: [] });
  });

  it("SACRED LINE: the reading carries no successes/failures fields (cannot be coerced into PlayStats)", () => {
    const a = shadowAgreementFromRecords([shadowRecord()], { now: NOW });
    expect(a).not.toHaveProperty("successes");
    expect(a).not.toHaveProperty("failures");
    expect(a).not.toHaveProperty("playId");
    expect(a.caveat.length).toBeGreaterThan(0); // the proxy's honesty caveat rides along
  });
});

describe("formatShadowAgreementLine — the small, honest trust-ledger line", () => {
  it("sufficient → 'shadow: N/M matched, Wwk'", () => {
    const records = [
      ...Array.from({ length: 11 }, (_, i) => shadowRecord({ at: daysAgo(i + 1), vote: "success" })),
      shadowRecord({ at: daysAgo(12), vote: "failure" }),
    ];
    const line = formatShadowAgreementLine(shadowAgreementFromRecords(records, { now: NOW }));
    expect(line).toBe("shadow: 11/12 matched, 6wk");
  });

  it("insufficient → says it is accumulating, states the real count against the minimum", () => {
    const records = Array.from({ length: 3 }, (_, i) => shadowRecord({ at: daysAgo(i + 1) }));
    const line = formatShadowAgreementLine(shadowAgreementFromRecords(records, { now: NOW }));
    expect(line).toBe(`shadow evidence accumulating: 3/${SHADOW_MIN_PAIRS} pairs`);
  });
});
