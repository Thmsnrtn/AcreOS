/**
 * The founder inbox's dedupe reads must pin the LANE, and `null` is a lane.
 *
 * ── WHY THIS FILE EXISTS, AND WHY THE SOURCE GATE IS NOT ENOUGH ────────────
 * Four dedupe reads in decisionsInbox.ts guard "is there already an open card
 * for this thing?" before inserting another. Three of them insert a card with
 * `organizationId: null` (founder-global: a direct card, a shadow-promotion
 * request, a critical-alert card); the fourth copies the ORIGINAL card's
 * organizationId, which is itself nullable.
 *
 * Until 2026-09-05 none of the four named the organization at all, so the
 * dedupe reached across every tenant's cards. `check-org-scoped-fetch.mjs`
 * rule 3 now catches that shape — remove the predicate and the gate goes red,
 * which is verified by mutation.
 *
 * But the gate reads SOURCE, and it is satisfied by the mere mention of the
 * column. The dangerous rewrite is not deletion, it is:
 *
 *     eq(decisionsInboxItems.organizationId, original.organizationId)
 *
 * which looks MORE scoped than the ternary it replaces, passes the lint, type
 * checks, and compiles to `organization_id = NULL` whenever the original card
 * is founder-global. In SQL that matches nothing — so the dedupe finds no
 * existing card, and the founder gets another outcome check-in for the same
 * decision on every single sweep. A green gate over a live defect.
 *
 * So this file does not read the file. It renders the predicate each call
 * actually hands Drizzle, through the real pg dialect, and asserts on the SQL:
 * a founder-global read must emit `is null`, never `= $n`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/founderInterruptArbiter", () => ({
  arbitrateFounderInterrupt: vi.fn(async (req: any) => ({
    outcome: "deliver",
    interruptClass: req.interruptClass,
    reason: "within budget",
    quietHoursActive: false,
    budget: { used: 0, limit: 5 },
    deferUntil: null,
  })),
  recordDeferredInterrupt: vi.fn(async () => null),
}));

vi.mock("../../server/services/agentActionExecutors", () => ({
  executeAction: vi.fn(),
  hasExecutor: vi.fn(() => false),
}));

vi.mock("../../server/services/customerSupportAutoResolver", () => ({
  customerSupportAutoResolver: {
    attemptResolution: vi.fn(async () => ({
      autoResolved: false,
      geniusResponse: null,
      geniusConfidence: 0,
    })),
  },
}));

vi.mock("../../server/utils/openaiClient", () => ({
  requireOpenAIClient: vi.fn(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

// ── DB mock: captures the predicate, returns nothing (so the insert runs) ───

const captured: { where: SQL | null } = { where: null };
const alertRow: { row: Record<string, unknown> | null } = { row: null };

vi.mock("../../server/db", () => {
  const capturingFindFirst = vi.fn(async (args: any) => {
    captured.where = args?.where ?? null;
    return null;
  });
  const db = {
    query: {
      decisionsInboxItems: { findFirst: capturingFindFirst },
      systemAlerts: { findFirst: vi.fn(async () => alertRow.row) },
      supportTickets: { findFirst: vi.fn(async () => null) },
      featureRequests: { findFirst: vi.fn(async () => null) },
      organizations: { findFirst: vi.fn(async () => null) },
    },
    insert: () => ({
      values: (row: Record<string, any>) => ({
        returning: () => Promise.resolve([{ id: 999, ...row }]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  return { db };
});

// unscopedForPlatformOps returns the same handle in production; keep that here
// so the hatched systemAlerts read still resolves through the mock above.
vi.mock("../../server/utils/orgScopedDb", async () => {
  const { db } = await import("../../server/db");
  return { unscopedForPlatformOps: vi.fn(() => db) };
});

import { decisionsInboxService } from "../../server/services/decisionsInbox";

const dialect = new PgDialect();
const rendered = () => {
  expect(captured.where, "no dedupe predicate was captured — the read changed shape").not.toBeNull();
  return dialect.sqlToQuery(captured.where as SQL);
};

/** The whole point: `is null`, not `= $n`, on the tenant column. */
const NULL_LANE = /"organization_id"\s+is\s+null/i;
/** The defect shape: an equality against the tenant column. */
const EQ_LANE = /"organization_id"\s*=\s*\$\d+/i;

