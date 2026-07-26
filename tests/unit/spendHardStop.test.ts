/**
 * >$500 constitutional hard-stop lock.
 *
 * CLAUDE.md (and the founder's confirmation this session): "spends >$500 stay
 * founder-only forever." Only Tier 1 ($0–$500) may be granted autonomously;
 * every larger spend must route to the founder. This test pins that invariant
 * so the money gate can never silently drift back to autonomous $500–$50K
 * spends (the exact regression the deep audit found).
 */

import { describe, expect, it } from "vitest";
import { spendIsAutonomous } from "../../server/services/financialAuthorityGate";

describe(">$500 spending hard stop", () => {
  it("permits autonomous spend at or below the $500 Tier-1 ceiling", () => {
    expect(spendIsAutonomous(0)).toBe(true);
    expect(spendIsAutonomous(1_00)).toBe(true);     // $1
    expect(spendIsAutonomous(499_99)).toBe(true);   // $499.99 — still Tier 1
  });

  it("requires founder approval for anything over $500", () => {
    expect(spendIsAutonomous(500_00)).toBe(false);    // exactly $500 → Tier 2
    expect(spendIsAutonomous(501_00)).toBe(false);    // $501
    expect(spendIsAutonomous(2_500_00)).toBe(false);  // $2,500 (Tier 3 boundary)
    expect(spendIsAutonomous(10_000_00)).toBe(false); // $10,000 (Tier 4 boundary)
    expect(spendIsAutonomous(50_000_00)).toBe(false); // $50,000 (Tier 5 boundary)
    expect(spendIsAutonomous(500_000_00)).toBe(false);// $500,000 — beyond all tiers
  });
});
