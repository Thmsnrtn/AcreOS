/**
 * DEFECT-0171 (group G) — the alerts, agents, digests, nurturer, sample seeder
 * and month-in-review email read their figures and row sets over the WHOLE
 * org, not the newest 5,000 rows.
 *
 * Every export of server/storage/wholeOrgReadsG.ts is exercised against a
 * recording db stand-in, and each statement it issues is rendered to SQL:
 *   (a) every WHERE carries the org predicate with the caller's org id;
 *   (b) every statement over `leads` carries the live-lead predicate;
 *   (c) no statement is limited to the capped getters' 5,000 (+1) — the only
 *       limits are the keyset page (1000) and an explicit top-N the caller
 *       passes (mostUrgentAgingLeads, beside a whole-book count);
 *   (d) no timestamp is bound as a JS Date in raw SQL — node-pg would format
 *       it in the process's local zone (W10.2b audit);
 * and a row-returning read pages past 5,000 to the end.
 *
 * Population: the export list of the module itself — a new export with no
 * case here fails the vacuity check. Adoption: every export has a production
 * caller (a canonical read nothing calls is not canonical).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { stripComments } from "../helpers/stripComments";

interface Stmt {
  table: unknown;
  /** The select list, when one was passed (aggregates bind values there too). */
  fields?: Record<string, unknown>;
  where?: SQL;
  limit?: number;
  groupBy: boolean;
  orderBy: boolean;
  /** The ORDER BY terms, rendered by the tests that pin an order. */
  orderItems?: unknown[];
}

const h = vi.hoisted(() => ({
  stmts: [] as Stmt[],
  /** Rows the n-th statement resolves to; default []. */
  respond: (_i: number, _s: Stmt): unknown[] => [],
}));

vi.mock("../../server/db", () => {
  const select = (fields?: Record<string, unknown>) => {
    const stmt: Stmt = { table: undefined, fields, groupBy: false, orderBy: false };
    const index = h.stmts.length;
    h.stmts.push(stmt);
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => {
      stmt.table = t;
      return q;
    };
    q.where = (w: SQL) => {
      stmt.where = w;
      return q;
    };
    q.groupBy = () => {
      stmt.groupBy = true;
      return q;
    };
    q.orderBy = (...items: unknown[]) => {
      stmt.orderBy = true;
      stmt.orderItems = items;
      return q;
    };
    q.limit = (n: number) => {
      stmt.limit = n;
      return q;
    };
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(() => h.respond(index, stmt)).then(res, rej);
    return q;
  };
  return { db: { select } };
});

import * as G from "../../server/storage/wholeOrgReadsG";
import { ReadCeilingError } from "../../server/storage/readCeiling";
import { leads } from "@shared/schema";

const ORG = 4242;
const dialect = new PgDialect();
const render = (w: SQL) => dialect.sqlToQuery(w);
/** Values bound by raw sql`` in the select list (a column is not SQL). */
const fieldParams = (s: Stmt) =>
  Object.values(s.fields ?? {}).flatMap((f) => (f instanceof SQL ? dialect.sqlToQuery(f).params : []));

