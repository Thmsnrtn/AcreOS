// @vitest-environment jsdom
/**
 * DEFECT-0171 (W10.2b, group F) and DEFECT-0169.
 *
 * The route files of group F counted, ranked or acted on the capped
 * `storage.getLeads / getProperties / getDeals / getNotes` lists — an org's
 * NEWEST 5,000 rows — as if they were the whole book. Their questions now run
 * through server/storage/wholeOrgReadsF.ts. Each statement is rendered with
 * the real Postgres dialect and held to:
 *   (a) the org predicate, bound to THIS org;
 *   (b) the live-lead predicate wherever leads are read (and the capped
 *       getter's own filter for properties and deals);
 *   (c) no LIMIT 5000 — counts carry no LIMIT at all, top-N picks carry
 *       exactly their N, and whole-set reads page to the end.
 * Then: every function has a production caller in the route it serves
 * (a canonical read nobody calls is not a fix), and the offers page reads
 * its leads through the cursor walk, not page 1 of /api/leads (DEFECT-0169).
 *
 * jsdom because the DEFECT-0169 case renders the offers page's lead hook;
 * the server statements are rendered against a recording `db` mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PgDialect } from "drizzle-orm/pg-core";
import { and, eq, getTableName, sql, type SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { leads } from "@shared/schema";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

// ── A db that records each statement and answers from a queue ───────────────
type Recorded = {
  fields?: Record<string, unknown>;
  from?: unknown;
  where?: unknown;
  orderBy: unknown[];
  groupBy: unknown[];
  joins: Array<{ table: unknown; on: unknown }>;
  limit?: number;
};
const rec = vi.hoisted(() => ({ queries: [] as any[], answers: [] as unknown[][] }));

vi.mock("../../server/db", () => ({
  db: {
    select: (fields?: Record<string, unknown>) => {
      const q: any = { fields, orderBy: [], groupBy: [], joins: [] };
      rec.queries.push(q);
      const chain: any = {
        from: (t: unknown) => ((q.from = t), chain),
        where: (w: unknown) => ((q.where = w), chain),
        leftJoin: (table: unknown, on: unknown) => (q.joins.push({ table, on }), chain),
        orderBy: (...o: unknown[]) => (q.orderBy.push(...o), chain),
        groupBy: (...g: unknown[]) => (q.groupBy.push(...g), chain),
        limit: (n: number) => ((q.limit = n), chain),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(rec.answers.shift() ?? []).then(res, rej),
      };
      return chain;
    },
  },
}));

import * as F from "../../server/storage/wholeOrgReadsF";
import { LIST_READ_CAP } from "../../server/storage/listCap";
import { WHOLE_BOOK_PAGE } from "../../server/storage/wholeBookReads";

const ORG = 7;
const dialect = new PgDialect();
const render = (s: unknown) => dialect.sqlToQuery(s as SQL);
const table = (q: Recorded) => getTableName(q.from as never);
const queries = () => rec.queries as Recorded[];

/** The org predicate on `tbl`, bound to `orgId` (not merely present). */
function expectOrgScoped(where: unknown, tbl: string, orgId: number) {
  const w = render(where);
  const m = w.sql.match(new RegExp(`"${tbl}"\\."organization_id" = \\$(\\d+)`));
  expect(m, `no "${tbl}"."organization_id" predicate in: ${w.sql}`).not.toBeNull();
  expect(w.params[Number(m![1]) - 1]).toBe(orgId);
}
function expectLiveLeads(where: unknown) {
  expect(render(where).sql).toMatch(/"leads"\."deleted_at" is null/);
}
function expectLiveProperties(where: unknown) {
  expect(render(where).sql).toMatch(/"properties"\."status" != 'deleted'/);
}
function expectRealDeals(where: unknown) {
  const w = render(where);
  const m = w.sql.match(/"deals"\."status" not in \(\$(\d+)\)/);
  expect(m, w.sql).not.toBeNull();
  expect(w.params[Number(m![1]) - 1]).toBe("deleted");
}
const orderSql = (q: Recorded) => render(sql.join(q.orderBy as SQL[], sql`, `)).sql;

beforeEach(() => {
  rec.queries.length = 0;
  rec.answers.length = 0;
});

