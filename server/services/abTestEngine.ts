/**
 * T22 — A/B Testing Infrastructure for AI Outreach
 *
 * Assigns leads to test variants when sending outreach messages.
 * Tracks open rates, response rates, and conversion by variant.
 * Results feed back into Sophie Learning for continuous improvement.
 *
 * How it works:
 *   1. When sending a campaign message, call getVariant(test, leadId)
 *   2. Send the corresponding template for that variant
 *   3. When lead responds or converts, record the outcome
 *   4. Call getResults(test) for performance comparison
 *
 * Allocation: deterministic hashing (lead ID → variant) so each lead
 * always gets the same variant on retry — no double-sending both variants.
 *
 * DB-BACKED (Wave A "Nothing lies", founder ruling #12(c), 2026-07-29):
 * tests lived in a module-level Map and outcomes in a module-level array —
 * per-process, so on 2+ machines significance/conversion stats computed on a
 * fraction of the data and everything reset on deploy (variant ASSIGNMENT
 * was always deterministic and stayed correct). Tests now live in
 * `outreach_ab_tests`, outcome events in `outreach_ab_outcomes`, and results
 * are aggregated in SQL over ALL machines' data (deletion-ledger pin
 * "Module-state residue", audit 2026-07-07).
 *
 * Storage is injectable so tests can prove state survives service
 * re-instantiation without a database; the default storage is Drizzle.
 */

import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { outreachAbTests, outreachAbOutcomes } from "@shared/schema";
import { logger } from "../utils/logger";
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

/** One `(variantId, event)` bucket with its count, aggregated in SQL. */
export interface AbOutcomeTally {
  variantId: string;
  event: string;
  count: number;
}

/**
 * Persistence seam. The DB is the source of truth — no test or outcome may
 * live only in process memory.
 */
export interface AbTestStorage {
  /** Insert or overwrite a test (Map.set semantics, org-guarded by caller). */
  upsertTest(test: AbTest): Promise<AbTest>;
  /** Fetch one test; when `orgId` is given the lookup is org-scoped. */
  getTest(testId: string, orgId?: number): Promise<AbTest | undefined>;
  /** All tests belonging to an org. */
  listTests(orgId: number): Promise<AbTest[]>;
  /** Append one outcome event. */
  insertOutcome(outcome: AbOutcome): Promise<void>;
  /** GROUP BY (variant, event) counts for a test — computed in SQL. */
  aggregateOutcomes(testId: string): Promise<AbOutcomeTally[]>;
}

// ─── Default Drizzle-backed storage ───────────────────────────────────────────

type TestRow = typeof outreachAbTests.$inferSelect;

function rowToTest(row: TestRow): AbTest {
  return {
    id: row.id,
    name: row.name,
    orgId: row.organizationId,
    variants: (row.variants ?? []) as AbVariant[],
    metric: row.metric as AbTest["metric"],
    startedAt: row.startedAt,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    status: row.status as AbTest["status"],
    ...(row.winnerId ? { winnerId: row.winnerId } : {}),
  };
}

export const drizzleAbTestStorage: AbTestStorage = {
  async upsertTest(test) {
    const values = {
      id: test.id,
      organizationId: test.orgId,
      name: test.name,
      variants: test.variants,
      metric: test.metric,
      status: test.status,
      winnerId: test.winnerId ?? null,
      startedAt: test.startedAt,
      endedAt: test.endedAt ?? null,
    };
    const [row] = await db
      .insert(outreachAbTests)
      .values(values)
      .onConflictDoUpdate({
        target: outreachAbTests.id,
        set: {
          name: values.name,
          variants: values.variants,
          metric: values.metric,
          status: values.status,
          winnerId: values.winnerId,
          startedAt: values.startedAt,
          endedAt: values.endedAt,
        },
      })
      .returning();
    return rowToTest(row);
  },

  async getTest(testId, orgId) {
    const where =
      orgId === undefined
        ? eq(outreachAbTests.id, testId)
        : and(eq(outreachAbTests.id, testId), eq(outreachAbTests.organizationId, orgId));
    const [row] = await db.select().from(outreachAbTests).where(where).limit(1);
    return row ? rowToTest(row) : undefined;
  },

  async listTests(orgId) {
    const rows = await db
      .select()
      .from(outreachAbTests)
      .where(eq(outreachAbTests.organizationId, orgId))
      .orderBy(outreachAbTests.startedAt);
    return rows.map(rowToTest);
  },

  async insertOutcome(outcome) {
    await db.insert(outreachAbOutcomes).values({
      testId: outcome.testId,
      variantId: outcome.variantId,
      leadId: outcome.leadId,
      event: outcome.event,
      occurredAt: outcome.timestamp,
    });
  },

  async aggregateOutcomes(testId) {
    const rows = await db
      .select({
        variantId: outreachAbOutcomes.variantId,
        event: outreachAbOutcomes.event,
        count: sql<number>`count(*)::int`,
      })
      .from(outreachAbOutcomes)
      .where(eq(outreachAbOutcomes.testId, testId))
      .groupBy(outreachAbOutcomes.variantId, outreachAbOutcomes.event);
    return rows.map((r) => ({
      variantId: r.variantId,
      event: r.event,
      count: Number(r.count ?? 0),
    }));
  },
};