/** One invocation per export; `leadsRead` = the export reads the leads table. */
const CASES: Record<string, { call: () => Promise<unknown>; leadsRead: boolean }> = {
  leadStageFigures: { call: () => G.leadStageFigures(ORG), leadsRead: true },
  mostUrgentAgingLeads: { call: () => G.mostUrgentAgingLeads(ORG, { limit: 100, excludeIds: [9] }), leadsRead: true },
  agingLeadCount: { call: () => G.agingLeadCount(ORG, new Date(), [9]), leadsRead: true },
  focusLeadCandidates: { call: () => G.focusLeadCandidates(ORG, new Date()), leadsRead: true },
  digestLeadFigures: { call: () => G.digestLeadFigures(ORG, new Date()), leadsRead: true },
  sampleLeadRows: { call: () => G.sampleLeadRows(ORG, "sample_data"), leadsRead: true },
  samplePropertyRows: { call: () => G.samplePropertyRows(ORG, "SAMPLE-"), leadsRead: false },
  countyPropertyFigures: { call: () => G.countyPropertyFigures(ORG, "tx", "Travis"), leadsRead: false },
  bookSummaryCounts: { call: () => G.bookSummaryCounts(ORG), leadsRead: true },
  dealsOnProperties: { call: () => G.dealsOnProperties(ORG, [1, 2]), leadsRead: false },
  dealsClosedBetween: { call: () => G.dealsClosedBetween(ORG, new Date(0), new Date()), leadsRead: false },
  openPipelineTotals: { call: () => G.openPipelineTotals(ORG), leadsRead: false },
  recentlyInactiveNoteTotals: { call: () => G.recentlyInactiveNoteTotals(ORG, new Date()), leadsRead: false },
  newlyDelinquentNoteIds: { call: () => G.newlyDelinquentNoteIds(ORG), leadsRead: false },
  noteRiskTotals: { call: () => G.noteRiskTotals(ORG), leadsRead: false },
  pastDueActiveNotes: { call: () => G.pastDueActiveNotes(ORG), leadsRead: false },
  delinquentNoteTotals: { call: () => G.delinquentNoteTotals(ORG), leadsRead: false },
  activeNoteReviewFigures: { call: () => G.activeNoteReviewFigures(ORG), leadsRead: false },
  notesOnProperties: { call: () => G.notesOnProperties(ORG, [1, 2]), leadsRead: false },
};

beforeEach(() => {
  h.stmts.length = 0;
  h.respond = () => [];
});

