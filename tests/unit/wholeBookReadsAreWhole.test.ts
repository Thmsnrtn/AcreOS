/**
 * DEFECT-0170 — exports and book-wide money figures read the WHOLE book.
 *
 * getLeads / getProperties / getDeals / getNotes cap at 5000 rows, newest
 * first, and getPayments stops silently at 5000. Past that, "export
 * everything" (CSV, JSON, backup zip, data-portability job) omitted the
 * OLDEST records while reporting the truncated counts as totals, and
 * Finance's portfolio value, delinquency aging and lifetime collections —
 * and Today's cash strip — dropped exactly the old, late notes. These paths
 * now read through wholeBookReads, which pages by id and refuses past a hard
 * ceiling instead of truncating.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ total: 0, calls: 0 }));
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../server/db", () => {
  const select = () => {
    let afterId = 0;
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      // The keyset bound is the last param of the rendered where.
      const params = new PgDialect().sqlToQuery(w as never).params;
      afterId = Number(params[params.length - 1]);
      return q;
    };
    q.orderBy = () => q;
    q.limit = async (n: number) => {
      h.calls++;
      const start = afterId;
      const end = Math.min(h.total, start + n);
      return Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ id: start + i + 1 }));
    };
    return q;
  };
  return { db: { select } };
});

import { readAllNotes, readAllPayments } from "../../server/storage/wholeBookReads";

beforeEach(() => {
  h.calls = 0;
});

describe("DEFECT-0170 — wholeBookReads", () => {
  it("returns every row past the 5000 cap, paging by id", async () => {
    h.total = 7_250;
    const rows = await readAllNotes(7);
    expect(rows).toHaveLength(7_250);
    expect(rows[rows.length - 1].id).toBe(7_250);
    expect(h.calls).toBe(8);
  });

  it("payments are whole too (getPayments stopped silently at 5000)", async () => {
    h.total = 5_001;
    expect(await readAllPayments(7)).toHaveLength(5_001);
  });

  it("refuses past the ceiling rather than truncating", async () => {
    h.total = 260_000;
    await expect(readAllNotes(7)).rejects.toThrow(/nothing was truncated/);
  });
});

describe("DEFECT-0170 — exports and book-wide figures do not use the capped lists", () => {
  const ROOT = resolve(__dirname, "../..");
  const CAPPED = /storage\.get(?:Leads|Deals|Properties|Notes)\(|storage\.getPayments\(\s*org(?:anization)?\.?[iI]d\s*\)/g;
  // file → capped reads that REMAIN, each with its reason.
  const REGISTER: Record<string, { allowed: number; why: string }> = {
    "server/services/importExport.ts": { allowed: 0, why: "every export path" },
    "server/services/migrationJobs.ts": { allowed: 0, why: "the data-portability export job" },
    "server/routes-finance.ts": { allowed: 0, why: "portfolio, delinquency, projections, notes list" },
    "server/routes-platform-features.ts": { allowed: 1, why: "personal-bests reads the most recent close only" },
    "server/routes-today.ts": { allowed: 1, why: "leads stay capped on Today pending SQL aggregates (DEFECT-0171)" },
  };
  for (const [file, { allowed, why }] of Object.entries(REGISTER)) {
    it(`${file}: ${allowed} capped read(s) — ${why}`, () => {
      const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
      expect(src.match(CAPPED)?.length ?? 0).toBe(allowed);
    });
  }
});
