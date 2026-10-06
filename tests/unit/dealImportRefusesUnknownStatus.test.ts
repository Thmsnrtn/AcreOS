/**
 * DEFECT-0276 (1), the import half — the CSV deal import wrote whatever the
 * status cell said ("Won", "closing", "pending") straight into the row, and an
 * empty cell silently became "negotiating". The vocabulary had one production
 * reader at creation (Pax).
 *
 * Now:
 *  - a cell that IS a deal status is written (case, whitespace and a space or
 *    hyphen for the underscore forgiven — "In Escrow" is in_escrow), and the
 *    row is created as an "import" — history, so a closed row is allowed and
 *    runs no close effects (the repository's rule; dealWritersCensus pins the
 *    registration);
 *  - an empty cell is NO status: the schema default applies, as for any
 *    create without one — the importer does not choose it;
 *  - anything else is REFUSED and counted against its row in the result —
 *    errorCount, the row number, and a reason naming the allowed statuses —
 *    and nothing is written for it. The preview flags it the same way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  created: [] as Array<{ deal: Record<string, unknown>; tx: unknown; opts: unknown }>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    getProperty: async (orgId: number, id: number) => (orgId === 5 && id === 10 ? { id: 10, organizationId: 5 } : undefined),
    createDeal: async (deal: Record<string, unknown>, tx: unknown, opts: unknown) => {
      H.created.push({ deal, tx, opts });
      return { id: H.created.length, ...deal };
    },
  },
}));
vi.mock("../../server/services/dealEvents", () => ({ emitDealCreated: vi.fn(), emitDealCreatedDurably: vi.fn(async () => undefined) }));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadCreatedDurably: vi.fn() }));
vi.mock("../../server/services/propertyEvents", () => ({ emitPropertyCreated: vi.fn(), emitPropertyCreatedDurably: vi.fn() }));

beforeEach(() => {
  H.created = [];
});

const row = (status: string | undefined) => ({ propertyId: "10", type: "acquisition", ...(status === undefined ? {} : { status }) });

describe("importDeals reads the status cell against the vocabulary", () => {
  it("refuses a word that is not a deal status, counts it, and writes nothing for it", async () => {
    const { importDeals } = await import("../../server/services/importExport");
    const result = await importDeals([row("Won"), row("closing"), row("pending")], 5);
    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(3);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    for (const e of result.errors) {
      expect(e.error).toMatch(/Unknown deal status/);
      expect(e.error).toMatch(/negotiating, offer_sent/);
    }
    expect(H.created).toEqual([]);
  });

  it("writes a real status — closed included — as an import, normalizing only case and separators", async () => {
    const { importDeals } = await import("../../server/services/importExport");
    const result = await importDeals([row("closed"), row(" In Escrow "), row("OFFER-SENT")], 5);
    expect(result.errorCount).toBe(0);
    expect(result.successCount).toBe(3);
    expect(H.created.map((c) => c.deal.status)).toEqual(["closed", "in_escrow", "offer_sent"]);
    for (const c of H.created) expect(c.opts).toEqual({ creation: "import" });
  });

  it("an empty cell is no status — the schema default applies, the importer does not pick one", async () => {
    const { importDeals } = await import("../../server/services/importExport");
    const result = await importDeals([row(""), row(undefined)], 5);
    expect(result.successCount).toBe(2);
    for (const c of H.created) expect("status" in c.deal, JSON.stringify(c.deal)).toBe(false);
  });

  it("a refused row does not stop the good rows around it", async () => {
    const { importDeals } = await import("../../server/services/importExport");
    const result = await importDeals([row("negotiating"), row("won"), row("cancelled")], 5);
    expect(result).toMatchObject({ totalRows: 3, successCount: 2, errorCount: 1 });
    expect(result.errors[0].row).toBe(3);
    expect(H.created.map((c) => c.deal.status)).toEqual(["negotiating", "cancelled"]);
  });

  it("the preview flags the same rows the import refuses", async () => {
    const { previewImport } = await import("../../server/services/importExport");
    const p = previewImport([row("Won"), row("closed"), row("")], "deals");
    expect(p.rows.map((r) => r.valid)).toEqual([false, true, true]);
    expect(p.rows[0].errors.join(" ")).toMatch(/Unknown deal status "Won"/);
  });
});
