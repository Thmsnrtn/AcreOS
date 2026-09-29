/**
 * DEFECT-0180 — every deal that reaches closing gets the closing items,
 * including the wire-fraud interlock, whatever checklist it started with.
 *
 * Found by the independent audit of DEFECT-0176: once a due-diligence
 * template had been applied, `_autoGenerateClosingChecklist` returned on
 * "a checklist exists" and `generateClosingChecklist` returned the existing
 * row unchanged. The deal never received "Verify wire instructions —
 * two-channel out-of-band" or any other closing step, and the manual route
 * still answered "Closing checklist created — N items".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  row: null as null | { id: number; items: Array<Record<string, unknown>> },
  inserted: null as null | Array<Record<string, unknown>>,
  updated: null as null | Array<Record<string, unknown>>,
}));

vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    q.where = () => q;
    q.limit = async () => (table === "deal_checklists" && h.row ? [h.row] : table === "properties" ? [{ state: "TX" }] : []);
    return q;
  };
  const insert = () => ({
    values: async (v: { items: Array<Record<string, unknown>> }) => {
      h.inserted = v.items;
    },
  });
  const update = () => ({
    set: (v: { items?: Array<Record<string, unknown>> }) => ({
      where: async () => {
        if (v.items) h.updated = v.items;
      },
    }),
  });
  return { db: { select, insert, update } };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { generateClosingChecklist } from "../../server/services/closingChecklistGenerator";
import { dealRepo } from "../../server/storage/dealRepo";

const WIRE_ID = "verify-wire-two-channel";

beforeEach(() => {
  h.row = null;
  h.inserted = null;
  h.updated = null;
});

describe("a template-started checklist still gets the closing items", () => {
  it("the generator MERGES into an existing template row, keeping its progress", async () => {
    h.row = {
      id: 9,
      items: [
        { id: "survey", title: "Order survey", required: true, documentRequired: false, checkedAt: "2026-09-01" },
      ],
    };
    const r = await generateClosingChecklist(4, "TX", "2026-11-02", false);
    expect(h.updated).not.toBeNull();
    const ids = (h.updated ?? []).map((i) => i.id);
    expect(ids[0]).toBe("survey");
    expect((h.updated ?? [])[0].checkedAt).toBe("2026-09-01");
    expect(ids).toContain(WIRE_ID);
    expect(r.added).toBeGreaterThan(0);
  });

  it("a template item that squats on the wire id is replaced by the real interlock, progress dropped", async () => {
    h.row = { id: 9, items: [{ id: WIRE_ID, title: "wire", required: true, documentRequired: false, checkedAt: "2026-09-01" }] };
    await generateClosingChecklist(4, "TX", "2026-11-02", false);
    const wire = (h.updated ?? []).find((i) => i.id === WIRE_ID) as Record<string, unknown>;
    expect(wire.category).toBe("fraud_gate");
    expect(wire.checkedAt).toBeUndefined();
    expect((h.updated ?? []).filter((i) => i.id === WIRE_ID)).toHaveLength(1);
  });

  it("a row that already holds the closing items is left alone", async () => {
    await generateClosingChecklist(4, "TX", "2026-11-02", false);
    const full = h.inserted ?? [];
    h.row = { id: 9, items: full };
    h.updated = null;
    const r = await generateClosingChecklist(4, "TX", "2026-11-02", false);
    expect(h.updated).toBeNull();
    expect(r.added).toBe(0);
  });

  it("the status hook generates for a template-started deal instead of returning on 'a checklist exists'", async () => {
    h.row = { id: 9, items: [{ id: "survey", title: "Order survey", required: true, documentRequired: false }] };
    const self = { getDealChecklist: async () => h.row };
    await dealRepo._autoGenerateClosingChecklist.call(self as never, 4, 3, 7, new Date("2026-11-02"));
    expect((h.updated ?? []).map((i) => i.id)).toContain(WIRE_ID);
  });
});
