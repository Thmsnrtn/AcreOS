/**
 * DEFECT-0137 (audit follow-up) — the sample book is not a milestone.
 *
 * detectMilestones counted every lead, note, property and closed deal, and
 * "Try with sample data" seeds all four — CLOSED deals included. So a paying
 * org that clicked it was emailed "Congrats on reaching your first closed
 * deal" about fixtures, and the milestone was stored for good, so the real
 * one was never celebrated. This drives the real function and renders each
 * WHERE with the Postgres dialect.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ wheres: [] as Array<{ table: string; where: unknown }> }));

vi.mock("../../server/db", () => ({
  db: {
    select: () => {
      let table = "";
      const q: Record<string, unknown> = {};
      q.from = (t: unknown) => {
        table = getTableName(t as never);
        return q;
      };
      q.where = (w: unknown) => {
        h.wheres.push({ table, where: w });
        return Promise.resolve([{ n: 1 }]);
      };
      return q;
    },
  },
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/emailRegistry", () => ({ sendRegisteredEmail: vi.fn() }));
vi.mock("../../server/services/systemActivityLogger", () => ({ logActivity: vi.fn() }));

import { detectMilestones } from "../../server/services/churnEngine";

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

describe("DEFECT-0137 — milestones count the customer's work only", () => {
  it("every milestone count over a sample-seeded table excludes the sample book", async () => {
    h.wheres.length = 0;
    await detectMilestones(7, []);
    for (const table of ["leads", "notes", "properties", "deals"]) {
      const q = h.wheres.filter((w) => w.table === table).map((w) => render(w.where));
      expect(q.length, `${table} was not counted (vacuity)`).toBeGreaterThan(0);
      for (const one of q) {
        const excludes = one.params.includes("sample_data") || one.params.includes("SAMPLE-%");
        expect(excludes, `${table}: ${one.sql}`).toBe(true);
      }
    }
  });
});
