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
    // specific capability honesty (no pad inventory / chattel titles /
    // submetering promised).
    expect(out).not.toMatch(/\[TODO/);
    expect(out).not.toContain("Depth posture");
    expect(out).toContain("no lot/pad inventory model");
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
