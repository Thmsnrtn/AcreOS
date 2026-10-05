/**
 * DEFECT-0171 (W10.2b group E) — the counts, sums and lists Pax, the MCP
 * servers, the VA briefing and Pax's system context tell a model are read
 * over the WHOLE book, in SQL (server/storage/wholeOrgReadsE.ts).
 *
 * `db` is a REAL Drizzle instance (pg-proxy) so the statements under test are
 * the SQL Postgres would receive; the fake sits at the wire, records each
 * statement and answers with the rows a test sets. Each aggregate is checked
 * for (a) the org predicate, (b) the live-lead predicate where leads are read
 * and the capped getter's own filter otherwise, and (c) no LIMIT — and each
 * list for a LIMIT that is the caller's number, never the 5000 cap.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { properties } from "@shared/schema";

const wire = vi.hoisted(() => ({
  calls: [] as { sql: string; params: unknown[] }[],
  answers: [] as unknown[][][],
  /** When set, answers by statement instead of by order (for callers that fan out). */
  route: null as null | ((sql: string) => unknown[][]),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganization: vi.fn(async () => ({ id: 7, name: "Big Book Land Co" })),
    getTasks: vi.fn(async () => []),
    getCampaigns: vi.fn(async () => []),
  },
}));

vi.mock("../../server/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const db = drizzle(async (sql: string, params: unknown[]) => {
    wire.calls.push({ sql, params });
    return { rows: wire.route ? wire.route(sql) : wire.answers.shift() ?? [] };
  });
  return { db, dbReadOnly: db, pool: { query: async () => ({ rows: [] }) } };
});

import {
  dealTallies,
  internalCompCandidates,
  leadTallies,
  listDealsNewestFirst,
  listLeadsNewestFirst,
  listNotesNewestFirst,
  listPropertiesNewestFirst,
  noteTallies,
  pageLeadsNewestFirst,
  propertyTallies,
  staleLeadsPage,
} from "../../server/storage/wholeOrgReadsE";
import { getSystemContext, invalidateContextCache } from "../../server/services/aiContextAggregator";

const ORG = 7;
const SINCE = new Date("2026-09-28T00:00:00.000Z");

beforeEach(() => {
  wire.calls.length = 0;
  wire.answers.length = 0;
  wire.route = null;
});

const only = () => {
  expect(wire.calls).toHaveLength(1);
  return wire.calls[0];
};

/** (a): the WHERE binds `<table>.organization_id` to THIS org's id, whatever its $N. */
function expectOrgBound(call: { sql: string; params: unknown[] }, table: string) {
  const m = call.sql.match(new RegExp(`"${table}"\\."organization_id" = \\$(\\d+)`));
  expect(m, `no ${table}.organization_id predicate in: ${call.sql}`).toBeTruthy();
  expect(call.params[Number(m![1]) - 1]).toBe(ORG);
}

/** (c): no statement carries the cap, as a LIMIT or as a bound parameter. */
function expectNoCap(call: { sql: string; params: unknown[] }) {
  expect(call.params).not.toContain(5000);
  expect(call.params).not.toContain(5001);
}

