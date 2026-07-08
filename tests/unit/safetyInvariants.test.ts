import { describe, it, expect } from "vitest";
import { makeSeededRng } from "../../server/services/autopilot/efficacy";
import { assessRisk, shouldEscalateForRisk, type RiskAssessment } from "../../server/services/autopilot/riskautonomy";
import { bindingFor, moveToPolicyAction } from "../../server/services/autopilot/act";
import { assertOutwardScope, orgScope, scopeOrgId, PLATFORM_SCOPE } from "../../server/services/autopilot/tenantScope";
import type { AutopilotDomain } from "../../server/services/autopilot/policyGate";

/**
 * Frontier #6 — invariants-by-CONSTRUCTION. The safety floor is encoded here as
 * UNIVERSALLY-QUANTIFIED properties checked over many generated inputs (a seeded,
 * dependency-free generator — no fast-check). The broadcast-laundering and
 * un-witnessed-money holes were FOUND, not foreseen; this institutionalizes
 * finding the next class — a property that holds for 1000 random inputs is a far
 * stronger claim than a handful of examples, and it fails the build the instant
 * a future change weakens an invariant. (A model-checked TLA+ spec of the gate
 * state machine + a generative adversarial red-team are the deeper #6 follow-ups.)
 */
const rng = makeSeededRng(20260624);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const TIERS = ["low", "medium", "high"] as const;
const mkAssessment = (): RiskAssessment => ({ tier: pick([...TIERS]), score: Math.floor(rng() * 8), reasons: [] });
const randKind = (): string => "move_" + Math.floor(rng() * 1e9).toString(36);

describe("safety-floor INVARIANTS (property-based)", () => {
  it("risk only TIGHTENS — lowering loopConfidence never REMOVES an escalation (monotone)", () => {
    for (let i = 0; i < 100; i++) {
      const a = mkAssessment();
      let c1 = rng();
      let c2 = rng();
      if (c1 > c2) [c1, c2] = [c2, c1]; // c1 ≤ c2
      // if it escalates at the HIGHER confidence, it must escalate at the lower one
      if (shouldEscalateForRisk(true, a, c2)) {
        expect(shouldEscalateForRisk(true, a, c1)).toBe(true);
      }
    }
  });

  it("escalation ALWAYS requires the domain gate to have passed (no false positives)", () => {
    for (let i = 0; i < 150; i++) {
      expect(shouldEscalateForRisk(false, mkAssessment(), rng())).toBe(false);
    }
  });

  it("an UNKNOWN move-kind is ALWAYS maximally risky (customer-facing + irreversible)", () => {
    for (let i = 0; i < 150; i++) {
      const b = bindingFor(randKind());
      expect(b.isCustomerFacing).toBe(true);
      expect(b.reversible).toBe(false);
    }
  });

  it("a NET-NEW move is ALWAYS forced witnessed (customer-facing), whatever its kind/domain", () => {
    const domains: AutopilotDomain[] = ["growth", "support", "deploy", "ops", "finance"];
    for (let i = 0; i < 150; i++) {
      const move = { priority: Math.floor(rng() * 6), domain: pick(domains), kind: randKind(), rationale: "x", isNetNew: true };
      expect(moveToPolicyAction(move).isCustomerFacing).toBe(true);
    }
  });

  it("assertOutwardScope HARD-ERRORS on any malformed scope — and NEVER on a well-formed one", () => {
    for (let i = 0; i < 150; i++) {
      const bad = pick([
        null,
        undefined,
        {},
        { kind: randKind() },
        { kind: "org", orgId: -Math.floor(rng() * 100) },
        { kind: "org", orgId: 0 },
        { kind: "org" },
        { kind: "org", orgId: 1.5 },
      ]);
      expect(() => assertOutwardScope(bad as never, "x")).toThrow();
    }
    expect(() => assertOutwardScope(PLATFORM_SCOPE, "x")).not.toThrow();
    for (let i = 0; i < 100; i++) {
      expect(() => assertOutwardScope(orgScope(1 + Math.floor(rng() * 1e6)), "x")).not.toThrow();
    }
  });

  it("assessRisk is MONOTONE — adding a risk factor never LOWERS the score", () => {
    for (let i = 0; i < 150; i++) {
      const base = { reversible: true, customerFacing: false, predictedCostUsd: rng() * 5, noveltyN: Math.floor(rng() * 20) };
      const s0 = assessRisk(base).score;
      expect(assessRisk({ ...base, reversible: false }).score).toBeGreaterThanOrEqual(s0);
      expect(assessRisk({ ...base, customerFacing: true }).score).toBeGreaterThanOrEqual(s0);
      expect(assessRisk({ ...base, predictedCostUsd: base.predictedCostUsd + 100 }).score).toBeGreaterThanOrEqual(s0);
    }
  });

  it("TenantScope round-trips — orgScope→scopeOrgId is identity; platform→null", () => {
    expect(scopeOrgId(PLATFORM_SCOPE)).toBeNull();
    for (let i = 0; i < 150; i++) {
      const n = 1 + Math.floor(rng() * 1e6);
      expect(scopeOrgId(orgScope(n))).toBe(n);
    }
  });
});