// (c) for every statement every test issues: never the list cap.
afterEach(() => {
  for (const q of queries()) {
    expect(q.limit).not.toBe(LIST_READ_CAP);
    expect(q.limit).not.toBe(LIST_READ_CAP + 1);
  }
});

describe("the predicate helpers are not decoration (canaries)", () => {
  it("an unscoped statement, or one scoped to another org, fails the org check", () => {
    expect(() => expectOrgScoped(sql`${leads.status} = 'new'`, "leads", ORG)).toThrow();
    expect(() => expectOrgScoped(eq(leads.organizationId, 99), "leads", ORG)).toThrow();
    expect(() => expectOrgScoped(eq(leads.organizationId, ORG), "leads", ORG)).not.toThrow();
  });
  it("a lead read without the live predicate fails the live check", () => {
    expect(() => expectLiveLeads(and(eq(leads.organizationId, ORG)))).toThrow();
  });
});

describe("lead figures — whole book, org-scoped, live", () => {
  it("staleFollowUpLeads: open, contactable, 7+ days uncontacted; never-contacted first; LIMIT n in SQL", async () => {
    const now = new Date("2026-10-05T12:00:00Z");
    await F.staleFollowUpLeads(ORG, now, 3);
    const [q] = queries();
    expect(table(q)).toBe("leads");
    expectOrgScoped(q.where, "leads", ORG);
    expectLiveLeads(q.where);
    const w = render(q.where);
    expect(w.sql).toMatch(/"leads"\."status" not in \(\$\d+, \$\d+\)/);
    expect(w.params).toEqual(expect.arrayContaining(["closed", "dead"]));
    expect(w.sql).toMatch(/"leads"\."do_not_contact" IS NOT TRUE/);
    expect(w.sql).toMatch(/"leads"\."last_contacted_at" IS NULL or "leads"\."last_contacted_at" <= \$\d+/);
    expect(w.params).toContain(new Date(now.getTime() - 7 * 86_400_000).toISOString());
    expect(orderSql(q)).toMatch(/^"leads"\."last_contacted_at" ASC NULLS FIRST, "leads"\."created_at" desc$/);
    expect(q.limit).toBe(3);
  });

  it("stalledLeadCount: a COUNT (no LIMIT) of open leads uncontacted since `before`", async () => {
    const before = new Date("2026-09-21T00:00:00Z");
    rec.answers.push([{ c: 6001 }]);
    expect(await F.stalledLeadCount(ORG, before)).toBe(6001);
    const [q] = queries();
    expectOrgScoped(q.where, "leads", ORG);
    expectLiveLeads(q.where);
    const w = render(q.where);
    expect(w.params).toEqual(expect.arrayContaining(["closed", "dead", "converted", before.toISOString()]));
    expect(w.sql).toMatch(/"leads"\."last_contacted_at" < \$\d+/);
    expect(q.limit).toBeUndefined();
  });

  it("bookPresence: live leads and non-deleted properties of this org", async () => {
    rec.answers.push([{ c: 0 }], [{ c: 2 }]);
    expect(await F.bookPresence(ORG)).toEqual({ hasLeads: false, hasProperties: true });
    const [l, p] = queries();
    expectOrgScoped(l.where, "leads", ORG);
    expectLiveLeads(l.where);
    expectOrgScoped(p.where, "properties", ORG);
    expectLiveProperties(p.where);
    expect([l.limit, p.limit]).toEqual([undefined, undefined]);
  });

  it("leadWeekOverWeek and tcpaLeadCounts count every live lead of the org", async () => {
    await F.leadWeekOverWeek(ORG, new Date());
    rec.answers.push([{ total: 6200, withConsent: 4100 }]);
    expect(await F.tcpaLeadCounts(ORG)).toEqual({ total: 6200, withConsent: 4100 });
    for (const q of queries()) {
      expect(table(q)).toBe("leads");
      expectOrgScoped(q.where, "leads", ORG);
      expectLiveLeads(q.where);
      expect(q.limit).toBeUndefined();
    }
    expect(render(queries()[1].fields!.withConsent).sql).toMatch(/filter \(where "leads"\."tcpa_consent" = true\)/);
  });

  it("topPriorityFigures: lead and note counts unlimited; the accepted deal is LIMIT 1, newest first", async () => {
    await F.topPriorityFigures(ORG, new Date());
    const byTable = Object.fromEntries(queries().map((q) => [table(q), q]));
    expectOrgScoped(byTable.leads.where, "leads", ORG);
    expectLiveLeads(byTable.leads.where);
    expect(byTable.leads.limit).toBeUndefined();
    expectOrgScoped(byTable.notes.where, "notes", ORG);
    expect(render(byTable.notes.where).sql).toMatch(/"notes"\."delinquency_status" IS DISTINCT FROM 'current'/);
    expect(byTable.notes.limit).toBeUndefined();
    expectOrgScoped(byTable.deals.where, "deals", ORG);
    expectRealDeals(byTable.deals.where);
    expect(render(byTable.deals.where).params).toEqual(expect.arrayContaining(["accepted", "in_escrow"]));
    expect(orderSql(byTable.deals)).toBe('"deals"."created_at" desc');
    expect(byTable.deals.limit).toBe(1);
  });

  it("teamKpiFigures counts live leads and real deals of the org", async () => {
    await F.teamKpiFigures(ORG, new Date());
    const byTable = Object.fromEntries(queries().map((q) => [table(q), q]));
    expectOrgScoped(byTable.leads.where, "leads", ORG);
    expectLiveLeads(byTable.leads.where);
    expectOrgScoped(byTable.deals.where, "deals", ORG);
    expectRealDeals(byTable.deals.where);
    expect([byTable.leads.limit, byTable.deals.limit]).toEqual([undefined, undefined]);
  });
});