describe("aggregates: one grouped statement, org-scoped, no LIMIT", () => {
  it("leadTallies counts every live lead of the org, past 5000", async () => {
    wire.answers.push([
      ["new", "seller", 4000, "10"],
      ["new", "buyer", 1500, "0"],
      ["dead", "seller", 700, "3"],
    ]);
    expect(await leadTallies(ORG, SINCE)).toEqual({
      total: 6200,
      createdSince: 13,
      byStatus: { new: 5500, dead: 700 },
      byType: { seller: 4700, buyer: 1500 },
    });
    const c = only();
    expectOrgBound(c, "leads");
    expect(c.sql).toMatch(/"leads"\."deleted_at" is null/i);
    expect(c.sql).toMatch(/group by/i);
    expect(c.sql).toMatch(/count\(\*\) filter \(where "leads"\."created_at" > \$\d\)/);
    expect(c.sql).not.toMatch(/\blimit\b/i);
    expect(c.params).toContain(ORG);
    expectNoCap(c);
  });

  it("leadTallies without `since` still counts the whole book", async () => {
    wire.answers.push([["new", "seller", 9000, "0"]]);
    expect((await leadTallies(ORG)).total).toBe(9000);
    expect(only().sql).not.toMatch(/filter \(where/);
  });

  it("propertyTallies applies getProperties' own filter and sums acres and value", async () => {
    wire.answers.push([
      ["owned", 5200, "4", "10400.5", "2600000"],
      ["listed", 300, "0", "600", "150000.25"],
    ]);
    expect(await propertyTallies(ORG, SINCE)).toEqual({
      total: 5500,
      createdSince: 4,
      byStatus: { owned: 5200, listed: 300 },
      totalAcres: 11000.5,
      totalMarketValue: 2750000.25,
    });
    const c = only();
    expectOrgBound(c, "properties");
    expect(c.sql).toMatch(/"properties"\."status" <> \$\d/);
    expect(c.params).toContain("deleted");
    expect(c.sql).not.toMatch(/\blimit\b/i);
    expectNoCap(c);
  });

  it("dealTallies leaves out administrative statuses and sums the three amount readings", async () => {
    wire.answers.push([
      ["closed", "acquisition", 6000, "0", "100", "150", "200"],
      ["negotiating", "disposition", 10, "2", "5", "5", "5"],
    ]);
    const t = await dealTallies(ORG, SINCE);
    expect(t).toMatchObject({
      total: 6010,
      createdSince: 2,
      byStatus: { closed: 6000, negotiating: 10 },
      byType: { acquisition: 6000, disposition: 10 },
      offerSum: 105,
      offerElseAcceptedSum: 155,
      acceptedElseOfferSumByStatus: { closed: 200, negotiating: 5 },
    });
    const c = only();
    expectOrgBound(c, "deals");
    expect(c.sql).toMatch(/"deals"\."status" not in/);
    expect(c.params).toContain("deleted");
    expect(c.sql).toMatch(/coalesce\((?:"deals"\.)?"offer_amount", (?:"deals"\.)?"accepted_amount"\)/);
    expect(c.sql).toMatch(/coalesce\((?:"deals"\.)?"accepted_amount", (?:"deals"\.)?"offer_amount"\)/);
    expect(c.sql).not.toMatch(/\blimit\b/i);
    expectNoCap(c);
  });

  it("noteTallies groups every note of the org by status, with past-due counts", async () => {
    wire.answers.push([
      ["active", 5600, "1000000", "25000", "1200000", "12"],
      ["paid_off", 400, "0", "0", "300000", "0"],
    ]);
    const t = await noteTallies(ORG, SINCE);
    expect(t.total).toBe(6000);
    expect(t.totalOriginalPrincipal).toBe(1500000);
    expect(t.byStatus.active).toEqual({
      count: 5600,
      currentBalance: 1000000,
      monthlyPayment: 25000,
      originalPrincipal: 1200000,
      pastDue: 12,
    });
    const c = only();
    expectOrgBound(c, "notes");
    expect(c.sql).toMatch(/count\(\*\) filter \(where "notes"\."next_payment_date" < \$\d\)/);
    expect(c.sql).not.toMatch(/\blimit\b/i);
    expectNoCap(c);
  });
});

describe("lists: filtered, ordered and limited in SQL — the caller's limit, never the cap", () => {
  it("listLeadsNewestFirst puts every filter in the WHERE, live, newest first", async () => {
    await listLeadsNewestFirst(ORG, { status: "new", type: "seller", state: "tx", addressContains: "Travis", minScore: 40 }, 5);
    const c = only();
    expectOrgBound(c, "leads");
    expect(c.sql).toMatch(/"leads"\."deleted_at" is null/i);
    expect(c.sql).toMatch(/"leads"\."status" = \$\d/);
    expect(c.sql).toMatch(/"leads"\."type" = \$\d/);
    expect(c.sql).toMatch(/upper\("leads"\."state"\) = upper\(\$\d\)/);
    expect(c.sql).toMatch(/strpos\(lower\("leads"\."address"\), lower\(\$\d\)\) > 0/);
    expect(c.sql).toMatch(/coalesce\("leads"\."score", 0\) >= \$\d/);
    expect(c.sql).toMatch(/order by "leads"\."created_at" desc/i);
    expect(c.sql).toMatch(/limit \$\d+$/i);
    expect(c.params[c.params.length - 1]).toBe(5);
    expect(c.params).toEqual(expect.arrayContaining([ORG, "new", "seller", "tx", "Travis", 40]));
    expectNoCap(c);
  });

  it("the matching count uses the same WHERE and has no LIMIT", async () => {
    wire.answers.push([], [[6400]]);
    const page = await pageLeadsNewestFirst(ORG, { status: "dead" }, 10);
    expect(page.total).toBe(6400);
    const count = wire.calls.find((c) => /count\(\*\)/.test(c.sql))!;
    expectOrgBound(count, "leads");
    expect(count.sql).toMatch(/"leads"\."deleted_at" is null/i);
    expect(count.sql).toMatch(/"leads"\."status" = \$\d/);
    expect(count.sql).not.toMatch(/\blimit\b/i);
    expectNoCap(count);
  });

  it("the matching count with no filter is the whole live book", async () => {
    wire.answers.push([], [[12000]]);
    expect((await pageLeadsNewestFirst(ORG, {}, 10)).total).toBe(12000);
    const count = wire.calls.find((c) => /count\(\*\)/.test(c.sql))!;
    expect(count.sql).toMatch(/"leads"\."deleted_at" is null/i);
    expect(count.sql).not.toMatch(/\blimit\b/i);
  });

  it("an unreadable limit is LIMIT 0, never 'no limit'", async () => {
    await listLeadsNewestFirst(ORG, {}, Number.NaN);
    const c = only();
    expect(c.sql).toMatch(/limit \$\d+$/i);
    expect(c.params[c.params.length - 1]).toBe(0);
  });

  it("properties, deals and notes keep their getter's filter and take the caller's limit", async () => {
    await listPropertiesNewestFirst(ORG, { status: "owned", state: "TX", countyContains: "trav", createdAfter: SINCE }, 3);
    await listDealsNewestFirst(ORG, { status: "closed", type: "acquisition" }, 4);
    await listNotesNewestFirst(ORG, { status: "active" }, 6);
    const [p, d, n] = wire.calls;
    expectOrgBound(p, "properties");
    expect(p.sql).toMatch(/"properties"\."status" <> \$\d/);
    expect(p.sql).toMatch(/strpos\(lower\("properties"\."county"\), lower\(\$\d\)\) > 0/);
    expect(p.sql).toMatch(/"properties"\."created_at" > \$\d/);
    expect(p.params[p.params.length - 1]).toBe(3);
    expectOrgBound(d, "deals");
    expect(d.sql).toMatch(/"deals"\."status" not in/);
    expect(d.params[d.params.length - 1]).toBe(4);
    expectOrgBound(n, "notes");
    expect(n.sql).toMatch(/"notes"\."status" = \$\d/);
    expect(n.params[n.params.length - 1]).toBe(6);
    for (const c of [p, d, n]) {
      expect(c.sql).toMatch(/order by "\w+"\."created_at" desc/i);
      expectNoCap(c);
    }
  });

  it("staleLeadsPage: live, not closed/dead, stalest first, counted whole", async () => {
    wire.answers.push([], [[7300]]);
    const r = await staleLeadsPage(ORG, SINCE, 25);
    expect(r.total).toBe(7300);
    expect(wire.calls).toHaveLength(2);
    for (const c of wire.calls) {
      expectOrgBound(c, "leads");
      expect(c.sql).toMatch(/"leads"\."deleted_at" is null/i);
      expect(c.sql).toMatch(/"leads"\."status" not in/);
      expect(c.sql).toMatch(/"leads"\."last_contacted_at" < \$\d/);
      expect(c.params).toEqual(expect.arrayContaining(["closed", "dead"]));
      expectNoCap(c);
    }
    const [list, count] = wire.calls;
    expect(list.sql).toMatch(/order by coalesce\("leads"\."last_contacted_at", "leads"\."created_at"\) asc nulls last/i);
    expect(list.params[list.params.length - 1]).toBe(25);
    expect(count.sql).not.toMatch(/\blimit\b/i);
  });
});

describe("internal comps: the whole matching set, keyset-paged", () => {
  const cols = Object.keys(getTableColumns(properties));
  const row = (o: Record<string, unknown>) => cols.map((k) => (k in o ? o[k] : null));

  it("reads same-county comps with a price, excludes the subject, returns newest first", async () => {
    wire.answers.push([
      row({ id: 11, organizationId: ORG, county: "Travis", state: "TX", status: "sold", soldPrice: "50000", sizeAcres: "5", createdAt: "2020-01-01 00:00:00" }),
      row({ id: 12, organizationId: ORG, county: "Travis", state: "TX", status: "owned", marketValue: "9000", sizeAcres: "1", createdAt: "2026-01-01 00:00:00" }),
    ]);
    const comps = await internalCompCandidates(ORG, { id: 99, county: "Travis", state: "TX" });
    expect(comps.map((p) => p.id)).toEqual([12, 11]);
    const c = only();
    expectOrgBound(c, "properties");
    expect(c.sql).toMatch(/"properties"\."status" <> \$\d/);
    expect(c.sql).toMatch(/"properties"\."county" = \$\d/);
    expect(c.sql).toMatch(/"properties"\."state" = \$\d/);
    expect(c.sql).toMatch(/"properties"\."status" in \(/);
    expect(c.sql).toMatch(/"properties"\."id" <> \$\d/);
    expect(c.sql).toMatch(/"properties"\."list_price" is not null or "properties"\."sold_price" is not null or "properties"\."market_value" is not null/);
    expect(c.sql).toMatch(/"properties"\."id" > \$\d/);
    expect(c.params).toEqual(expect.arrayContaining([ORG, "Travis", "TX", "sold", "listed", "owned", 99]));
    expect(c.params[c.params.length - 1]).toBe(1000);
    expectNoCap(c);
  });
});

describe("adoption: Pax's system context states the whole book", () => {
  it("every count and sum in the context comes from the aggregates, past 5000 of each kind", async () => {
    wire.route = (sql) => {
      if (!/group by/.test(sql)) return [];
      if (/from "leads"/.test(sql)) return [["new", "seller", 5000, "40"], ["dead", "buyer", 2000, "0"]];
      if (/from "properties"/.test(sql)) return [["owned", 6000, "5", "12000", "3000000"]];
      if (/from "deals"/.test(sql)) return [["negotiating", "acquisition", 5500, "1", "550000", "560000", "570000"]];
      if (/from "notes"/.test(sql)) return [["active", 5100, "900000", "45000", "1000000", "7"], ["paid_off", 100, "0", "0", "50000", "0"]];
      return [];
    };
    invalidateContextCache(ORG);
    const ctx = await getSystemContext(ORG);
    expect(ctx.modules.leads.totalCount).toBe(7000);
    expect(ctx.modules.leads.recentCount).toBe(40);
    expect(ctx.modules.leads.keyStats).toMatchObject({ byStatus: { new: 5000, dead: 2000 }, sellers: 5000, buyers: 2000 });
    expect(ctx.alerts.newLeads).toBe(5000);
    expect(ctx.modules.properties.totalCount).toBe(6000);
    expect(ctx.modules.properties.keyStats).toMatchObject({ totalAcres: 12000, totalValue: 3000000, owned: 6000 });
    expect(ctx.modules.deals.totalCount).toBe(5500);
    expect(ctx.modules.deals.keyStats.totalPipelineValue).toBe(550000);
    expect(ctx.modules.notes.totalCount).toBe(5200);
    expect(ctx.modules.notes.keyStats).toMatchObject({ active: 5100, totalPrincipal: 1050000, currentBalance: 900000 });
    expect(ctx.modules.finance).toMatchObject({ monthlyCashflow: 45000, activeNotesCount: 5100, totalOutstanding: 900000 });
    // The "recent items" are bounded in SQL: five, the week's newest.
    const lists = wire.calls.filter((c) => !/group by/.test(c.sql));
    expect(lists).toHaveLength(4);
    for (const c of lists) {
      expect(c.sql).toMatch(/limit \$\d+$/i);
      expect(c.params[c.params.length - 1]).toBe(5);
    }
    for (const c of wire.calls) expectNoCap(c);
  });
});
