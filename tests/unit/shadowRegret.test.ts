import { describe, it, expect } from "vitest";
import {
  prospectiveRegret,
  retrospectiveRegret,
  summarizeShadowRegret,
  type ShadowRegret,
  type CandidateValuation,
} from "../../server/services/autopilot/shadowRegret";

/**
 * Frontier #2 — shadow regret (off-policy decision quality). These tests pin
 * BOTH the math (regret is non-negative, picks the best unchosen road) AND the
 * sacred invariant: the output is structurally a glass-box estimate that can
 * never be coerced into the reward edge.
 */

const v = (kind: string, value: number): CandidateValuation => ({ kind, value });

describe("prospectiveRegret — decision-time, model-predicted", () => {
  it("is 0 when the chosen move is the model's top pick", () => {
    const r = prospectiveRegret(v("grow", 9), [v("grow", 9), v("support", 4), v("ops", 1)]);
    expect(r.regret).toBe(0);
    expect(r.bestAlternativeKind).toBe("support"); // best OTHER option, even at regret 0
    expect(r.isEstimate).toBe(true);
    expect(r.basis).toBe("prospective");
  });

  it("is the gap to the best unchosen option when a higher-EV road was deprioritised", () => {
    const r = prospectiveRegret(v("incident", 2), [v("incident", 2), v("grow", 7), v("support", 5)]);
    expect(r.bestAlternativeKind).toBe("grow");
    expect(r.bestAlternativeValue).toBe(7);
    expect(r.regret).toBe(5); // 7 - 2 (e.g. urgency forced the lower-EV incident move)
  });

  it("never counts the chosen move as its own alternative (even if duplicated)", () => {
    const r = prospectiveRegret(v("grow", 3), [v("grow", 3), v("grow", 9)]);
    // both alternatives share the chosen kind → no distinct other road
    expect(r.bestAlternativeKind).toBeNull();
    expect(r.regret).toBe(0);
  });

  it("ignores un-valued alternatives (no honest estimate → not a comparison target)", () => {
    const r = prospectiveRegret(v("a", 1), [v("a", 1), v("b", NaN), v("c", 4)]);
    expect(r.bestAlternativeKind).toBe("c");
    expect(r.regret).toBe(3);
  });

  it("regret is ALWAYS ≥ 0 over random inputs (monotone floor)", () => {
    for (let i = 0; i < 200; i++) {
      const cv = (i * 7) % 13;
      const alts = [v("x", (i * 3) % 11), v("y", (i * 5) % 9), v("chosen", cv)];
      const r = prospectiveRegret(v("chosen", cv), alts);
      expect(r.regret).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("retrospectiveRegret — post-outcome, realized vs predicted", () => {
  it("compares the chosen move's REALIZED value to the best alternative's predicted", () => {
    const r = retrospectiveRegret("grow", 3, [v("grow", 8 /* ignored: same kind */), v("support", 6)]);
    expect(r.basis).toBe("retrospective");
    expect(r.chosenValue).toBe(3); // realized
    expect(r.bestAlternativeKind).toBe("support");
    expect(r.regret).toBe(3); // 6 (predicted) - 3 (realized)
    expect(r.isEstimate).toBe(true); // the alternative was never run
  });

  it("is 0 when the realized outcome beat every predicted alternative", () => {
    const r = retrospectiveRegret("grow", 20, [v("support", 6), v("ops", 9)]);
    expect(r.regret).toBe(0);
  });
});

describe("summarizeShadowRegret — aggregate for the daily letter", () => {
  it("sums regret and ranks the most systematically-deprioritised kinds", () => {
    const regrets: ShadowRegret[] = [
      prospectiveRegret(v("incident", 1), [v("incident", 1), v("grow", 6)]), // regret 5 on incident
      prospectiveRegret(v("incident", 2), [v("incident", 2), v("grow", 5)]), // regret 3 on incident
      prospectiveRegret(v("support", 4), [v("support", 4), v("grow", 5)]), // regret 1 on support
    ];
    const s = summarizeShadowRegret(regrets);
    expect(s.episodes).toBe(3);
    expect(s.totalRegret).toBe(9);
    expect(s.meanRegret).toBe(3);
    expect(s.topRegretfulKinds[0]).toEqual({ kind: "incident", totalRegret: 8, episodes: 2 });
  });

  it("is total on the empty set", () => {
    const s = summarizeShadowRegret([]);
    expect(s).toEqual({ episodes: 0, meanRegret: 0, totalRegret: 0, topRegretfulKinds: [] });
  });
});

describe("THE SACRED LINE — shadow regret can never feed the reward edge", () => {
  it("every reading is flagged isEstimate:true (a not-taken road is never observed)", () => {
    const all = [
      prospectiveRegret(v("a", 1), [v("b", 2)]),
      retrospectiveRegret("a", 1, [v("b", 2)]),
    ];
    for (const r of all) expect(r.isEstimate).toBe(true);
  });

  it("a ShadowRegret has NO successes/failures field — it is type-incompatible with PlayStats", () => {
    const r = prospectiveRegret(v("a", 1), [v("b", 2)]);
    // The reward edge (efficacy.scorePlays) consumes {playId, successes, failures}.
    // A regret reading exposes none of them — so it cannot be passed there, by
    // construction, not by convention.
    expect("successes" in r).toBe(false);
    expect("failures" in r).toBe(false);
    expect(Object.keys(r).sort()).toEqual(
      ["basis", "bestAlternativeKind", "bestAlternativeValue", "chosenKind", "chosenValue", "isEstimate", "regret"].sort(),
    );
  });

  it("shadowRegret.ts imports nothing from the learning/reward path (static guarantee)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../../server/services/autopilot/shadowRegret.ts", import.meta.url),
      "utf8",
    );
    // No import of experienceLog (the outcome ledger) or efficacy (the sampler).
    expect(src).not.toMatch(/from\s+["'].*experienceLog/);
    expect(src).not.toMatch(/from\s+["'].*efficacy/);
    expect(src).not.toMatch(/\bimport\b/); // pure module — zero imports at all
  });
});
