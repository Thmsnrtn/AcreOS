/**
 * W10.3 — server/storage/listBuilderRepo.ts, statement by statement.
 *
 * Each read is rendered with the real Postgres dialect and held to:
 *   (a) the org predicate on its table, bound to THIS org — including the
 *       list-membership subquery inside the member-leads page;
 *   (b) the live-lead predicate on every read of `leads` for display (the
 *       member page and its count);
 *   (c) the creation dedupe deliberately WITHOUT it — it must see deleted
 *       leads, and its result must suppress a parcel whose only lead is
 *       deleted rather than re-create it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const ORG = 7;
const rec = vi.hoisted(() => ({
  queries: [] as Array<{ table?: unknown; where?: unknown }>,
  answers: [] as unknown[][],
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      const q: { table?: unknown; where?: unknown } = {};
      rec.queries.push(q);
      const chain: Record<string, unknown> = {
        from: (t: unknown) => ((q.table = t), chain),
        where: (w: unknown) => ((q.where = w), chain),
        orderBy: () => chain,
        groupBy: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(rec.answers.shift() ?? []).then(res, rej),
      };
      return chain;
    },
  },
}));

const repo = await import("../../server/storage/listBuilderRepo");

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);
/** Every `"<table>"."organization_id" = $n` in the statement, with its bound value. */
function orgBindings(w: unknown): Array<{ table: string; value: unknown }> {
  const q = render(w);
  return [...q.sql.matchAll(/"(\w+)"\."organization_id" = \$(\d+)/g)].map((m) => ({ table: m[1], value: q.params[Number(m[2]) - 1] }));
}

beforeEach(() => {
  rec.queries = [];
  rec.answers = [];
});

describe("listMemberLeadsCursor", () => {
  it("binds BOTH the leads read and the membership subquery to the org, and reads live leads only", async () => {
    rec.answers = [[{ n: 1 }], [{ id: 3 }]];
    await repo.listMemberLeadsCursor(ORG, 5, { limit: 10, cursor: 99 });
    expect(rec.queries).toHaveLength(2);
    for (const q of rec.queries) {
      expect(getTableName(q.table as never)).toBe("leads");
      const b = orgBindings(q.where);
      expect(b).toEqual(expect.arrayContaining([{ table: "leads", value: ORG }, { table: "marketing_list_members", value: ORG }]));
      expect(b.every((x) => x.value === ORG)).toBe(true);
      const { sql, params } = render(q.where);
      expect(sql).toMatch(/"leads"\."deleted_at" is null/);
      expect(sql).toMatch(/"marketing_list_members"\."list_id" = \$\d+/);
      expect(params).toContain(5);
    }
    expect(render(rec.queries[1].where).sql).toMatch(/"leads"\."id" < \$\d+/);
  });
});

describe("orgHasMarketingList / listCountyLists", () => {
  it("resolve a list only inside the org", async () => {
    await repo.orgHasMarketingList(ORG, 5);
    expect(orgBindings(rec.queries[0].where)).toEqual([{ table: "marketing_lists", value: ORG }]);
  });

  it("every list read and the member tally are org-bound", async () => {
    rec.answers = [[{ n: 1 }], [{ id: 5, name: "L", filters: null, createdAt: null }], [{ listId: 5, n: 3 }]];
    const out = await repo.listCountyLists(ORG, 50);
    expect(out).toEqual({ total: 1, lists: [{ id: 5, name: "L", state: null, county: null, total: 3, createdAt: null }] });
    expect(rec.queries).toHaveLength(3);
    for (const q of rec.queries.slice(0, 2)) expect(orgBindings(q.where).map((b) => b.value)).toEqual([ORG]);
    // The tally counts LIVE member leads (W10.3 second audit, finding 7): the
    // membership AND the leads it counts are both bound to the org.
    expect(orgBindings(rec.queries[2].where)).toEqual([
      { table: "marketing_list_members", value: ORG },
      { table: "leads", value: ORG },
    ]);
    expect(render(rec.queries[2].where).sql).toMatch(/"leads"\."deleted_at" is null/);
    expect(render(rec.queries[0].where).params).toContain("county_records");
  });
});

