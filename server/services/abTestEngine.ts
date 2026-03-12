/**
 * T22 — A/B Testing Infrastructure for AI Outreach
 *
 * Assigns leads to test variants when sending outreach messages.
 * Tracks open rates, response rates, and conversion by variant.
 * Results feed back into Sophie Learning for continuous improvement.
 *
 * How it works:
 *   1. When sending a campaign message, call getVariant(testId, leadId)
 *   2. Send the corresponding template for that variant
 *   3. When lead responds or converts, record the outcome
 *   4. Call getResults(testId) for performance comparison
 *
 * Allocation: deterministic hashing (lead ID → variant) so each lead
 * always gets the same variant on retry — no double-sending both variants.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AbTest {
  id: string;
  name: string;
  orgId: number;
  variants: AbVariant[];
  metric: "open_rate" | "response_rate" | "conversion_rate";
  startedAt: Date;
  endedAt?: Date;
  status: "active" | "paused" | "completed";
  winnerId?: string;
}

export interface AbVariant {
  id: string;
  name: string;
  description: string;
  weight: number; // 0-100, weights should sum to 100
  templateId?: string;
  aiGenerated?: boolean;
}

export interface AbOutcome {
  testId: string;
  variantId: string;
  leadId: number;
  event: "sent" | "opened" | "replied" | "converted" | "unsubscribed";
  timestamp: Date;
}

export interface AbResults {
  testId: string;
  variants: Array<{
    id: string;
    name: string;
    sent: number;
    opened: number;
    replied: number;
    converted: number;
    openRate: number;
    replyRate: number;
    conversionRate: number;
    isWinner: boolean;
    confidenceVsControl: number; // 0-1
  }>;
  totalSent: number;
  winnerDeclared: boolean;
  minSampleSize: number;
  hasSignificantResult: boolean;
}

// ─── In-memory test registry (should persist to DB in production) ─────────────

const activeTests = new Map<string, AbTest>();
const outcomes: AbOutcome[] = [];

// ─── Deterministic variant assignment ─────────────────────────────────────────

/**
 * Assign a lead to a test variant deterministically.
 * Same lead will always get the same variant for a given test.
 */
export function getVariant(test: AbTest, leadId: number): AbVariant {
  // Create a deterministic hash from testId + leadId
  const hash = crypto
    .createHash("sha256")
    .update(`${test.id}:${leadId}`)
    .digest();

  // Convert to 0-99 bucket
  const bucket = hash[0] % 100;

  // Assign based on cumulative weights
  let cumulative = 0;
  for (const variant of test.variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant;
  }

  return test.variants[test.variants.length - 1];
}

// ─── Outcome recording ────────────────────────────────────────────────────────

export function recordOutcome(outcome: AbOutcome): void {
  outcomes.push(outcome);
  // In production, persist to DB:
  // db.insert(abTestOutcomes).values(outcome).catch(console.error);
}

// ─── Statistical significance ─────────────────────────────────────────────────

/**
 * Calculate a simple Z-test p-value for two proportions.
 * Returns confidence level (0-1). 0.95 = 95% confidence.
 */
function calculateConfidence(
  controlConversions: number,
  controlTotal: number,
  variantConversions: number,
  variantTotal: number
): number {
  if (controlTotal === 0 || variantTotal === 0) return 0;

  const p1 = controlConversions / controlTotal;
  const p2 = variantConversions / variantTotal;
  const p = (controlConversions + variantConversions) / (controlTotal + variantTotal);

  if (p === 0 || p === 1) return 0;

  const se = Math.sqrt(p * (1 - p) * (1 / controlTotal + 1 / variantTotal));
  if (se === 0) return 0;

  const z = Math.abs(p1 - p2) / se;

  // Convert Z to approximate confidence using normal distribution
  // p-values from Z: 1.645→0.90, 1.96→0.95, 2.576→0.99
  if (z >= 2.576) return 0.99;
  if (z >= 1.96) return 0.95;
  if (z >= 1.645) return 0.90;
  if (z >= 1.282) return 0.80;
  return Math.min(0.79, z / 1.282 * 0.80);
}

// ─── Results calculation ──────────────────────────────────────────────────────

export function getResults(test: AbTest): AbResults {
  const MIN_SAMPLE = 50;
  const testOutcomes = outcomes.filter((o) => o.testId === test.id);

  const variantStats = test.variants.map((v) => {
    const vOutcomes = testOutcomes.filter((o) => o.variantId === v.id);
    const sent = vOutcomes.filter((o) => o.event === "sent").length;
    const opened = vOutcomes.filter((o) => o.event === "opened").length;
    const replied = vOutcomes.filter((o) => o.event === "replied").length;
    const converted = vOutcomes.filter((o) => o.event === "converted").length;

    return {
      id: v.id,
      name: v.name,
      sent,
      opened,
      replied,
      converted,
      openRate: sent > 0 ? opened / sent : 0,
      replyRate: sent > 0 ? replied / sent : 0,
      conversionRate: sent > 0 ? converted / sent : 0,
      isWinner: false,
      confidenceVsControl: 0,
    };
  });

  // Determine winner
  const control = variantStats[0];
  let winnerIdx = 0;
  let maxRate = control?.conversionRate ?? 0;

  for (let i = 1; i < variantStats.length; i++) {
    const v = variantStats[i];
    if (control) {
      v.confidenceVsControl = calculateConfidence(
        control.converted,
        control.sent,
        v.converted,
        v.sent
      );
    }
    if (v.conversionRate > maxRate && v.confidenceVsControl >= 0.95) {
      maxRate = v.conversionRate;
      winnerIdx = i;
    }
  }

  const totalSent = variantStats.reduce((s, v) => s + v.sent, 0);
  const hasSignificantResult =
    totalSent >= MIN_SAMPLE &&
    variantStats.some((v) => v.confidenceVsControl >= 0.95);

  if (hasSignificantResult) {
    variantStats[winnerIdx].isWinner = true;
  }

  return {
    testId: test.id,
    variants: variantStats,
    totalSent,
    winnerDeclared: hasSignificantResult,
    minSampleSize: MIN_SAMPLE,
    hasSignificantResult,
  };
}

// ─── Test management ──────────────────────────────────────────────────────────

export function createTest(test: Omit<AbTest, "startedAt" | "status">): AbTest {
  const fullTest: AbTest = {
    ...test,
    startedAt: new Date(),
    status: "active",
  };
  activeTests.set(test.id, fullTest);
  return fullTest;
}

export function getTest(testId: string): AbTest | undefined {
  return activeTests.get(testId);
}

export function listTests(orgId: number): AbTest[] {
  return Array.from(activeTests.values()).filter((t) => t.orgId === orgId);
}
