/**
 * DEFECT-0176 — a closing interlock needs its evidence; checklists are not
 * built from guesses or wiped by a template.
 *
 * From the 2026-09-28 practitioner supplement (fifth cycle), verified at HEAD:
 *  - the wire item ("fraud_gate", critical, "DO NOT WIRE until this is
 *    checked") completed on one click via either route that shares the row;
 *    the recorded wire confirmation had no reader;
 *  - the stage gate read only the deal page's `checkedAt`;
 *  - applying a template DELETED the row — closing checklist and completed
 *    items with it;
 *  - auto-generation used the PRIOR property, a "TX" fallback and a closing
 *    date 30 days out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  confirmedOrders: [] as unknown[],
  checklistRows: [] as Array<{ items: Array<Record<string, unknown>> }>,
  updates: 0,
  generated: vi.fn(async () => ({ items: [], count: 0 })),
  titleOrderRows: [] as Array<{ id: number }>,
  written: null as null | Array<Record<string, unknown>>,
  wireConfirmed: vi.fn(async () => undefined),
  titleOrderUpdates: [] as Array<Record<string, unknown>>,
  gateSql: "",
}));

vi.mock("../../server/db", async () => {
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const dialect = new Dialect();
  const select = () => {
    let table = "";
    let where = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    // Awaiting the where() (no limit) is the stamp's read of every title
    // order on the deal. The gate's read (with limit) answers ONLY when its
    // predicate actually demands an org-scoped confirmation that postdates
    // the instructions — so deleting any of those clauses goes red.
    q.where = (w: SQL) => {
      where = dialect.sqlToQuery(w).sql;
      return Object.assign(Promise.resolve(table === "title_orders" ? h.titleOrderRows : []), q);
    };
    q.limit = async () => {
      if (table === "title_orders") {
        h.gateSql = where;
        const demands =
          /"organization_id" = \$/.test(where) &&
          /"wire_confirmed_at" is not null/.test(where) &&
          /"wire_confirmed_at" >= "title_orders"\."wire_instructions_issued_at"/.test(where);
        return demands ? h.confirmedOrders : [{ id: 999 }];
      }
      return table === "deal_checklists" ? h.checklistRows : [];
    };
    return q;
  };
  const update = (t: Parameters<typeof getTableName>[0]) => ({
    set: (v: Record<string, unknown> & { items?: Array<Record<string, unknown>> }) => ({
      where: async () => {
        if (getTableName(t) === "title_orders") {
          h.titleOrderUpdates.push(v);
          return;
        }
        h.updates++;
        if (v.items) h.written = v.items;
      },
    }),
  });
  return { db: { select, update } };
});
vi.mock("../../server/storage", async () => {
  const { db } = await import("../../server/db");
  return { db, storage: { getDeal: async () => ({ id: 4, organizationId: 7 }) } };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/closingChecklistGenerator", () => ({ generateClosingChecklist: h.generated }));
vi.mock("../../server/services/wireInstructions", () => ({ recordWireConfirmation: h.wireConfirmed }));

import { fraudGateRefusal } from "../../server/services/closingEvidence";
import { registerClosingRoutes } from "../../server/routes-closing";
import { dueDiligenceRepo } from "../../server/storage/dueDiligenceRepo";
import { dealRepo } from "../../server/storage/dealRepo";

const WIRE = { id: "verify-wire-two-channel", category: "fraud_gate", critical: true, required: true, completed: false };

beforeEach(() => {
  h.confirmedOrders = [];
  h.checklistRows = [];
  h.updates = 0;
  h.generated.mockClear();
  h.titleOrderRows = [];
  h.written = null;
  h.wireConfirmed.mockClear();
  h.titleOrderUpdates = [];
  h.gateSql = "";
});

const ATTESTATION = { phoneNumber: "(555) 010-2030", numberSource: "title company website", spokeWith: "Dana, escrow officer" };

describe("the wire interlock", () => {
  it("an ordinary item needs no evidence", async () => {
    expect(await fraudGateRefusal(7, 4, { category: "title" })).toBeNull();
  });
  it("the wire item is refused until the title order records a confirmation", async () => {
    expect(await fraudGateRefusal(7, 4, WIRE)).toMatch(/wire-fraud step/);
    h.confirmedOrders = [{ id: 1 }];
    expect(await fraudGateRefusal(7, 4, WIRE)).toBeNull();
    // The predicate the mock answered was really read.
    expect(h.gateSql).toMatch(/wire_confirmed_at/);
  });

  it("the closing PATCH refuses to tick it without evidence and writes nothing", async () => {
    h.checklistRows = [{ items: [{ ...WIRE }] }];
    const app = express();
    app.use(express.json());
    registerClosingRoutes(app);
    const res = await request(app).patch("/api/deals/4/closing-checklist/verify-wire-two-channel").send({ completed: true });
    expect(res.status).toBe(400);
    expect(h.updates).toBe(0);
  });

  it("a partial attestation is refused and names what is missing", async () => {
    expect(await fraudGateRefusal(7, 4, WIRE, { ...ATTESTATION, numberSource: "" })).toMatch(/where you looked that number up/);
    expect(await fraudGateRefusal(7, 4, WIRE, { ...ATTESTATION, phoneNumber: "12" })).toMatch(/phone number/);
  });

  it("a complete attestation completes the item, is stored on it, and stamps the title orders AFTER the write", async () => {
    h.checklistRows = [{ items: [{ ...WIRE }] }];
    h.titleOrderRows = [{ id: 31 }, { id: 32 }];
    const app = express();
    app.use(express.json());
    registerClosingRoutes(app);
    const res = await request(app)
      .patch("/api/deals/4/closing-checklist/verify-wire-two-channel")
      .send({ completed: true, verification: ATTESTATION });
    expect(res.status).toBe(200);
    const item = h.written?.find((i) => i.id === WIRE.id) as Record<string, unknown>;
    expect(item.completed).toBe(true);
    expect(item.verification).toMatchObject({ phoneNumber: "(555) 010-2030", numberSource: "title company website", spokeWith: "Dana, escrow officer" });
    expect(h.wireConfirmed.mock.calls).toEqual([[7, 31], [7, 32]]);
  });

  it("untick clears both vocabularies and the evidence, and withdraws the title-order confirmation", async () => {
    h.checklistRows = [
      {
        items: [
          { ...WIRE, completed: true, completedAt: "t", checkedAt: "t", verification: { phoneNumber: "5550102030" } },
        ],
      },
    ];
    const app = express();
    app.use(express.json());
    registerClosingRoutes(app);
    const res = await request(app).patch("/api/deals/4/closing-checklist/verify-wire-two-channel").send({ completed: false });
    expect(res.status).toBe(200);
    const item = h.written?.find((i) => i.id === WIRE.id) as Record<string, unknown>;
    expect(item.completed).toBe(false);
    expect(item.checkedAt).toBeUndefined();
    expect(item.verification).toBeUndefined();
    expect(h.titleOrderUpdates).toEqual([expect.objectContaining({ wireConfirmedAt: null })]);
  });
});

describe("checklist state", () => {
  it("a template MERGES: completed and closing items survive, new template items are added", async () => {
    const existing = {
      id: 11,
      items: [
        { id: "a", title: "done", required: true, documentRequired: false, checkedAt: "2026-09-01" },
        { id: "w", title: "wire", required: true, documentRequired: true, phase: "pre_closing" },
        { id: "b", title: "untouched", required: false, documentRequired: false },
      ],
    };
    let written: Record<string, unknown> | null = null;
    const self = {
      getChecklistTemplate: async () => ({ items: [{ id: "t1", title: "T1", required: true, documentRequired: false }] }),
      getDealChecklist: async () => existing,
      updateDealChecklist: async (_id: number, patch: Record<string, unknown>) => (written = patch),
      createDealChecklist: vi.fn(),
    };
    await dueDiligenceRepo.applyChecklistTemplateToDeal.call(self as never, 7, 4, 2);
    const ids = ((written as unknown as { items: Array<{ id: string }> }).items).map((i) => i.id);
    expect(ids).toEqual(["a", "w", "t1"]);
  });

  it("the stage gate counts the closing checklist's `completed`", async () => {
    const self = { getDealChecklist: async () => ({ items: [{ id: "w", required: true, completed: true }] }) };
    expect((await dueDiligenceRepo.checkStageGate.call(self as never, 4)).canAdvance).toBe(true);
  });

  it("auto-generation waits for a real closing date instead of inventing one", async () => {
    const self = { getDealChecklist: async () => undefined };
    h.checklistRows = [];
    await dealRepo._autoGenerateClosingChecklist.call(self as never, 4, null, 7, null);
    expect(h.generated).not.toHaveBeenCalled();
  });
});
