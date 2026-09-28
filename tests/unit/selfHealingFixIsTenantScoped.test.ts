/**
 * DEFECT-0154 — a customer's support chat cannot read another org's support
 * resolutions through apply_self_healing_fix.
 *
 * getKnownFixPatterns read every tenant's support_resolution_history and every
 * cross-org learning (no org filter, no k), and applySelfHealingFix returned
 * the matched row's `autoFixAction || resolutionApproach` — free text written
 * from another org's ticket — to the model and the customer. A one-letter
 * pattern matched the top row, so varying it walked the list. Keyword matches
 * also let a tenant run platform-wide operations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const SECRET = "Told Acme Land LLC to re-send the Smith deed to 12 Oak Rd";
const h = vi.hoisted(() => ({
  wheres: [] as Array<{ table: string; where: unknown }>,
  rows: {} as Record<string, unknown[]>,
  processJobs: vi.fn(async () => ({ processed: 1, failed: 0 })),
  checkAll: vi.fn(async () => undefined),
  invalidate: vi.fn(),
}));

vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => { table = getTableName(t as never); return q; };
    q.where = (w: unknown) => { h.wheres.push({ table, where: w }); return q; };
    q.orderBy = () => q;
    q.limit = async () => h.rows[table] ?? [];
    return q;
  };
  const write = () => ({ values: async () => [], set: () => ({ where: async () => [] }) });
  return { db: { select, insert: write, update: write } };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/openaiClient", () => ({ requireOpenAIClient: vi.fn() }));
vi.mock("../../server/services/jobQueue", () => ({ jobQueueService: { processJobs: h.processJobs } }));
vi.mock("../../server/services/healthCheck", () => ({ healthCheckService: { checkAll: h.checkAll } }));
vi.mock("../../server/services/aiContextAggregator", () => ({ invalidateContextCache: h.invalidate }));

import { paxLearningService } from "../../server/services/paxLearning";

const dialect = new PgDialect();
const rendered = (table: string) =>
  h.wheres.filter((w) => w.table === table).map((w) => dialect.sqlToQuery(w.where as SQL));

beforeEach(() => {
  h.wheres.length = 0;
  h.processJobs.mockClear();
  h.checkAll.mockClear();
  h.rows = {
    pax_cross_org_learnings: [],
    support_resolution_history: [
      { issuePattern: "login loop", issueType: "auth", resolutionApproach: SECRET, wasSuccessful: true, customerEffortScore: 1 },
    ],
    fix_attempts: [],
  };
});

describe("DEFECT-0154 — known fix patterns are the caller's own, or k-anonymous", () => {
  it("resolution history is read for the calling org only", async () => {
    await paxLearningService.getKnownFixPatterns(7);
    const q = rendered("support_resolution_history");
    expect(q).toHaveLength(1);
    expect(q[0].sql).toMatch(/"organization_id" = \$1/);
    expect(q[0].params[0]).toBe(7);
  });

  it("cross-org patterns require at least 3 contributing orgs", async () => {
    await paxLearningService.getKnownFixPatterns(7);
    const q = rendered("pax_cross_org_learnings");
    expect(q).toHaveLength(1);
    expect(q[0].sql).toMatch(/"contributing_orgs" >= \$\d/);
    expect(q[0].params).toContain(3);
  });

  it("what reaches the caller is an action category, never stored text", async () => {
    const r = await paxLearningService.applySelfHealingFix(7, "login loop");
    expect(JSON.stringify(r)).not.toContain("Acme");
    expect(["clear_cache", "retry_jobs", "resync", "manual", "none"]).toContain(r.action);
  });

  it("a one-letter pattern matches nothing", async () => {
    const r = await paxLearningService.applySelfHealingFix(7, "l");
    expect(r.action).toBe("none");
  });

  it("a tenant's chat cannot trigger platform-wide operations", async () => {
    h.rows.support_resolution_history = [
      { issuePattern: "stuck export", issueType: "jobs", resolutionApproach: "retry the failed job", wasSuccessful: true },
    ];
    const r = await paxLearningService.applySelfHealingFix(7, "stuck export");
    expect(h.processJobs).not.toHaveBeenCalled();
    expect(r.applied).toBe(false);
  });
});