// A raw sql`... ${date}` hands node-pg the JS Date, which it formats in the
// server's LOCAL zone; the column helpers bind toISOString() (UTC). The
// columns are `timestamp without time zone`, so the two disagree by the
// zone offset whenever the server is not on UTC. Every window binds the ISO
// string — checked over every part of every statement each read issues.
describe("time windows bind UTC ISO strings, never a JS Date", () => {
  const NOW = new Date("2026-10-05T12:00:00Z");
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const allParams = () =>
    queries().flatMap((q) =>
      [...Object.values(q.fields ?? {}), q.where, ...q.orderBy, ...q.joins.map((j) => j.table), ...q.joins.map((j) => j.on)]
        .filter((p) => p !== undefined)
        .flatMap((p) => render(sql`${p}`).params),
    );
  // Every export of the module that takes a Date. A new one belongs here.
  const WINDOWED: Record<string, { call: () => Promise<unknown>; expected: string[] }> = {
    staleFollowUpLeads: { call: () => F.staleFollowUpLeads(ORG, NOW, 3), expected: [iso(NOW.getTime() - 7 * DAY)] },
    stalledLeadCount: { call: () => F.stalledLeadCount(ORG, NOW), expected: [NOW.toISOString()] },
    leadWeekOverWeek: {
      call: () => F.leadWeekOverWeek(ORG, NOW),
      expected: [iso(NOW.getTime() - 7 * DAY), iso(NOW.getTime() - 14 * DAY)],
    },
    topPriorityFigures: { call: () => F.topPriorityFigures(ORG, NOW), expected: [NOW.toISOString()] },
    teamKpiFigures: { call: () => F.teamKpiFigures(ORG, NOW), expected: [NOW.toISOString()] },
    closedDealsClosingSince: { call: () => F.closedDealsClosingSince(ORG, NOW), expected: [NOW.toISOString()] },
  };

  it("the census is the module's Date-taking exports", () => {
    const s = src("server/storage/wholeOrgReadsF.ts");
    const dated = [...s.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
      .filter((m) => /:\s*Date\b/.test(m[2]))
      .map((m) => m[1]);
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.sort()).toEqual(Object.keys(WINDOWED).sort());
  });

  for (const [name, { call, expected }] of Object.entries(WINDOWED)) {
    it(`${name}: no Date param, and the window bound as its ISO string`, async () => {
      await call();
      const params = allParams();
      expect(params.length).toBeGreaterThan(0);
      expect(params.filter((p) => p instanceof Date)).toEqual([]);
      for (const e of expected) expect(params).toContain(e);
    });
  }
});

