/**
 * Fail-closed AI cost ceiling default tests (2026-06-08 — Lena).
 *
 * The platform-wide AI cost ceiling (server/services/aiCostCeiling.ts) is the
 * only gate in the stack that throws on a known threshold breach; the soft
 * gates (intelligence/budget.ts $10/day per-category, aiQuotaService $50/day
 * per-org) FAIL OPEN on DB error. Pre-fix the platform ceiling defaulted to
 * $5/day — 100× below the soft gates — so it was effectively decorative while
 * the generous gates disabled themselves under load.
 *
 * These tests lock in:
 *   1. The default is now $15/day (1500 cents), sitting just ABOVE the summed
 *      soft budgets so it is the binding master limit when soft gates fail open.
 *   2. It BLOCKS (throws) at the new higher default once platform 24h spend is
 *      at/over $15.
 *   3. Spend between the old $5 floor and the new $15 ceiling is now ALLOWED
 *      (i.e. the ceiling is no longer decorative-low).
 *   4. AI_PLATFORM_DAILY_CEILING_CENTS still overrides the default.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the DB layer ──────────────────────────────────────────────────────
// assertWithinPlatformCostCeiling → sumPlatformCostCentsSince uses
// db.select().from().where() → [{ sum }]
const mockWhere = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockWhere(...args),
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  aiCostCeilingOverrides: { organizationId: "organizationId" },
  aiTelemetryEvents: {
    estimatedCostCents: "estimated_cost_cents",
    organizationId: "organization_id",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ and: a }),
  eq: (c: any, v: any) => ({ eq: [c, v] }),
  gte: (c: any, v: any) => ({ gte: [c, v] }),
  sql: (strings: TemplateStringsArray, ...vals: any[]) => ({ sql: strings, vals }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────
import {
  assertWithinAiCostCeiling,
  AiCostCeilingExceededError,
} from "../../server/services/aiCostCeiling";

/** Platform 24h telemetry sum, in cents. */
function platformSpendCents(cents: number) {
  mockWhere.mockResolvedValue([{ sum: String(cents) }]);
}

const ORIG_ENV = { ...process.env };

describe("aiCostCeiling — fail-closed platform default raised to $15/day", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
    delete process.env.AI_COST_CEILING_BYPASS;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("ALLOWS platform spend between the old $5 floor and the new $15 ceiling", async () => {
    // $10 in 24h: would have tripped the old $5 default; now under $15.
    platformSpendCents(1000);
    // orgId null → only the platform gate runs (no per-org check).
    await expect(assertWithinAiCostCeiling(null)).resolves.toBeUndefined();
  });

  it("BLOCKS (throws) at the new $15/day ceiling", async () => {
    platformSpendCents(1500); // == $15 ceiling
    await expect(assertWithinAiCostCeiling(null)).rejects.toBeInstanceOf(
      AiCostCeilingExceededError,
    );
  });

  it("BLOCKS above $15/day", async () => {
    platformSpendCents(2000); // $20
    await expect(assertWithinAiCostCeiling(null)).rejects.toBeInstanceOf(
      AiCostCeilingExceededError,
    );
  });

  it("the hard ceiling is the binding limit when soft gates are out of the picture", async () => {
    // The autonomous-executor path reaches the platform ceiling with orgId
    // null (platform-internal). At $15 the call is refused — the master limit
    // holds even when the $10 category + $50 org soft gates fail open.
    platformSpendCents(1500);
    await expect(assertWithinAiCostCeiling(null)).rejects.toMatchObject({
      code: "AI_COST_CEILING_EXCEEDED",
      windowKey: "daily",
      ceilingCents: 1500,
    });
  });

  it("respects AI_PLATFORM_DAILY_CEILING_CENTS override", async () => {
    process.env.AI_PLATFORM_DAILY_CEILING_CENTS = "3000"; // $30
    platformSpendCents(2000); // $20 — under the override
    await expect(assertWithinAiCostCeiling(null)).resolves.toBeUndefined();
    platformSpendCents(3000); // == override
    await expect(assertWithinAiCostCeiling(null)).rejects.toBeInstanceOf(
      AiCostCeilingExceededError,
    );
  });
});