// ─── Deterministic variant assignment ─────────────────────────────────────────

/**
 * Assign a lead to a test variant deterministically.
 * Same lead will always get the same variant for a given test.
 *
 * Pure — no persistence involved, so it stays synchronous.
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

/** Turn SQL tallies into the per-variant stats block. Pure. */
function tallyLookup(tallies: AbOutcomeTally[]): (variantId: string, event: string) => number {
  const byKey = new Map<string, number>();
  for (const t of tallies) {
    const key = `${t.variantId} ${t.event}`;
    byKey.set(key, (byKey.get(key) ?? 0) + t.count);
  }
  return (variantId, event) => byKey.get(`${variantId} ${event}`) ?? 0;
}

/** Compute results from a test definition + its SQL-aggregated tallies. Pure. */
export function computeResults(test: AbTest, tallies: AbOutcomeTally[]): AbResults {
  const MIN_SAMPLE = 50;
  const at = tallyLookup(tallies);

  const variantStats = test.variants.map((v) => {
    const sent = at(v.id, "sent");
    const opened = at(v.id, "opened");
    const replied = at(v.id, "replied");
    const converted = at(v.id, "converted");

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

// ─── Engine ───────────────────────────────────────────────────────────────────

export class AbTestEngine {
  private readonly storage: AbTestStorage;

  constructor(storage: AbTestStorage = drizzleAbTestStorage) {
    this.storage = storage;
  }

  /**
   * Register a test. Ids are caller-supplied; re-creating an id owned by the
   * same org overwrites it (the historical Map.set semantics). An id owned by
   * a DIFFERENT org is refused — ids are global, orgs are not.
   */
  async createTest(test: Omit<AbTest, "startedAt" | "status">): Promise<AbTest> {
    const existing = await this.storage.getTest(test.id);
    if (existing && existing.orgId !== test.orgId) {
      throw new Error(`A/B test id "${test.id}" is already in use`);
    }
    const fullTest: AbTest = {
      ...test,
      startedAt: new Date(),
      status: "active",
    };
    const saved = await this.storage.upsertTest(fullTest);
    logger.info("ab_test.created", { testId: saved.id, orgId: saved.orgId, variants: saved.variants.length });
    return saved;
  }

  /** Fetch a test. Pass `orgId` to scope the lookup to one org. */
  async getTest(testId: string, orgId?: number): Promise<AbTest | undefined> {
    return this.storage.getTest(testId, orgId);
  }

  async listTests(orgId: number): Promise<AbTest[]> {
    return this.storage.listTests(orgId);
  }

  /** Append one outcome event. Durable — survives restart. */
  async recordOutcome(outcome: AbOutcome): Promise<void> {
    await this.storage.insertOutcome(outcome);
  }

  /** Results aggregated in SQL across every process that wrote outcomes. */
  async getResults(test: AbTest): Promise<AbResults> {
    const tallies = await this.storage.aggregateOutcomes(test.id);
    return computeResults(test, tallies);
  }
}

/** Default engine — Drizzle-backed. */
export const abTestEngine = new AbTestEngine();

// ─── Module-level API (unchanged call shape; now async) ───────────────────────

export const createTest = (test: Omit<AbTest, "startedAt" | "status">): Promise<AbTest> =>
  abTestEngine.createTest(test);

export const getTest = (testId: string, orgId?: number): Promise<AbTest | undefined> =>
  abTestEngine.getTest(testId, orgId);

export const listTests = (orgId: number): Promise<AbTest[]> => abTestEngine.listTests(orgId);

export const recordOutcome = (outcome: AbOutcome): Promise<void> =>
  abTestEngine.recordOutcome(outcome);

export const getResults = (test: AbTest): Promise<AbResults> => abTestEngine.getResults(test);