describe("skip tracing — untraced is decided in SQL over every live lead", () => {
  const FINISHED = ["completed", "no_results"];

  it("untracedLeadBatch: live leads with no finished trace OF THIS ORG; LIMIT cap, and an unlimited total", async () => {
    rec.answers.push([], [{ c: 7300 }]);
    const out = await F.untracedLeadBatch(ORG, 50, FINISHED);
    expect(out.untracedTotal).toBe(7300);
    const [batch, total] = queries();
    for (const q of [batch, total]) {
      expectOrgScoped(q.where, "leads", ORG);
      expectLiveLeads(q.where);
      const w = render(q.where);
      expect(w.sql).toMatch(
        /not exists \(select 1 from "skip_traces" where "skip_traces"\."organization_id" = \$(\d+) and "skip_traces"\."lead_id" = "leads"\."id" and "skip_traces"\."status" in \(\$\d+, \$\d+\)\)/,
      );
      const inner = w.sql.match(/"skip_traces"\."organization_id" = \$(\d+)/)!;
      expect(w.params[Number(inner[1]) - 1]).toBe(ORG);
      expect(w.params).toEqual(expect.arrayContaining(FINISHED));
    }
    expect(batch.limit).toBe(50);
    expect(total.limit).toBeUndefined();
  });

  // Single pass: this org's trace rows are grouped once per lead and LEFT
  // JOINed, not probed by a correlated EXISTS per lead per count (W10.2b
  // audit: skip_traces has no lead_id / organization_id index, so the
  // per-row SubPlans made GET /stats O(leads x traces)).
  it("skipTraceLeadCounts: one LEFT JOIN to this org's trace rows grouped by lead — no EXISTS in the select list", async () => {
    rec.answers.push([{ total: 6400, traced: 5200, found: 3100 }]);
    expect(await F.skipTraceLeadCounts(ORG, FINISHED)).toEqual({ totalLeads: 6400, tracedCount: 5200, foundCount: 3100 });
    expect(queries()).toHaveLength(1);
    const [q] = queries();
    expect(table(q)).toBe("leads");
    expectOrgScoped(q.where, "leads", ORG);
    expectLiveLeads(q.where);
    for (const [key, f] of Object.entries(q.fields!)) {
      expect(render(f).sql, `${key} still probes per row`).not.toMatch(/\bexists\b|\bselect\b/i);
    }
    expect(render(q.fields!.total).sql).toBe("count(*)");
    expect(render(q.fields!.traced).sql).toBe('count(*) filter (where "lead_traces"."traced")');
    expect(render(q.fields!.found).sql).toBe('count(*) filter (where "lead_traces"."found")');

    expect(q.joins).toHaveLength(1);
    const sub = render(sql`${q.joins[0].table}`);
    // The inner org predicate stays: another org's trace on a lead id never counts.
    const inner = sub.sql.match(/from "skip_traces" where \("skip_traces"\."organization_id" = \$(\d+)/);
    expect(inner, sub.sql).not.toBeNull();
    expect(sub.params[Number(inner![1]) - 1]).toBe(ORG);
    expect(sub.sql).toMatch(/group by "skip_traces"\."lead_id"\) "lead_traces"$/);
    // traced = any finished row; found = any "completed" row — the reference
    // model's two sets (finishedTraceLeadIds / status === "completed").
    const traced = sub.sql.match(/bool_or\("skip_traces"\."status" in \(\$(\d+), \$(\d+)\)\) as "traced"/)!;
    expect(traced, sub.sql).not.toBeNull();
    expect([sub.params[Number(traced[1]) - 1], sub.params[Number(traced[2]) - 1]]).toEqual(FINISHED);
    const found = sub.sql.match(/bool_or\("skip_traces"\."status" = \$(\d+)\) as "found"/)!;
    expect(found, sub.sql).not.toBeNull();
    expect(sub.params[Number(found[1]) - 1]).toBe("completed");
    expect(render(q.joins[0].on).sql).toBe('"lead_traces"."lead_id" = "leads"."id"');
    expect(q.groupBy).toEqual([]); // one row out: the grouping is inside the join, per lead
    expect(q.limit).toBeUndefined();
  });
});

