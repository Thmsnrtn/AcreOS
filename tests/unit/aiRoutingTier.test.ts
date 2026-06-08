/**
 * Wave 8 — AI routing tier tests.
 *
 * Verifies:
 *   1. The TaskTier → model map is exactly what we promised the founder
 *      (critical=Sonnet, standard=Haiku, background=Haiku).
 *   2. The AI_HAIKU_DEFAULT_ENABLED kill-switch flips every tier to Sonnet.
 *   3. modelForTier() reflects env-var changes within the same process.
 *   4. Every named callsite passes a tier explicitly (no defaults).
 *   5. applyEvalQualityGate honors the 0.95 ratio threshold.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  modelForTier,
  getTierToModelMap,
  applyEvalQualityGate,
  MODEL_COMPLEX,
  MODEL_MODERATE,
  type TaskTier,
} from "../../server/services/aiRouter";

const ENV_KEY = "AI_HAIKU_DEFAULT_ENABLED";

describe("AI Routing — TaskTier", () => {
  const originalFlag = process.env[ENV_KEY];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalFlag;
  });

  it("maps each tier to the documented model when flag is enabled", () => {
    process.env[ENV_KEY] = "true";
    expect(modelForTier("critical")).toBe(MODEL_COMPLEX);   // Sonnet 4.6
    expect(modelForTier("standard")).toBe(MODEL_MODERATE);  // Haiku 4.5
    expect(modelForTier("background")).toBe(MODEL_MODERATE); // Haiku 4.5
  });

  it("getTierToModelMap returns the same triple", () => {
    process.env[ENV_KEY] = "true";
    expect(getTierToModelMap()).toEqual({
      critical: MODEL_COMPLEX,
      standard: MODEL_MODERATE,
      background: MODEL_MODERATE,
    });
  });

  it("flips every tier to Sonnet when AI_HAIKU_DEFAULT_ENABLED=false", () => {
    process.env[ENV_KEY] = "false";
    expect(modelForTier("critical")).toBe(MODEL_COMPLEX);
    expect(modelForTier("standard")).toBe(MODEL_COMPLEX);
    expect(modelForTier("background")).toBe(MODEL_COMPLEX);
  });

  it("treats '0' / 'off' / 'no' as disable", () => {
    for (const v of ["0", "off", "no", "OFF", "FALSE"]) {
      process.env[ENV_KEY] = v;
      expect(modelForTier("standard")).toBe(MODEL_COMPLEX);
    }
  });

  it("defaults to enabled when env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(modelForTier("standard")).toBe(MODEL_MODERATE);
  });

  it("tier triple covers all three values", () => {
    const tiers: TaskTier[] = ["critical", "standard", "background"];
    for (const t of tiers) expect(modelForTier(t)).toMatch(/^anthropic\//);
  });
});

describe("AI Routing — eval quality gate", () => {
  it("does NOT roll back when ratio >= 0.95", async () => {
    const result = await applyEvalQualityGate({
      taskType: "test_no_regression",
      originalTier: "standard",
      newTier: "background",
      previousScore: 0.90,
      newScore: 0.88, // ratio ≈ 0.978
    });
    expect(result.rolledBack).toBe(false);
    expect(result.ratio).toBeGreaterThanOrEqual(0.95);
  });

  it("returns no-baseline when previousScore is 0", async () => {
    const result = await applyEvalQualityGate({
      taskType: "test_no_baseline",
      originalTier: "standard",
      newTier: "background",
      previousScore: 0,
      newScore: 0.5,
    });
    expect(result.rolledBack).toBe(false);
    expect(result.reason).toMatch(/baseline/i);
  });
});

describe("AI Routing — every named callsite passes a tier explicitly", () => {
  // We assert on source text rather than runtime behavior because routeAITask
  // needs an actual API key + DB to invoke. The discipline we want enforced:
  // every callsite the brief named MUST mention `taskTier:` somewhere in the
  // same call. If a future edit drops the tier, this test fails loudly.
  const repoRoot = join(__dirname, "../..");

  const callsites: Array<{ file: string; expectedTier: TaskTier; context: string }> = [
    { file: "server/services/leadQualification.ts", expectedTier: "background", context: "lead_qualification" },
    { file: "server/services/leadQualification.ts", expectedTier: "standard",  context: "lead-nurturer follow-up" },
    { file: "server/services/buyerQualificationBot.ts", expectedTier: "standard", context: "buyer-qualification" },
    { file: "server/services/taxOptimizer.ts", expectedTier: "standard", context: "tax-optimizer planning" },
    { file: "server/services/writingStyle.ts", expectedTier: "standard", context: "writing-style" },
    // routes-academy.ts (academy_tutor) retired 2026-06-08 — Academy module removed.
    { file: "server/routes-ai-draft.ts", expectedTier: "critical", context: "Pax inbox draft" },
    { file: "server/routes-founder-intelligence.ts", expectedTier: "background", context: "agent_routing" },
    { file: "server/routes-founder-intelligence.ts", expectedTier: "standard",  context: "agent_chat" },
  ];

  for (const c of callsites) {
    it(`${c.file} (${c.context}) → ${c.expectedTier}`, () => {
      const src = readFileSync(join(repoRoot, c.file), "utf8");
      const pattern = new RegExp(`taskTier:\\s*['"]${c.expectedTier}['"]`);
      expect(src).toMatch(pattern);
    });
  }
});
