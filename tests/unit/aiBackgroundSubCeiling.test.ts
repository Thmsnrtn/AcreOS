/**
 * P1-5 / I-5 R1 — the per-org background sub-ceiling, proven the way the
 * sweep (sweep-ai-cost §7) demands: THE LOAD TEST.
 *
 * Seed one org's background telemetry to its sub-cap → its next
 * background call is refused with the per-org error, while
 *   (a) the same org's customer chat still succeeds, and
 *   (b) another org's background call still succeeds —
 * i.e. the sub-ceiling trips PER-ORG, with no platform-wide pause, and
 * customer work is never bounded by it. Also pinned: origin
 * 'background_metered' does NOT count toward the sub-cap (it is already
 * bounded by the allowance it counts toward), the per-tier sub-cap
 * values, the failClosed⇒background caller convention, and the platform
 * bucket's 70% background trip firing the founder alert (R4).
 *
 * The DB is mocked with a window/origin-aware telemetry store: sums are
 * keyed `${orgId}|${origin}|${daily|monthly}` and the mock reads the
 * window back out of the gte() date the gate computes, so a daily sum
 * can never accidentally answer a monthly question.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const DAY_MS = 24 * 60 * 60 * 1000;

const h = vi.hoisted(() => {
  const tables = {
    overrides: { organizationId: "ovr_org" },
    telemetry: {
      estimatedCostCents: "t_cost",
      organizationId: "t_org",
      createdAt: "t_created",
      origin: "t_origin",
    },
    organizations: { id: "org_id", subscriptionTier: "org_tier" },
  };
  return {
    tables,
    sums: new Map<string, number>(),
    tiers: new Map<number, string>(),
    overrides: new Map<number, { dailyCeilingCents: number; monthlyCeilingCents: number | null }>(),
    notify: vi.fn(async () => {}),
    liveMrrDetail: vi.fn(async () => ({ cents: 0, payingOrgs: 0 })),
  };
});

/** Flatten mocked drizzle where-args into eq pairs + the gte date. */
function parseWhere(args: unknown[]): { eqs: Array<[string, unknown]>; since: Date | null } {
  const eqs: Array<[string, unknown]> = [];
  let since: Date | null = null;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.and)) n.and.forEach(walk);
    if (Array.isArray(n.eq)) eqs.push(n.eq as [string, unknown]);
    if (Array.isArray(n.gte)) since = n.gte[1] as Date;
  };
  args.forEach(walk);
  return { eqs, since };
}