describe("property reads — whole book, org-scoped, not deleted", () => {
  it("oldestListedProperties: listed, oldest update first, LIMIT n", async () => {
    await F.oldestListedProperties(ORG, 2);
    const [q] = queries();
    expectOrgScoped(q.where, "properties", ORG);
    expectLiveProperties(q.where);
    expect(render(q.where).params).toContain("listed");
    expect(render(q.where).sql).toMatch(/"properties"\."updated_at" is not null/);
    expect(orderSql(q)).toBe('"properties"."updated_at" asc');
    expect(q.limit).toBe(2);
  });

  it("propertiesNearPoint: a bounding box that holds every point within the radius, excluding the subject", async () => {
    const lat = 35.2, lng = -111.6;
    await F.propertiesNearPoint(ORG, lat, lng, 0.5, 42);
    const [q] = queries();
    expectOrgScoped(q.where, "properties", ORG);
    expectLiveProperties(q.where);
    const w = render(q.where);
    expect(w.sql).toMatch(/"properties"\."id" <> \$\d+/);
    expect(w.params).toContain(42);
    const nums = w.params.filter((p): p is number => typeof p === "number" && !Number.isInteger(p));
    const [minLat, maxLat, minLng, maxLng] = nums;
    // 0.5 mile due north and due east of the subject both sit inside the box.
    expect(minLat).toBeLessThan(lat - 0.5 / 69);
    expect(maxLat).toBeGreaterThan(lat + 0.5 / 69);
    const eastDeg = 0.5 / (69 * Math.cos((lat * Math.PI) / 180));
    expect(minLng).toBeLessThan(lng - eastDeg);
    expect(maxLng).toBeGreaterThan(lng + eastDeg);
    expect(q.limit).toBeUndefined();
  });

  it("searchOrgParcels: ILIKE over the four fields, LIKE-escaped, newest first, LIMIT n", async () => {
    await F.searchOrgParcels(ORG, "50%_off", 50);
    const [q] = queries();
    expectOrgScoped(q.where, "properties", ORG);
    expectLiveProperties(q.where);
    const w = render(q.where);
    for (const col of ["address", "apn", "county", "state"]) expect(w.sql).toContain(`"properties"."${col}" ilike`);
    expect(w.params).toContain("%50\\%\\_off%");
    expect(orderSql(q)).toBe('"properties"."created_at" desc');
    expect(q.limit).toBe(50);
  });

  it("propertyCountsByCounty: GROUP BY state, county — no LIMIT", async () => {
    rec.answers.push([{ state: "AZ", county: "Coconino", propertyCount: 6100 }]);
    expect(await F.propertyCountsByCounty(ORG)).toEqual([{ state: "AZ", county: "Coconino", propertyCount: 6100 }]);
    const [q] = queries();
    expectOrgScoped(q.where, "properties", ORG);
    expectLiveProperties(q.where);
    expect(render(sql.join(q.groupBy as SQL[], sql`, `)).sql).toBe('"properties"."state", "properties"."county"');
    expect(q.limit).toBeUndefined();
  });

  it("dueDiligenceStatusRows pages past the first page and returns newest first", async () => {
    const page1 = Array.from({ length: WHOLE_BOOK_PAGE }, (_, i) => ({
      id: i + 1,
      apn: `A${i + 1}`,
      dueDiligenceStatus: "pending",
      createdAt: new Date(Date.UTC(2020, 0, 1) + i * 60_000),
    }));
    const page2 = [{ id: 1001, apn: "A1001", dueDiligenceStatus: null, createdAt: new Date(Date.UTC(2026, 0, 1)) }];
    rec.answers.push(page1, page2);
    const rows = await F.dueDiligenceStatusRows(ORG);
    expect(rows).toHaveLength(WHOLE_BOOK_PAGE + 1);
    expect(rows[0].id).toBe(1001);
    expect(rows[rows.length - 1].id).toBe(1);
    const [first, second] = queries();
    for (const q of [first, second]) {
      expectOrgScoped(q.where, "properties", ORG);
      expectLiveProperties(q.where);
      expect(q.limit).toBe(WHOLE_BOOK_PAGE);
    }
    expect(render(second.where).params).toContain(WHOLE_BOOK_PAGE); // keyset: id > last id of page 1
  });

  it("propertiesMissingParcelBoundary: the newest N eligible rows, and a whole-book count", async () => {
    rec.answers.push([], [{ total: 6200 }]);
    const r = await F.propertiesMissingParcelBoundary(ORG, 100);
    expect(r.total).toBe(6200);
    const [rows, total] = queries();
    for (const q of [rows, total]) {
      expectOrgScoped(q.where, "properties", ORG);
      expectLiveProperties(q.where);
      const w = render(q.where).sql;
      expect(w).toMatch(/"properties"\."parcel_boundary" IS NULL/);
      for (const col of ["apn", "state", "county"]) expect(w).toContain(`coalesce("properties"."${col}", '') <> ''`);
    }
    // The batch: exactly N, newest (by id) first — the order the cursor walks.
    expect(rows.limit).toBe(100);
    expect(orderSql(rows)).toBe('"properties"."id" desc');
    expect(render(rows.where).sql).not.toMatch(/"properties"\."id" </);
    // The count: no LIMIT, no row read — and never narrowed by the cursor.
    expect(total.limit).toBeUndefined();
    expect(Object.keys(total.fields ?? {})).toEqual(["total"]);
  });

  it("propertiesMissingParcelBoundary below a cursor: the batch continues under it, the count stays whole-book", async () => {
    rec.answers.push([], [{ total: 6200 }]);
    await F.propertiesMissingParcelBoundary(ORG, 100, 6101);
    const [rows, total] = queries();
    const w = render(rows.where);
    const m = w.sql.match(/"properties"\."id" < \$(\d+)/);
    expect(m, w.sql).not.toBeNull();
    expect(w.params[Number(m![1]) - 1]).toBe(6101);
    expect(render(total.where).sql).not.toMatch(/"properties"\."id" </);
    expectOrgScoped(rows.where, "properties", ORG);
  });
});

