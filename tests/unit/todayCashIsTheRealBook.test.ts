/**
 * DEFECT-0229 — Today's cash strip counted the "Try with sample data" book:
 * a demo workspace showed pipeline value, projected note income and late
 * notes that were fixtures. The whole-book reads also feed Today's task
 * cards (which should show a demo's items), so the MONEY figures filter in
 * memory by the same rule as `realDeal` / `realNote`: nothing on a SAMPLE-
 * parcel is money.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { stripComments } from "../helpers/stripComments";

const W = vi.hoisted(() => ({ where: null as unknown }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (w: unknown) => {
          W.where = w;
          return [{ id: 4 }, { id: 9 }];
        },
      }),
    }),
  },
}));

describe("Today's money is the real book", () => {
  it("samplePropertyIds reads this org's SAMPLE- parcels", async () => {
    const { samplePropertyIds } = await import("../../server/services/onboarding/sampleFilters");
    const ids = await samplePropertyIds(7);
    expect([...ids]).toEqual([4, 9]);
    const q = new PgDialect().sqlToQuery(W.where as SQL);
    expect(q.sql).toMatch(/"organization_id" = \$1 AND "properties"\."apn" LIKE \$2/);
    expect(q.params).toEqual([7, "SAMPLE-%"]);
  });

  it("every cash figure reads the filtered sets, and the payment history reads real payments", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-today.ts"), "utf8"));
    // W10.4 / DEFECT-0276 (8): the read is wrapped, and on failure the
    // split-dependent figures are null (todaySampleReadFailureIsUnavailable).
    const at = src.indexOf("sampleParcels = await samplePropertyIds(orgId);");
    expect(at).toBeGreaterThan(0);
    const tail = src.slice(at, src.indexOf("res.json({", at));
    expect(tail).toMatch(/const activeDeals = realDeals\?\.filter/);
    expect(tail).toMatch(/const activeNotes = realNotes\?\.filter/);
    expect(tail).toMatch(/const lateCount = realNotes\?\.filter/);
    expect(tail).toMatch(/return realDeals\.reduce/); // the open-deals sparkline
    expect(tail).toMatch(/gte\(paymentsTable\.paymentDate, since\),\s*realPayment\(\)/);
    // The filtered sets are the unfiltered book minus sample lineage. (Task
    // counts further down — stuck deals, waiting counters — still read the
    // whole book on purpose: a demo's tasks are tasks, not money.)
    expect(tail).toMatch(/deals: allDeals\.filter\(isReal\), notes: allNotes\.filter\(isReal\)/);
    expect(tail).toMatch(/const realDeals = realBook\?\.deals \?\? null/);
    expect(tail).toMatch(/const realNotes = realBook\?\.notes \?\? null/);
    // The morning brief's first-close claim reads the real deals (audit of
    // the fourth follow-up — it read the whole book).
    expect(tail).toMatch(/deriveFirstClosePrefix\(realDeals,/);
  });

  it("the receipts' payment total counts real payments only (audit of the fourth follow-up)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-today.ts"), "utf8"));
    const at = src.indexOf("gte(paymentsTable.processedAt, receiptsSince)");
    expect(at, "the receipts payment query moved").toBeGreaterThan(0);
    expect(src.slice(at, src.indexOf("))", at))).toMatch(/realPayment\(\)/);
  });
});
