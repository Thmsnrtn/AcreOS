import { describe, it, expect } from "vitest";
import { contextualForecast, buildRecalibrationMap, applyRecalibration } from "../../server/services/autopilot/contextualForecast";
import { ladderAction, REPAGE_HOURS, AUTO_RESOLVE_HOURS } from "../../server/services/autopilot/escalationLadder";
import { budgetGate, allocateByRoi, shouldRampBudget } from "../../server/services/autopilot/economics";
import type { CalibrationPair } from "../../server/services/autopilot/forecast";

describe("T2 — contextual forecast (P(success | situation, action))", () => {
  it("falls back to the GLOBAL rate when there's little local evidence", () => {
    const r = contextualForecast({ successes: 8, failures: 2 }, { successes: 0, failures: 0 });
    expect(r.localWeight).toBe(0);
    expect(r.prob).toBeCloseTo(9 / 12, 5); // global only
  });

  it("trusts the LOCAL (similar-situation) rate as it accumulates", () => {
    // global says ~50/50, but in similar situations it's failed a lot
    const r = contextualForecast({ successes: 10, failures: 10 }, { successes: 1, failures: 19 });
    expect(r.localWeight).toBeGreaterThan(0.7);
    expect(r.prob).toBeLessThan(0.3); // pulled toward the local failure rate
  });

  it("recalibration corrects systematic over-confidence from REAL history; sparse bands pass through", () => {
    // 0.9-band predictions only come true ~50% of the time → recalibrate down
    const pairs: CalibrationPair[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ predicted: 0.9, actual: (i % 2) as 0 | 1 })),
    ];
    const map = buildRecalibrationMap(pairs, 5, 8);
    expect(applyRecalibration(0.9, map)).toBeCloseTo(0.5, 1); // corrected toward reality
    // a band with no data passes the raw value through unchanged
    expect(applyRecalibration(0.1, map)).toBeCloseTo(0.1, 5);
  });
});

describe("T3 — escalation ladder (absence fails safe)", () => {
  it("waits before the re-page window, then re-pages", () => {
    expect(ladderAction({ urgency: "urgent", ageHours: 1, kind: "decision" }).step).toBe("wait");
    expect(ladderAction({ urgency: "urgent", ageHours: REPAGE_HOURS.urgent + 1, kind: "decision" }).step).toBe("repage");
  });

  it("a DECISION times out to DECLINED (safe side) — never deadlocks, never auto-acts", () => {
    const a = ladderAction({ urgency: "urgent", ageHours: AUTO_RESOLVE_HOURS.urgent + 1, kind: "decision" });
    expect(a.step).toBe("auto_resolve_safe");
    if (a.step === "auto_resolve_safe") expect(a.resolution).toBe("declined");
  });

  it("a DRAFT/PROPOSAL never auto-resolves — an unsent draft is harmless, it just waits/re-pages", () => {
    expect(ladderAction({ urgency: "low", ageHours: AUTO_RESOLVE_HOURS.low + 100, kind: "draft_review" }).step).toBe("repage");
    expect(ladderAction({ urgency: "normal", ageHours: AUTO_RESOLVE_HOURS.normal + 100, kind: "proposal" }).step).toBe("repage");
  });
});

describe("T4 — full-funnel economics", () => {
  it("budgetGate protects the essential reserve from discretionary spend", () => {
    const state = { monthlyCapUsd: 50, spentThisMonthUsd: 35, essentialReservePct: 0.2 };
    // $15 remaining, $10 reserved → $5 discretionary
    expect(budgetGate(state, 4, {}).allowed).toBe(true);
    expect(budgetGate(state, 9, {}).allowed).toBe(false);
    // a non-deferrable (essential) action may use the reserve
    expect(budgetGate(state, 9, { deferrable: false }).allowed).toBe(true);
  });

  it("allocateByRoi ranks by expected value per dollar; unproven gets the prior, never zero", () => {
    const ranked = allocateByRoi([
      { id: "cheap-proven", costUsd: 1, successes: 18, failures: 2 },
      { id: "pricey-proven", costUsd: 20, successes: 18, failures: 2 },
      { id: "unproven", costUsd: 1, successes: 0, failures: 0 },
    ]);
    expect(ranked[0].id).toBe("cheap-proven");
    expect(ranked.find((r) => r.id === "unproven")!.successProb).toBe(0.5); // prior, explorable
  });

  it("shouldRampBudget only ramps on proven, healthy CAC", () => {
    expect(shouldRampBudget({ attributedSignups: 2, spendUsd: 40 }).ramp).toBe(false); // too little data
    expect(shouldRampBudget({ attributedSignups: 10, spendUsd: 800, targetCacUsd: 50 }).ramp).toBe(false); // $80 CAC > $50 target
    expect(shouldRampBudget({ attributedSignups: 10, spendUsd: 300, targetCacUsd: 50 }).ramp).toBe(true); // $30 CAC ≤ $50 target
  });
});