beforeEach(() => {
  captured.where = null;
  alertRow.row = { id: 21, severity: "critical", title: "DB down", message: "no conn" };
});

describe("founder-global cards dedupe within the null lane", () => {
  it("createDirectDecisionCard emits `organization_id is null`", async () => {
    await decisionsInboxService.createDirectDecisionCard({
      itemType: "ops_review",
      riskLevel: "medium",
      urgencyScore: 40,
      sophieAnalysis: "a",
      recommendedAction: "b",
      recommendedActionLabel: "c",
      subject: "quarterly ops review",
      options: [{ key: "yes", label: "Yes" }],
    });
    const { sql } = rendered();
    expect(sql, `direct-card dedupe must pin the null lane, got:\n${sql}`).toMatch(NULL_LANE);
    expect(sql, "a founder-global card must never dedupe by equality on the tenant column").not.toMatch(EQ_LANE);
  });

  it("createShadowPromotionRequest emits `organization_id is null`", async () => {
    await decisionsInboxService.createShadowPromotionRequest({
      domain: "outreach",
      fromLevel: "shadow",
      toLevel: "assisted",
      cleanCycleCount: 8,
      threshold: 6,
      agreement: {
        matched: 20,
        total: 22,
        pendingPairs: 0,
        windowWeeks: 4,
        misses: [],
        sufficient: true,
        capabilities: [],
        caveat: "",
      },
    });
    const { sql } = rendered();
    expect(sql, `promotion-request dedupe must pin the null lane, got:\n${sql}`).toMatch(NULL_LANE);
    expect(sql).not.toMatch(EQ_LANE);
  });

  it("createFromAlert emits `organization_id is null`", async () => {
    await decisionsInboxService.createFromAlert(21);
    const { sql } = rendered();
    expect(sql, `critical-alert dedupe must pin the null lane, got:\n${sql}`).toMatch(NULL_LANE);
    expect(sql).not.toMatch(EQ_LANE);
  });
});

describe("the outcome check-in inherits the ORIGINAL card's lane", () => {
  const original = (organizationId: number | null) => ({
    id: 501,
    itemType: "ops_review",
    organizationId,
    ownerAgentCodename: null,
    recommendedActionLabel: "Do the thing",
    expectedOutcome: null,
    resolvedAt: new Date("2026-08-01T00:00:00Z"),
  });

  it("a founder-global original dedupes with `is null`, NOT `= NULL`", async () => {
    await decisionsInboxService.createOutcomeCheckIn(original(null));
    const { sql, params } = rendered();
    expect(
      sql,
      "THE defect this file exists for: a plain eq() against a null organizationId " +
        "compiles to `organization_id = $n` with a null param, which matches no row " +
        "in SQL — so the dedupe never fires and the founder gets a duplicate " +
        `check-in card every sweep. Got:\n${sql}`,
    ).toMatch(NULL_LANE);
    expect(sql).not.toMatch(EQ_LANE);
    expect(
      params,
      "a null must never be bound as a parameter on the tenant column",
    ).not.toContain(null);
  });

  it("an org-tagged original dedupes inside that org", async () => {
    await decisionsInboxService.createOutcomeCheckIn(original(7));
    const { sql, params } = rendered();
    expect(sql, `an org-tagged check-in must scope to its org, got:\n${sql}`).toMatch(EQ_LANE);
    expect(sql).not.toMatch(NULL_LANE);
    expect(params, "the original's organizationId must be the bound value").toContain(7);
  });
});
