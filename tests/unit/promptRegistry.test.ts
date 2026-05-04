/**
 * tests/unit/promptRegistry.test.ts — Phase 4 Week 21-22 (Nadia-AI §2.A).
 *
 * Tests the pure helpers in promptRegistry — pickWeighted distribution,
 * builtin fallback, and hash determinism. DB-backed paths are covered by
 * integration tests against a real Postgres.
 */

import { describe, it, expect } from "vitest";
import { __testOnly } from "../../server/services/promptRegistry";
import type { PromptVersion } from "../../server/services/promptRegistry";

const { computeHash, fromBuiltin, pickWeighted } = __testOnly;

function v(weight: number, version = "1.0.0", evalScore?: number): PromptVersion {
  return {
    promptName: "pax.executive",
    version,
    system: `system-${version}`,
    tier: "critical",
    hash: computeHash(`system-${version}`),
    createdAt: new Date(`2026-01-${(parseInt(version) || 1).toString().padStart(2, "0")}`),
    weight,
    active: true,
    isCandidate: false,
    evalScore,
  };
}

describe("promptRegistry.computeHash", () => {
  it("is deterministic", () => {
    expect(computeHash("hello")).toBe(computeHash("hello"));
  });
  it("changes when input changes", () => {
    expect(computeHash("a")).not.toBe(computeHash("b"));
  });
});

describe("promptRegistry.fromBuiltin", () => {
  it("returns a builtin for known names", () => {
    const b = fromBuiltin("pax.executive");
    expect(b?.version).toBe("3.0.0");
    expect(b?.weight).toBe(100);
  });

  it("returns null for unknown names", () => {
    expect(fromBuiltin("nope.does-not-exist")).toBeNull();
  });
});

describe("promptRegistry.pickWeighted", () => {
  it("returns the only version when only one is provided", () => {
    const picked = pickWeighted([v(100, "1.0.0")]);
    expect(picked.version).toBe("1.0.0");
  });

  it("respects the weight distribution over many trials", () => {
    const versions = [v(95, "1.0.0"), { ...v(5, "2.0.0"), isCandidate: true }];
    const counts = { "1.0.0": 0, "2.0.0": 0 };
    for (let i = 0; i < 5000; i++) {
      counts[pickWeighted(versions).version as keyof typeof counts]++;
    }
    // 5% candidate weight; allow generous bounds (1%..15%)
    expect(counts["2.0.0"] / 5000).toBeGreaterThan(0.01);
    expect(counts["2.0.0"] / 5000).toBeLessThan(0.15);
  });

  it("falls back to highest evalScore when total weight is 0", () => {
    const versions = [v(0, "1.0.0", 0.6), v(0, "2.0.0", 0.9), v(0, "3.0.0", 0.4)];
    const picked = pickWeighted(versions);
    expect(picked.version).toBe("2.0.0");
  });
});
