/**
 * The retention purge of old closed deals (W10.4 re-audits).
 *
 * Every close writes the deal's deal_won outcome row and pattern fingerprint,
 * and a dozen-odd tables — signed contracts in generated_documents among them
 * — reference deals ON DELETE NO ACTION (migrations 0000/0001). The purge's
 * DELETE failed with 23503 on the first linked deal, and a first fix that
 * detached one child table still failed on the next. A retention rule may not
 * cascade a customer's documents away either. So the purge deletes only the
 * deals NOTHING references, reading the referencing tables from the live
 * catalog (orgDataClear.loadBlockingEdges), keeps and counts the rest, and
 * reports each removal as a purge — the commission owed on an aged-out deal
 * stands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const H = vi.hoisted(() => ({
  deletes: [] as Array<{ table: string; where: string; params: unknown[] }>,
  reads: [] as string[],
  evidence: [] as unknown[][],
  hold: false,
  edges: [] as Array<{ child: string; childCol: string; parent: string; parentCol: string }>,
  kept: 0,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/legalHold", () => ({ orgHasActiveHold: async () => H.hold }));
vi.mock("../../server/services/orgDataClear", () => ({ loadBlockingEdges: async () => H.edges }));
vi.mock("../../server/services/dealLifecycleEvents", () => ({
  DEAL_PURGED: "purged",
  recordDealTransitionEvidence: (...a: unknown[]) => H.evidence.push(a),
}));
vi.mock("../../server/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const db = {
    delete: (t: unknown) => ({
      where: (w: unknown) => ({
        returning: async () => {
          const q = dialect.sqlToQuery(w as never);
          H.deletes.push({ table: getTableName(t as never), where: q.sql, params: q.params });
          return [{ id: 7 }, { id: 8 }];
        },
      }),
    }),
    select: () => ({
      from: (t: unknown) => ({
        where: async (w: unknown) => {
          H.reads.push(`${getTableName(t as never)}: ${dialect.sqlToQuery(w as never).sql}`);
          return [{ n: H.kept }];
        },
      }),
    }),
  };
  return { db };
});

const { auditRepo } = await import("../../server/storage/auditRepo");

const EDGES = [
  { child: "generated_documents", childCol: "deal_id", parent: "deals", parentCol: "id" },
  { child: "deal_patterns", childCol: "deal_id", parent: "deals", parentCol: "id" },
  { child: "outcome_telemetry", childCol: "related_deal_id", parent: "deals", parentCol: "id" },
  // Edges into OTHER tables are not about deals.
  { child: "leads_notes", childCol: "lead_id", parent: "leads", parentCol: "id" },
];

beforeEach(() => {
  H.deletes = [];
  H.reads = [];
  H.evidence = [];
  H.hold = false;
  H.edges = EDGES;
  H.kept = 3;
});

const purge = () => auditRepo.purgeOldDeals.call({} as never, 42, new Date("2025-01-01T00:00:00Z"), "closed");

describe("purgeOldDeals", () => {
  it("deletes only deals no blocking row references — one NOT EXISTS per catalog edge into deals", async () => {
    await purge();
    expect(H.deletes).toHaveLength(1);
    const [del] = H.deletes;
    expect(del.table).toBe("deals");
    for (const e of EDGES.filter((x) => x.parent === "deals")) {
      expect(del.where).toContain(`NOT EXISTS (SELECT 1 FROM "${e.child}" AS "blocking_child" WHERE "blocking_child"."${e.childCol}" = "deals"."id")`);
    }
    expect(del.where).not.toContain("leads_notes");
    // Org-scoped, older than the date, of the status asked.
    expect(del.where).toMatch(/"deals"\."organization_id" = \$1/);
    expect(del.params.slice(0, 3)).toEqual([42, "2025-01-01T00:00:00.000Z", "closed"]);
  });

  it("a NEW referencing table in the catalog is honoured with no code change", async () => {
    H.edges = [...EDGES, { child: "closing_packets", childCol: "deal_id", parent: "deals", parentCol: "id" }];
    await purge();
    expect(H.deletes[0].where).toContain(`FROM "closing_packets" AS "blocking_child" WHERE "blocking_child"."deal_id" = "deals"."id"`);
  });

  it("says how many it kept, counted over the same org-scoped set", async () => {
    expect(await purge()).toEqual({ purged: 2, keptLinked: 3 });
    expect(H.reads).toEqual([expect.stringMatching(/^deals: .*"deals"\."organization_id" = \$1/)]);
  });

  it("reports each removal as a purge (the owed commission stands), not as a deleted deal", async () => {
    await purge();
    expect(H.evidence).toEqual([
      [42, { status: "closed" }, { id: 7, status: "purged" }],
      [42, { status: "closed" }, { id: 8, status: "purged" }],
    ]);
  });

  it("a legal hold purges nothing", async () => {
    H.hold = true;
    expect(await purge()).toEqual({ purged: 0, keptLinked: 0 });
    expect(H.deletes).toEqual([]);
  });
});
