/**
 * Bulk lead enrichment reads and writes the caller's own leads.
 *
 * `enrichLead(organizationId, leadId)` is org-first. The batch path must pass
 * the arguments in that order, and the enrichment write is scoped by the
 * organization exactly like the read before it.
 *
 * Each column is bound to its own parameter, so an argument swap cannot pass
 * merely because both values appear somewhere in the query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  reads: [] as unknown[],
  writes: [] as unknown[],
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      h.reads.push(w);
      return Promise.resolve([{ id: 42, organizationId: 7, email: null, phone: null, address: null, enrichmentData: null }]);
    };
    return q;
  };
  const update = () => ({
    set: () => ({
      where: (w: unknown) => {
        h.writes.push(w);
        return Promise.resolve();
      },
    }),
  });
  return { db: { select, update } };
});
vi.mock("../../server/services/data-source-broker", () => ({
  dataSourceBroker: { lookup: async () => ({ success: false, data: null }) },
}));

beforeEach(() => {
  h.reads.length = 0;
  h.writes.length = 0;
});

const dialect = new PgDialect();
function bound(where: unknown, col: string): unknown {
  const q = dialect.sqlToQuery(where as SQL);
  const m = new RegExp(`"${col}" = \\$(\\d+)`).exec(q.sql);
  return m ? q.params[Number(m[1]) - 1] : undefined;
}

describe("batchEnrichLeads stays inside the caller's organization", () => {
  it("reads lead #id in the caller's org", async () => {
    const { batchEnrichLeads } = await import("../../server/services/leadEnrichment");
    await batchEnrichLeads([42], 7);
    expect(h.reads.length).toBeGreaterThan(0);
    expect(bound(h.reads[0], "id")).toBe(42);
    expect(bound(h.reads[0], "organization_id")).toBe(7);
  });

  it("scopes the enrichment write by the same lead and organization", async () => {
    const { batchEnrichLeads } = await import("../../server/services/leadEnrichment");
    await batchEnrichLeads([42], 7);
    expect(h.writes.length).toBe(1);
    expect(bound(h.writes[0], "id")).toBe(42);
    expect(bound(h.writes[0], "organization_id")).toBe(7);
  });
});
