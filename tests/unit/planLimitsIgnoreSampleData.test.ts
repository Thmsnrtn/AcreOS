/**
 * DEFECT-0147 — plan limits count the customer's records, not the sample book.
 *
 * Onboarding seeds a sample book by default. The free tier allows 3
 * properties and 2 notes, and the sample book alone reached both, so a new
 * free org was at its limit — refused its first real parcel — before adding
 * anything. This drives the real checkUsageLimit and renders each count's
 * WHERE with the Postgres dialect.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ wheres: [] as Array<{ table: string; where: unknown }> }));

vi.mock("../../server/storage", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => { table = getTableName(t as never); return q; };
    q.where = (w: unknown) => {
      h.wheres.push({ table, where: w });
      const rows = table === "organizations" ? [{ subscriptionTier: "free", isFounder: false }] : [{ count: 0 }];
      const p = Promise.resolve(rows);
      return Object.assign(p, { limit: () => p });
    };
    return q;
  };
  return { db: { select }, storage: {} };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { checkUsageLimit } from "../../server/services/usageLimits";

describe("DEFECT-0147 — plan limits exclude the sample book", () => {
  for (const [resource, table] of [["leads", "leads"], ["properties", "properties"], ["notes", "notes"]] as const) {
    it(`${resource}: the count excludes seeded sample rows`, async () => {
      h.wheres.length = 0;
      await checkUsageLimit(7, resource);
      const q = h.wheres.filter((w) => w.table === table);
      expect(q.length, `${table} was not counted (vacuity)`).toBe(1);
      const r = new PgDialect().sqlToQuery(q[0].where as SQL);
      expect(r.params.includes("sample_data") || r.params.includes("SAMPLE-%"), r.sql).toBe(true);
    });
  }
});
