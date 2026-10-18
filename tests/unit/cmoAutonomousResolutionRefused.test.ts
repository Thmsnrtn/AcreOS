import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const h = vi.hoisted(() => ({ update: vi.fn(), where: vi.fn(), model: vi.fn(), triage: vi.fn() }));
vi.mock("../../server/db", () => ({ db: {
  update: h.update,
  select: () => ({ from: () => ({ where: (predicate: unknown) => { h.where(predicate); return { orderBy: () => ({ limit: async () => [{ id: 1, itemType: "cmo_ad_review", organizationId: 7 }] }) }; } }) }),
} }));
vi.mock("../../server/services/aiRouter", () => ({ routeAITask: h.model, routeCriticalTask: h.model, TaskComplexity: {} }));
vi.mock("../../server/services/companyMind", () => ({ getCrossWingContext: h.triage }));
vi.mock("../../server/services/emailService", () => ({ emailService: {} }));
vi.mock("../../server/services/companyAgents", () => ({ companyAgentService: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe("the scheduler cannot generically triage or resolve a video review", () => {
  it("filters video cards and still hard-stops a stale returned card before any evaluation", async () => {
    vi.stubEnv("AUTONOMOUS_EXECUTOR_ENABLED", "true");
    h.update.mockReturnValue({ set: () => ({ where: h.where }) });
    const { runAutonomousDecisionExecutor } = await import("../../server/services/autonomousDecisionExecutor");
    const result = await runAutonomousDecisionExecutor();
    expect(result.itemsHardStopped).toBe(1); expect(result.results[0].executed).toBe(false);
    expect(h.model).not.toHaveBeenCalled(); expect(h.triage).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledTimes(1); // only filtered deferred re-open
    const queries = h.where.mock.calls.map(([p]) => new PgDialect().sqlToQuery(p as SQL));
    expect(queries).toHaveLength(2);
    for (const q of queries) { expect(q.sql).toContain('"item_type" <>'); expect(q.params).toContain("cmo_ad_review"); }
    vi.unstubAllEnvs();
  });
});