describe("planCountyListMembers — the creation dedupe", () => {
  it("reads the org's leads INCLUDING deleted ones, and suppresses a parcel whose only lead is deleted", async () => {
    rec.answers = [
      [
        { id: 1, apn: "A-1", state: "TX", county: "Harris", deletedAt: null },
        { id: 2, apn: "A-2", state: "TX", county: "Harris", deletedAt: new Date() },
        // Same APN as A-3 but deleted AND a live twin: the live one wins.
        { id: 3, apn: "A-3", state: "TX", county: "Harris", deletedAt: new Date() },
        { id: 4, apn: "A-3", state: "TX", county: "Harris", deletedAt: null },
      ],
    ];
    const plan = await repo.planCountyListMembers(ORG, "TX", "Harris", [
      { apn: "A-1", owner: "X", acres: 1, address: null },
      { apn: "A-2", owner: "Y", acres: 1, address: null },
      { apn: "A-3", owner: "Z", acres: 1, address: null },
      { apn: "a-1", owner: "dup", acres: 1, address: null },
      { apn: "  ", owner: "none", acres: 1, address: null },
      { apn: "A-9", owner: "new", acres: 1, address: null },
    ]);
    expect(plan.linkLeadIds.sort()).toEqual([1, 4]);
    expect(plan.linkedParcels).toBe(2);
    expect(plan.suppressedDeleted).toBe(1);
    // A blank APN and a repeated APN are different things, counted apart.
    expect(plan.skippedNoApn).toBe(1);
    expect(plan.skippedDuplicateApn).toBe(1);
    expect(plan.toCreate.map((p) => p.apn)).toEqual(["A-9"]);
    // Every parcel lands in exactly one bucket.
    expect(plan.linkedParcels + plan.toCreate.length + plan.suppressedDeleted + plan.skippedNoApn + plan.skippedDuplicateApn).toBe(6);

    expect(rec.queries).toHaveLength(1);
    const { sql } = render(rec.queries[0].where);
    expect(orgBindings(rec.queries[0].where)).toEqual([{ table: "leads", value: ORG }]);
    expect(sql).not.toMatch(/deleted_at/); // deliberately sees deleted leads
  });
});

describe("readListMembership — what a list-acting skill reads", () => {
  it("a list with member rows: its LIVE member leads, org-bound on both sides", async () => {
    rec.answers = [[{ id: 1 }], [{ id: 11 }, { id: 12 }]];
    const out = await repo.readListMembership(ORG, { id: 5, source: "custom" });
    expect(out).toEqual({ memberList: true, leads: [{ id: 11 }, { id: 12 }] });
    expect(rec.queries).toHaveLength(2);
    expect(getTableName(rec.queries[0].table as never)).toBe("marketing_list_members");
    expect(orgBindings(rec.queries[0].where)).toEqual([{ table: "marketing_list_members", value: ORG }]);
    expect(render(rec.queries[0].where).params).toContain(5);
    expect(getTableName(rec.queries[1].table as never)).toBe("leads");
    const b = orgBindings(rec.queries[1].where);
    expect(b).toEqual(expect.arrayContaining([{ table: "leads", value: ORG }, { table: "marketing_list_members", value: ORG }]));
    expect(b.every((x) => x.value === ORG)).toBe(true);
    const { sql, params } = render(rec.queries[1].where);
    expect(sql).toMatch(/"leads"\."deleted_at" is null/);
    expect(sql).toMatch(/"marketing_list_members"\."list_id" = \$\d+/);
    expect(params).toContain(5);
  });

  it("a county list is a member list even when it has no live members left — never the whole book", async () => {
    rec.answers = [[], []];
    expect(await repo.readListMembership(ORG, { id: 5, source: "county_records" })).toEqual({ memberList: true, leads: [] });
  });

  it("a legacy list with no member rows is not a member list (callers keep their filter behaviour)", async () => {
    rec.answers = [[]];
    expect(await repo.readListMembership(ORG, { id: 5, source: "propstream" })).toEqual({ memberList: false, leads: [] });
    expect(rec.queries).toHaveLength(1);
  });
});
