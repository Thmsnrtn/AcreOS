/**
 * DEFECT-0151 — ⌘K search survives punctuation and accents, and its fallback
 * queries columns that exist.
 *
 * The tsquery builder stripped each word to ASCII letters/digits and kept the
 * empty remainder: "Smith - Lot 4" became "Smith:* & :* & Lot:* & 4:*" — a
 * tsquery syntax error — so the search fell to the ILIKE fallback, which
 * selected "firstName" / "organizationId" (the columns are snake_case), threw
 * into a silent catch, and returned nothing. Neither path excluded
 * soft-deleted rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, failTs: false }));
const dialect = new PgDialect();

vi.mock("../../server/db", () => ({
  db: {
    execute: async (q: SQL) => {
      const r = dialect.sqlToQuery(q);
      h.queries.push({ sql: r.sql, params: r.params });
      if (h.failTs && /to_tsquery/.test(r.sql)) throw new Error("syntax error in tsquery");
      return { rows: [] };
    },
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { fullTextSearch } from "../../server/services/fullTextSearch";

beforeEach(() => {
  h.queries.length = 0;
  h.failTs = false;
});

const tsParams = () => h.queries.filter((q) => /to_tsquery/.test(q.sql)).flatMap((q) => q.params).filter((p) => typeof p === "string" && p.includes(":*"));

describe("DEFECT-0151 — the tsquery", () => {
  it("drops a punctuation-only word instead of emitting an empty term", async () => {
    await fullTextSearch.search(7, "Smith - Lot 4", 20);
    expect(new Set(tsParams())).toEqual(new Set(["Smith:* & Lot:* & 4:*"]));
  });

  it("keeps accented and non-Latin letters", async () => {
    await fullTextSearch.search(7, "Muñoz 東京", 20);
    expect(new Set(tsParams())).toEqual(new Set(["Muñoz:* & 東京:*"]));
  });

  it("excludes soft-deleted rows", async () => {
    await fullTextSearch.search(7, "smith", 20);
    const ts = h.queries.filter((q) => /to_tsquery/.test(q.sql));
    expect(ts.length).toBe(3);
    for (const q of ts) expect(q.sql).toMatch(/deleted_at IS NULL/);
  });
});

describe("DEFECT-0151 — the fallback", () => {
  it("queries the real snake_case columns and excludes deleted rows", async () => {
    h.failTs = true;
    await fullTextSearch.search(7, "smith", 20);
    const fb = h.queries.filter((q) => /ILIKE/.test(q.sql));
    expect(fb.length).toBe(2);
    for (const q of fb) {
      expect(q.sql).toMatch(/WHERE organization_id = /);
      expect(q.sql).not.toMatch(/"organizationId"|"firstName" ILIKE|"lastName" ILIKE/);
      expect(q.sql).toMatch(/deleted_at IS NULL/);
    }
  });
});
