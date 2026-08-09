/**
 * Tests for the vertical-aware Pax system-prompt builder.
 *
 * Coverage:
 *  1. Land-investing appendix surfaces land-investing terminology
 *  2. Null vertical falls back to land_investing
 *  3. mobile_homes (deepened in wave V4 of ruling #11) renders the
 *     production voice — no TODO markers, no scaffold-honesty flag
 *  4. Experience-level tone differs across beginner/intermediate/expert
 *  5. Goals framing composes multiple goals
 *  6. Empty goals returns a generic default
 *  7. Optional personalization (userDisplayName / geographicFocus) is honored
 */

import { describe, expect, it } from "vitest";

import {
  buildExperienceLevelTone,
  buildGoalsFraming,
  buildVerticalPromptAppendix,
} from "./verticalSystemPrompt";

describe("buildVerticalPromptAppendix", () => {
  it("for land_investing + expert + cash_flow, includes land terminology", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "land_investing",
      experienceLevel: "expert",
      investmentGoals: ["cash_flow"],
    });
    expect(out).toContain("Land Investor");
    // At least one of the canonical land-investing terms should surface.
    const landTerms = ["lot", "comps", "deeded access", "mineral rights", "Reg Z"];
    const hits = landTerms.filter((t) => out.includes(t));
    expect(hits.length).toBeGreaterThan(0);
    // Goal framing for cash_flow should be present.
    expect(out).toContain("monthly net cash flow");
  });

  it("falls back to land_investing default when vertical is null", () => {
    const out = buildVerticalPromptAppendix({
      vertical: null,
      experienceLevel: "intermediate",
      investmentGoals: [],
    });
    expect(out).toContain("Land Investing");
  });

  it("for mobile_homes (production since wave V4), renders the deepened voice without scaffold markers", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "mobile_homes",
      experienceLevel: "intermediate",
      investmentGoals: ["cash_flow"],
    });
    expect(out).toContain("Mobile Home");
    // Deepened in wave V4 of ruling #11: no TODO markers remain, and the
    // generic scaffold-honesty flag is replaced by the appendix's own
    // specific capability honesty.
    expect(out).not.toMatch(/\[TODO/);
    expect(out).not.toContain("Depth posture");
    // REWRITTEN, not deleted (2026-07-31, pad inventory). This line pinned
    // "no lot/pad inventory model" — true while nothing in the product ever
    // wrote `rental_units.kind = 'pad'`. The units surface, its bulk-create
    // route and the lease form's slot-kind picker now do, so the SAME
    // invariant (the rendered prompt carries the appendix's capability
    // honesty, in the operator's own words) is pinned to the new truth. The
    // two gaps that remain open are pinned right after it.
    expect(out).toContain("AcreOS models pad inventory");
    expect(out).not.toContain("no lot/pad inventory model");
    // REWRITTEN at the Wave 5 core flip (not deleted): the two lines below used
    // to pin "no chattel-title tracking" / "no utilities pass-through" — true
    // while the home side was unbuilt. Wave 5 built it (record-only chattel
    // fields; the submeter/RUBS billback engine), so the SAME invariant (the
    // rendered prompt carries the appendix's capability honesty in the operator's
    // own words) is pinned to the new truth: the voice states the home side is
    // real and refuses only the honest residuals (verification / comps / sale).
    const flat = out.replace(/\s+/g, " ");
    expect(flat).toMatch(/home-vs-lot rent split/i);
    expect(flat).toMatch(/utilities pass-through is billed/i);
    expect(flat).toMatch(/never imply title verification/i);
    expect(out).not.toContain("no chattel-title tracking");
  });

  it("defaults experienceLevel to intermediate when null", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "land_investing",
      experienceLevel: null,
      investmentGoals: [],
    });
    expect(out).toContain(buildExperienceLevelTone("intermediate"));
  });

  it("includes userDisplayName when provided", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "land_investing",
      experienceLevel: "intermediate",
      investmentGoals: [],
      userDisplayName: "Thomas",
    });
    expect(out).toContain("Thomas");
  });

  it("includes geographicFocus when provided", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "land_investing",
      experienceLevel: "intermediate",
      investmentGoals: [],
      geographicFocus: "East Texas",
    });
    expect(out).toContain("East Texas");
  });

  it("for production-ready vertical, omits the scaffolded-depth flag", () => {
    const out = buildVerticalPromptAppendix({
      vertical: "land_investing",
      experienceLevel: "intermediate",
      investmentGoals: [],
    });
    expect(out).not.toContain("Depth posture");
  });
});

describe("buildExperienceLevelTone", () => {
  it("returns distinct guidance for each level", () => {
    const beginner = buildExperienceLevelTone("beginner");
    const intermediate = buildExperienceLevelTone("intermediate");
    const expert = buildExperienceLevelTone("expert");
    expect(beginner).not.toEqual(intermediate);
    expect(intermediate).not.toEqual(expert);
    expect(beginner).not.toEqual(expert);
  });

  it("beginner mentions context / pitfalls", () => {
    expect(buildExperienceLevelTone("beginner")).toMatch(/context|pitfall/i);
  });

  it("expert mentions precision or second opinion", () => {
    expect(buildExperienceLevelTone("expert")).toMatch(/precision|second opinion/i);
  });
});

describe("buildGoalsFraming", () => {
  it("composes multiple goals", () => {
    const out = buildGoalsFraming(["cash_flow", "passive_income"]);
    expect(out).toContain("monthly net cash flow");
    expect(out).toContain("hands-off-ness");
  });

  it("returns a generic default for empty goals", () => {
    const out = buildGoalsFraming([]);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/objective|calibrating/i);
  });

  it("handles every individual goal value", () => {
    const allGoals = [
      "cash_flow",
      "appreciation",
      "passive_income",
      "value_add",
      "tax_advantages",
      "learning",
    ] as const;
    for (const g of allGoals) {
      const out = buildGoalsFraming([g]);
      expect(out.length).toBeGreaterThan(0);
      // Every goal framing should be at least a short sentence.
      expect(out).toContain("- ");
    }
  });
});