function chain(rows: () => unknown[]) {
  const p = Promise.resolve().then(rows);
  return {
    limit: (_n: number) => p,
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: (...args: unknown[]) =>
          chain(() => {
            const { eqs, since } = parseWhere(args);
            if (table === h.tables.telemetry) {
              const orgEq = eqs.find(([c]) => c === "t_org");
              const originEq = eqs.find(([c]) => c === "t_origin");
              const orgKey = orgEq ? String(orgEq[1]) : "platform";
              const originKey = originEq ? String(originEq[1]) : "all";
              const windowMs = since ? Date.now() - since.getTime() : DAY_MS;
              const bucket = windowMs > 2 * DAY_MS ? "monthly" : "daily";
              return [{ sum: String(h.sums.get(`${orgKey}|${originKey}|${bucket}`) ?? 0) }];
            }
            if (table === h.tables.organizations) {
              const orgEq = eqs.find(([c]) => c === "org_id");
              const tier = orgEq ? h.tiers.get(Number(orgEq[1])) : undefined;
              return tier ? [{ subscriptionTier: tier }] : [];
            }
            if (table === h.tables.overrides) {
              const orgEq = eqs.find(([c]) => c === "ovr_org");
              const row = orgEq ? h.overrides.get(Number(orgEq[1])) : undefined;
              return row ? [row] : [];
            }
            return [];
          }),
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  aiCostCeilingOverrides: h.tables.overrides,
  aiTelemetryEvents: h.tables.telemetry,
  organizations: h.tables.organizations,
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  gte: (c: unknown, v: unknown) => ({ gte: [c, v] }),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: strings, vals }),
}));
vi.mock("../../server/services/finance/runwayModel", () => ({ liveMrrDetail: h.liveMrrDetail }));
vi.mock("../../server/services/aiCostAlert", () => ({ notifyAiCeilingTrip: h.notify }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  assertWithinAiCostCeiling,
  getEffectiveCeilings,
  AiCostCeilingExceededError,
  __resetPlatformCeilingMrrCacheForTests,
} from "../../server/services/aiCostCeiling";

const ORIG_ENV = { ...process.env };
const ORG_A = 101; // starter, background seeded AT its $10 sub-cap
const ORG_B = 102; // starter, untouched
const ORG_C = 103; // starter, heavy background_metered spend only

function seedLoadTest() {
  h.sums.clear();
  h.tiers.clear();
  h.overrides.clear();
  h.tiers.set(ORG_A, "starter");
  h.tiers.set(ORG_B, "starter");
  h.tiers.set(ORG_C, "starter");
  // Org A: $10 of background spend this month == the Starter sub-cap.
  h.sums.set(`${ORG_A}|background|monthly`, 1000);
  h.sums.set(`${ORG_A}|all|monthly`, 1000); // total monthly: $10 of $100 ceiling
  h.sums.set(`${ORG_A}|all|daily`, 100); // today: $1 of $10 daily ceiling
  // Org C: $50 of background_METERED spend (counts toward its allowance,
  // never the background sub-cap); zero plain-background spend.
  h.sums.set(`${ORG_C}|all|monthly`, 5000);
  h.sums.set(`${ORG_C}|background|monthly`, 0);
  h.sums.set(`${ORG_C}|all|daily`, 100);
  // Platform today: $1 — far under any platform ceiling in these tests.
  h.sums.set("platform|all|daily", 100);
}

describe("P1-5 R1 — per-org background sub-ceiling (the load test)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedLoadTest();
    // Keep the platform gate out of the org tests' way.
    process.env.AI_PLATFORM_DAILY_CEILING_CENTS = "100000";
    delete process.env.AI_COST_CEILING_BYPASS;
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("REFUSES the seeded org's next background call at its sub-cap", async () => {
    const err = await assertWithinAiCostCeiling(ORG_A, { origin: "background", failClosed: true }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCostCeilingExceededError);
    expect(err).toMatchObject({ orgId: ORG_A, windowKey: "background_monthly", currentCents: 1000, ceilingCents: 1000 });
  });

  it("the SAME org's customer chat still succeeds", async () => {
    await expect(assertWithinAiCostCeiling(ORG_A, { origin: "customer" })).resolves.toBeUndefined();
    await expect(assertWithinAiCostCeiling(ORG_A)).resolves.toBeUndefined();
  });

  it("ANOTHER org's background call still succeeds", async () => {
    await expect(assertWithinAiCostCeiling(ORG_B, { origin: "background", failClosed: true })).resolves.toBeUndefined();
  });

  it("the refusal fires the founder alert naming the org_background scope (R4)", async () => {
    await assertWithinAiCostCeiling(ORG_A, { origin: "background", failClosed: true }).catch(() => {});
    await new Promise((r) => setImmediate(r));
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "org_background", orgId: ORG_A, windowKey: "background_monthly", ceilingCents: 1000 }),
    );
  });

  it("background_metered spend does NOT trip the sub-cap (allowance already bounds it)", async () => {
    await expect(assertWithinAiCostCeiling(ORG_C, { origin: "background", failClosed: true })).resolves.toBeUndefined();
  });

  it("the failClosed convention identifies background callers even without an explicit origin", async () => {
    const err = await assertWithinAiCostCeiling(ORG_A, { failClosed: true }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCostCeilingExceededError);
    expect(err.windowKey).toBe("background_monthly");
  });

  it("sub-ceilings are tiered to price: free $2, starter $10, pro $25, scale $50", async () => {
    h.tiers.set(201, "free");
    h.tiers.set(202, "starter");
    h.tiers.set(203, "pro");
    h.tiers.set(204, "scale");
    expect((await getEffectiveCeilings(201)).backgroundMonthlyCents).toBe(200);
    expect((await getEffectiveCeilings(202)).backgroundMonthlyCents).toBe(1000);
    expect((await getEffectiveCeilings(203)).backgroundMonthlyCents).toBe(2500);
    expect((await getEffectiveCeilings(204)).backgroundMonthlyCents).toBe(5000);
    // …and the total ceilings are untouched by the reconciliation.
    expect((await getEffectiveCeilings(203)).monthlyCents).toBe(50_000);
    expect((await getEffectiveCeilings(204)).monthlyCents).toBe(80_000);
  });
});

describe("P1-5 R4 — the platform bucket's 70% background trip alerts the founder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedLoadTest();
    __resetPlatformCeilingMrrCacheForTests();
    delete process.env.AI_PLATFORM_DAILY_CEILING_CENTS; // floor: $15/day at $0 MRR
    delete process.env.AI_COST_CEILING_BYPASS;
    h.liveMrrDetail.mockResolvedValue({ cents: 0, payingOrgs: 0 });
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("background callers trip at 70% of the bucket ($10.50 of $15) and the alert names platform_background", async () => {
    h.sums.set("platform|all|daily", 1100); // $11 — past 70%, under 100%
    const err = await assertWithinAiCostCeiling(null, { failClosed: true }).catch((e) => e);
    expect(err).toBeInstanceOf(AiCostCeilingExceededError);
    expect(err.ceilingCents).toBe(1050);
    await new Promise((r) => setImmediate(r));
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "platform_background", orgId: null, ceilingCents: 1050 }),
    );
  });

  it("at the same spend a customer call still succeeds (the reserved 30% is real)", async () => {
    h.sums.set("platform|all|daily", 1100);
    await expect(assertWithinAiCostCeiling(null)).resolves.toBeUndefined();
  });

  it("the full-bucket trip alerts with the platform scope", async () => {
    h.sums.set("platform|all|daily", 1500);
    await expect(assertWithinAiCostCeiling(null)).rejects.toBeInstanceOf(AiCostCeilingExceededError);
    await new Promise((r) => setImmediate(r));
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ scope: "platform", orgId: null }));
  });
});