describe("deal reads — whole book, org-scoped, administrative rows excluded", () => {
  it("newestPendingOfferDeals and latestClosedDeal are ORDER BY + LIMIT in SQL", async () => {
    await F.newestPendingOfferDeals(ORG, 2);
    await F.latestClosedDeal(ORG);
    const [pending, latest] = queries();
    for (const q of [pending, latest]) {
      expectOrgScoped(q.where, "deals", ORG);
      expectRealDeals(q.where);
    }
    expect(render(pending.where).params).toEqual(expect.arrayContaining(["offer_sent", "negotiating"]));
    expect(orderSql(pending)).toBe('"deals"."created_at" desc');
    expect(pending.limit).toBe(2);
    expect(orderSql(latest)).toBe('"deals"."updated_at" DESC NULLS LAST, "deals"."created_at" desc');
    expect(latest.limit).toBe(1);
  });

  it("closedDealsClosingSince reads closed deals inside the window, with the status the caller filters on", async () => {
    const since = new Date("2026-07-01T00:00:00Z");
    await F.closedDealsClosingSince(ORG, since);
    await F.dealPresence(ORG);
    const [win, presence] = queries();
    expectOrgScoped(win.where, "deals", ORG);
    expectRealDeals(win.where);
    expect(render(win.where).params).toEqual(expect.arrayContaining(["closed", since.toISOString()]));
    expect(render(win.where).sql).toMatch(/"deals"\."closing_date" >= \$\d+/);
    expect(Object.keys(win.fields!)).toEqual(expect.arrayContaining(["status", "closingDate", "acceptedAmount", "offerAmount"]));
    expect(win.limit).toBeUndefined();
    expectOrgScoped(presence.where, "deals", ORG);
    expect(presence.limit).toBeUndefined();
  });
});

// ── Adoption: each read is what its route actually calls ───────────────────
const ROOT = resolve(__dirname, "../..");
const src = (f: string) => stripComments(readFileSync(resolve(ROOT, f), "utf8"));