describe("wholeOrgReadsG — every statement is org-scoped, live, and uncapped", () => {
  it("vacuity: every export has a case, and every case is an export", () => {
    const exported = Object.keys(G).filter((k) => typeof (G as unknown as Record<string, unknown>)[k] === "function").sort();
    expect(exported).toEqual(Object.keys(CASES).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: org predicate${c.leadsRead ? ", live-lead predicate" : ""}, no 5,000 cap`, async () => {
      await c.call();
      expect(h.stmts.length, `${name} issued no statement`).toBeGreaterThan(0);
      let sawLeads = false;
      for (const s of h.stmts) {
        expect(s.where, `${name}: a statement with no WHERE`).toBeDefined();
        const q = render(s.where!);
        // (a) the org predicate, bound to the caller's org.
        const m = q.sql.match(/"organization_id" = \$(\d+)/);
        expect(m, `${name}: no org predicate in ${q.sql}`).not.toBeNull();
        expect(q.params[Number(m![1]) - 1]).toBe(ORG);
        // (b) live leads.
        if (s.table === leads) {
          sawLeads = true;
          expect(q.sql, `${name}: a leads read without the live predicate`).toMatch(/"deleted_at" is null/i);
        }
        // (c) no capped limit — only the keyset page or a small explicit top-N.
        if (s.limit !== undefined) expect(s.limit).toBeLessThanOrEqual(1000);
        // (d) every bound value — WHERE and select list — is a non-Date.
        for (const p of [...q.params, ...fieldParams(s)]) {
          expect(p, `${name}: a Date bound in raw SQL`).not.toBeInstanceOf(Date);
        }
      }
      expect(sawLeads).toBe(c.leadsRead);
    });
  }
});

describe("row reads page to the end", () => {
  it("focusLeadCandidates returns all 6,200 candidates across seven keyset pages", async () => {
    const TOTAL = 6200;
    h.respond = (_i, s) => {
      const after = Number(render(s.where!).params.at(-1)); // gt(leads.id, afterId) is the last predicate
      const start = Number.isFinite(after) ? after : 0;
      const rows = [];
      for (let id = start + 1; id <= Math.min(start + 1000, TOTAL); id++) rows.push({ id });
      return rows;
    };
    const rows = await G.focusLeadCandidates(ORG, new Date());
    expect(rows.length).toBe(TOTAL);
    expect(h.stmts.length).toBe(7);
    expect(rows[0].id).toBe(1); // the OLDEST lead — the one the cap dropped — is there
  });

  it("focusLeadCandidates reads only the scorer's columns, never select *", async () => {
    await G.focusLeadCandidates(ORG, new Date());
    expect(Object.keys(h.stmts[0].fields ?? {}).sort()).toEqual(
      ["createdAt", "emailClicks", "emailOpens", "id", "lastContactedAt", "responses", "source", "status"],
    );
  });
});

describe("the aging list is ranked and bounded in SQL", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const iso = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("grades urgency with the in-memory rule's order and cutoffs, over live non-terminal leads", async () => {
    await G.mostUrgentAgingLeads(ORG, { limit: 100, now });
    const q = render(h.stmts[0].where!);
    expect(q.sql).toMatch(/"status" IS NULL OR "leads"\."status" NOT IN \(\$\d+, \$\d+\)/);
    expect(q.params).toEqual(expect.arrayContaining(["closed", "dead"]));
    // hot ≥3 days → 0, warm ≥7 → 1, any ≥14 → 2; no last touch reads as
    // stalest. Each cutoff is bound to ITS branch, with `<=` (a whole N days
    // or more) — swapping hot and warm, or `<=` for `<`, must fail here.
    const touch = String.raw`coalesce\("leads"\."last_contacted_at", "leads"\."created_at"\)`;
    const branch = (stage: string | null, rank: number) =>
      new RegExp(
        (stage ? String.raw`= '${stage}' and ` : String.raw`when `) +
          String.raw`\(${touch} IS NULL OR ${touch} <= \$(\d+)\) then ${rank}\b`,
      );
    for (const [stage, rank, days] of [["hot", 0, 3], ["warm", 1, 7], [null, 2, 14]] as const) {
      const m = q.sql.match(branch(stage, rank));
      expect(m, `${stage ?? "any"} → ${rank}: ${q.sql}`).not.toBeNull();
      expect(q.params[Number(m![1]) - 1], `${stage ?? "any"} cutoff`).toBe(iso(days));
    }
    expect(q.sql).toMatch(/case when .*= 'hot' and .*then 0 when .*= 'warm' and .*then 1 when .*then 2 end\) IS NOT NULL/);
    // Most urgent first, then stalest (no touch at all first), then id.
    const order = (h.stmts[0].orderItems ?? []).map((o) => render(o as SQL).sql);
    expect(order).toHaveLength(3);
    expect(order[0]).toMatch(/^\(case when .* end\) asc$/);
    expect(order[1]).toBe(`coalesce("leads"."last_contacted_at", "leads"."created_at") asc nulls first`);
    expect(order[2]).toBe(`"leads"."id" asc`);
    expect(h.stmts[0].limit).toBe(100);
  });

  it("maps the rank to the urgency and the last touch to contact-else-created", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    h.respond = () => [
      { id: 1, firstName: "A", lastName: null, nurturingStage: "hot", score: 90, lastContactedAt: null, createdAt: created, rank: 0 },
      { id: 2, firstName: "B", lastName: "C", nurturingStage: "warm", score: 60, lastContactedAt: created, createdAt: null, rank: 1 },
      { id: 3, firstName: "D", lastName: "E", nurturingStage: "new", score: null, lastContactedAt: null, createdAt: null, rank: "2" },
    ];
    const rows = await G.mostUrgentAgingLeads(ORG, { limit: 100, now });
    expect(rows.map((r) => [r.id, r.urgency, r.lastTouch])).toEqual([
      [1, "urgent", created],
      [2, "warning", created],
      [3, "info", null],
    ]);
  });

  it("leads already alerted are excluded from both the list and the count", async () => {
    await G.mostUrgentAgingLeads(ORG, { limit: 50, now, excludeIds: [7, 8] });
    await G.agingLeadCount(ORG, now, [7, 8]);
    expect(h.stmts).toHaveLength(2);
    for (const s of h.stmts) {
      const q = render(s.where!);
      expect(q.sql).toMatch(/"id" not in \(\$\d+, \$\d+\)/);
      expect(q.params).toEqual(expect.arrayContaining([7, 8]));
    }
  });

  it("agingLeadCount is one aggregate with no limit, over the same predicate", async () => {
    h.respond = () => [{ n: "12345" }];
    expect(await G.agingLeadCount(ORG, now)).toBe(12345);
    expect(h.stmts).toHaveLength(1);
    expect(h.stmts[0].limit).toBeUndefined();
    expect(render(h.stmts[0].where!).sql).toMatch(/then 2 end\) IS NOT NULL/);
  });
});

describe("timestamps in raw SQL are bound as UTC ISO strings (W10.2b audit)", () => {
  // A fixed instant: the bound value must be exactly its ISO form, whatever
  // the process's local zone is.
  const at = new Date("2026-10-05T03:30:00Z");

  it("leadStageFigures' follow-up cutoff (in the select list)", async () => {
    await G.leadStageFigures(ORG, at);
    const due = h.stmts[0].fields?.due;
    expect(due).toBeInstanceOf(SQL);
    const q = dialect.sqlToQuery(due as SQL);
    expect(q.sql).toMatch(/"next_follow_up_at" <= \$\d+/);
    expect(q.params).toEqual([at.toISOString()]);
  });

  it("recentlyInactiveNoteTotals' since", async () => {
    await G.recentlyInactiveNoteTotals(ORG, at);
    const q = render(h.stmts[0].where!);
    expect(q.sql).toMatch(/"updated_at" >= \$\d+/);
    expect(q.params).toContain(at.toISOString());
  });

  it("focusLeadCandidates' 24-hour cutoff", async () => {
    await G.focusLeadCandidates(ORG, at);
    const q = render(h.stmts[0].where!);
    expect(q.sql).toMatch(/\("leads"\."last_contacted_at" is null or "leads"\."last_contacted_at" < \$\d+\)/);
    expect(q.params).toContain(at.toISOString());
  });
});

describe("a read past the ceiling is refused with the one neutral, 413 error", () => {
  it("G's pager throws ReadCeilingError, not a plain Error, and does not say export", async () => {
    h.respond = (_i, s) => {
      const after = Number(render(s.where!).params.at(-1));
      const start = Number.isFinite(after) ? after : 0;
      return Array.from({ length: 1000 }, (_, k) => ({ id: start + k + 1 }));
    };
    const err = await G.focusLeadCandidates(ORG, new Date()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadCeilingError);
    expect((err as ReadCeilingError).statusCode).toBe(413);
    expect((err as Error).message).toMatch(/exceeds 250,000 focus-list leads rows.*nothing was truncated/);
    expect((err as Error).message).not.toMatch(/export/i);
  });
});

describe("the getters' own filters are kept", () => {
  it("deal reads exclude administrative (deleted) deals", async () => {
    await G.openPipelineTotals(ORG);
    const q = render(h.stmts[0].where!);
    expect(q.sql).toMatch(/"status" not in/i);
    expect(q.params).toEqual(expect.arrayContaining(["deleted", "closed", "cancelled"]));
  });

  it("property reads exclude soft-deleted properties", async () => {
    await G.countyPropertyFigures(ORG, "tx", "Travis");
    const q = render(h.stmts[0].where!);
    expect(q.sql).toMatch(/"status" != 'deleted'/);
    expect(q.params).toEqual(expect.arrayContaining(["TX", "travis"]));
  });

  it("aggregates sum the grouped rows past 5,000", async () => {
    h.respond = () => [
      { stage: "cold", n: 4000, scoreSum: "40000", scored: "4000", due: "10" },
      { stage: "new", n: 2500, scoreSum: "0", scored: "0", due: "5" },
    ];
    expect(await G.leadStageFigures(ORG)).toEqual({
      total: 6500,
      byStage: { cold: 4000, new: 2500 },
      scoreSum: 40000,
      scoredCount: 4000,
      followUpDue: 15,
    });
  });
});

describe("adoption: every export has a production caller in group G's files", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const FILES = [
    "server/services/alerting.ts",
    "server/services/core-agents.ts",
    "server/routes-leads.ts",
    "server/services/digest.ts",
    "server/services/agent-skills.ts",
    "server/services/leadNurturer.ts",
    "server/services/onboarding/sampleSeeder.ts",
    "server/agents/monthly-review.ts",
  ];
  const srcs = FILES.map((f) => stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")));
  const CAPPED = /\b(?:storage|this)\s*\.\s*(getLeads|getProperties|getDeals|getNotes)\s*\(/;

  it("vacuity: every file was read", () => {
    for (const [i, s] of srcs.entries()) expect(s.length, FILES[i]).toBeGreaterThan(500);
  });

  for (const name of Object.keys(CASES)) {
    it(`${name} is called`, () => {
      expect(srcs.some((s) => new RegExp(`\\b${name}\\(`).test(s))).toBe(true);
    });
  }

  it("none of the files reads a capped whole-org list", () => {
    for (const [i, s] of srcs.entries()) expect(CAPPED.test(s), FILES[i]).toBe(false);
  });
});
