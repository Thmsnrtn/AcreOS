/**
 * DEFECT-0171 (partial) — Pax's cash-flow and pipeline tools count the whole
 * book in SQL. They summed getNotes() / getLeads() — capped at 5000, newest
 * first — and stated the result to the customer as their whole portfolio.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ wheres: [] as unknown[], rows: [] as unknown[] }));
vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      h.wheres.push(w);
      return Object.assign(Promise.resolve(h.rows), q);
    };
    q.groupBy = async () => h.rows;
    return q;
  };
  return { db: { select } };
});

import { activeNoteTotals, leadCountsByStatusAndType } from "../../server/storage/bookAggregates";

describe("bookAggregates", () => {
  it("active-note totals are one org-scoped SQL aggregate over active notes", async () => {
    h.wheres.length = 0;
    h.rows = [{ n: 6200, balance: "1234567.50", monthly: "98765.25" }];
    expect(await activeNoteTotals(7)).toEqual({
      activeNotesCount: 6200,
      totalOutstandingBalance: 1234567.5,
      monthlyCashflow: 98765.25,
    });
    const w = new PgDialect().sqlToQuery(h.wheres[0] as SQL);
    expect(w.sql).toMatch(/"organization_id" = \$1/);
    expect(w.params).toEqual([7, "active"]);
  });

  it("lead counts sum the grouped rows, past 5000", async () => {
    h.rows = [
      { status: "new", type: "seller", n: 4000 },
      { status: "new", type: "buyer", n: 1500 },
      { status: "contacted", type: "seller", n: 700 },
    ];
    expect(await leadCountsByStatusAndType(7)).toEqual({
      totalLeads: 6200,
      byStatus: { new: 5500, contacted: 700 },
      byType: { seller: 4700, buyer: 1500 },
    });
  });
});

describe("the Pax tools use them", () => {
  const src = stripComments(readFileSync(resolve(__dirname, "../../server/ai/tools.ts"), "utf8"));
  const caseBody = (name: string) => {
    const at = src.indexOf(`case "${name}":`);
    return src.slice(at, src.indexOf("case \"", at + 10));
  };
  for (const [tool, fn, capped] of [
    ["get_cashflow_summary", "activeNoteTotals", "storage.getNotes("],
    ["get_pipeline_summary", "leadCountsByStatusAndType", "storage.getLeads("],
  ] as const) {
    it(`${tool} reads ${fn}, not ${capped}`, () => {
      const body = caseBody(tool);
      expect(body.length).toBeGreaterThan(50);
      expect(body).toContain(fn);
      expect(body).not.toContain(capped);
    });
  }
});