const CALLERS: Record<string, string[]> = {
  "server/routes-micro-features.ts": ["propertiesNearPoint", "searchOrgParcels", "propertyCountsByCounty", "dueDiligenceStatusRows", "topPriorityFigures"],
  "server/routes-dashboard.ts": ["leadWeekOverWeek", "closedDealsClosingSince", "dealPresence", "staleFollowUpLeads", "newestPendingOfferDeals", "oldestListedProperties"],
  "server/routes-today.ts": ["staleFollowUpLeads", "oldestListedProperties", "stalledLeadCount", "bookPresence"],
  "server/routes-skip-tracing.ts": ["untracedLeadBatch", "skipTraceLeadCounts"],
  "server/routes-analytics.ts": ["teamKpiFigures"],
  "server/routes-properties.ts": ["propertiesMissingParcelBoundary"],
  "server/routes-platform-features.ts": ["latestClosedDeal"],
  "server/routes-import-export.ts": ["tcpaLeadCounts"],
};

describe("adoption — the routes call the whole-book reads", () => {
  for (const [file, fns] of Object.entries(CALLERS)) {
    it(`${file} calls ${fns.join(", ")}`, () => {
      const s = src(file);
      for (const fn of fns) expect(s, `${file} no longer calls ${fn}`).toMatch(new RegExp(`\\b${fn}\\(`));
    });
  }

  it("every export of wholeOrgReadsF has a production caller listed above (no canonical read with zero callers)", () => {
    const exported = [...src("server/storage/wholeOrgReadsF.ts").matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThanOrEqual(19); // vacuity: the parser still sees the module
    const called = new Set(Object.values(CALLERS).flat());
    expect(exported.filter((fn) => !called.has(fn))).toEqual([]);
  });
});

// ── DEFECT-0169: the offers page's leads are the whole book ─────────────────
const LEAD_LIST_READ = new RegExp(
  String.raw`\b(?:fetch|fetchJsonArray|strictFetch|fetchJSON|apiRequest)(?:<[^<>()]*>)?\(\s*(?:["']GET["']\s*,\s*)?["'\x60]\/api\/leads(?:\?[^"'\x60]*)?["'\x60]`,
);

describe("DEFECT-0169 — the offers page reads every lead, not page 1", () => {
  it("canary: the read shape that was the defect is caught", () => {
    expect(LEAD_LIST_READ.test(`queryFn: () => fetchJsonArray<Lead>('/api/leads'),`)).toBe(true);
    expect(LEAD_LIST_READ.test(`await apiRequest("GET", "/api/leads?pageSize=100")`)).toBe(true);
    expect(LEAD_LIST_READ.test(`fetch("/api/leads/paginated?limit=250")`)).toBe(false);
  });

  it("offers.tsx has no first-page lead read, and its page reads leads through useLeads()", () => {
    const s = src("client/src/pages/offers.tsx");
    expect(s).not.toMatch(LEAD_LIST_READ);
    const hook = s.slice(s.indexOf("export function useOfferLeads"), s.indexOf("export default function OffersPage"));
    expect(hook).toMatch(/useLeads\(\)/);
    expect(s.slice(s.indexOf("export default function OffersPage"))).toMatch(/useOfferLeads\(\)/);
  });

  describe("behaviour: the hook walks the cursor to the last page", () => {
    let container: HTMLDivElement;
    let root: Root;
    const urls: string[] = [];
    const lead = (id: number) => ({ id, firstName: "L", lastName: String(id), status: "new" });
    type Page = { data: unknown[]; nextCursor: string | null; hasMore: boolean; total?: number };
    // What /api/leads/paginated answers for a cursor (null = first page); a
    // number is an HTTP error status.
    let serve: (cursor: number | null) => Page | number;
    const twoPages = (cursor: number | null): Page =>
      cursor === null
        ? { data: Array.from({ length: 250 }, (_, i) => lead(i + 1)), nextCursor: "250", hasMore: true, total: 260 }
        : { data: Array.from({ length: 10 }, (_, i) => lead(251 + i)), nextCursor: null, hasMore: false, total: 260 };
    // A book bigger than the hook's page ceiling: every page says "more".
    const endless = (total: number | undefined) => (cursor: number | null): Page => {
      const from = cursor ?? 0;
      return {
        data: Array.from({ length: 250 }, (_, i) => lead(from + i + 1)),
        nextCursor: String(from + 250),
        hasMore: true,
        ...(total !== undefined ? { total } : {}),
      };
    };

    beforeEach(() => {
      urls.length = 0;
      serve = twoPages;
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(String(input), "http://localhost");
          urls.push(url.pathname + url.search);
          const cursor = url.searchParams.get("cursor");
          const body = serve(cursor === null ? null : Number(cursor));
          if (typeof body === "number") {
            // A failure takes a moment, as on a network: the fetching state renders first.
            await new Promise((r) => setTimeout(r, 15));
            return new Response("{}", { status: body });
          }
          return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }),
      );
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    });

    type Seen = {
      leads: Array<{ id: number }> | undefined;
      complete: boolean;
      truncated: { shown: number; total: number | null } | null;
      error: Error | null;
    };
    /** Mount the hook and its status line; tick until `done` or the budget runs out. */
    async function mount(done: (s: Seen) => boolean, ticks = 600) {
      const { useOfferLeads, OfferLeadsStatus } = await import("../../client/src/pages/offers");
      const box = { seen: { leads: undefined, complete: false, truncated: null, error: null } as Seen };
      const Probe = () => {
        const state = useOfferLeads();
        box.seen = state as unknown as Seen;
        return React.createElement(OfferLeadsStatus, { state });
      };
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Probe)));
      });
      await tick(() => done(box.seen), ticks);
      return box;
    }
    async function tick(done: () => boolean, ticks: number) {
      for (let i = 0; i < ticks && !done(); i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 5));
        });
      }
    }

    it("surfaces the 260th lead (page 2), and only once the walk is complete", async () => {
      const box = await mount((s) => s.complete);
      expect(box.seen.complete).toBe(true);
      expect(box.seen.truncated).toBeNull();
      expect(box.seen.leads).toHaveLength(260);
      expect(box.seen.leads!.some((l) => l.id === 260)).toBe(true);
      expect(urls.every((u) => u.startsWith("/api/leads/paginated?"))).toBe(true);
      expect(urls.some((u) => u.includes("cursor=250"))).toBe(true);
      expect(container.querySelector('[data-testid="offer-leads-truncated"]')).toBeNull();
    });

    it("a walk stopped at the hook's page ceiling is NOT complete — it says first N of the server's total", async () => {
      serve = endless(50_000);
      const box = await mount((s) => s.truncated !== null || s.complete);
      expect(box.seen.complete).toBe(false);
      const shown = box.seen.leads!.length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(50_000);
      expect(box.seen.truncated).toEqual({ shown, total: 50_000 });
      const notice = container.querySelector('[data-testid="offer-leads-truncated"]')!;
      expect(notice.textContent).toContain(`first ${shown.toLocaleString()} of ${(50_000).toLocaleString()} leads`);
    });

    it("without a server total, the ceiling still reads as truncated — and no total is invented", async () => {
      serve = endless(undefined);
      const box = await mount((s) => s.truncated !== null || s.complete);
      expect(box.seen.complete).toBe(false);
      const shown = box.seen.leads!.length;
      expect(box.seen.truncated).toEqual({ shown, total: null });
      const text = container.querySelector('[data-testid="offer-leads-truncated"]')!.textContent!;
      expect(text).toContain(`first ${shown.toLocaleString()} leads.`);
      expect(text).not.toMatch(/ of [\d,]+ leads/);
    });

    it("a failed page settles into a retryable error — not 'loading' forever, and no refetch loop", async () => {
      serve = (cursor) => (cursor === null ? twoPages(null) : 500);
      const box = await mount((s) => s.error !== null);
      expect(box.seen.error).not.toBeNull();
      expect(box.seen.complete).toBe(false);
      expect(box.seen.truncated).toBeNull();
      expect(container.querySelector('[data-testid="offer-leads-error"]')).not.toBeNull();
      const fetchesAtError = urls.length;
      await tick(() => false, 40);
      expect(urls.length).toBe(fetchesAtError); // settled: the failing page is not re-fired on its own

      serve = twoPages;
      const retry = container.querySelector<HTMLButtonElement>('[data-testid="offer-leads-error-retry-button"]')!;
      expect(retry).not.toBeNull();
      await act(async () => retry.click());
      await tick(() => box.seen.complete, 600);
      expect(box.seen.error).toBeNull();
      expect(box.seen.complete).toBe(true);
      expect(box.seen.leads).toHaveLength(260);
    });
  });
});
