/**
 * Audit of 7cc7345 — every writer of a deal's status is held to the state
 * machine, and none can move a row out of its tenant.
 *
 *  - `/api/bulk/deals/update` set any string (DEFECT-0254) — now validated;
 *    and "legacy row, allow re-entry" admitted a soft-DELETED deal, so the
 *    bulk endpoint or the agent could close a deleted deal.
 *  - workflow `update_record` passed `config.updates` straight into the row:
 *    any status, and `organizationId` (a WHERE scoped to the OLD org moved
 *    the row into another tenant).
 *  - the undo took any client {id, previousStage}.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  deals: new Map<number, { id: number; organizationId: number; status: string }>(),
  bulkWrites: [] as Array<{ ids: number[]; updates: Record<string, unknown> }>,
  sets: [] as Array<Record<string, unknown>>,
  lead: { id: 3, organizationId: 5, status: "new" } as { id: number; organizationId: number; status: string },
  leadUpdates: [] as Array<Record<string, unknown>>,
  dealUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getDealsByIds: async (orgId: number, ids: number[]) =>
      ids.map((id) => S.deals.get(id)).filter((d): d is NonNullable<typeof d> => !!d && d.organizationId === orgId),
    bulkUpdateDeals: async (_o: number, ids: number[], updates: Record<string, unknown>) => (S.bulkWrites.push({ ids, updates }), ids.length),
    getDeal: async (orgId: number, id: number) => {
      const d = S.deals.get(id);
      return d && d.organizationId === orgId ? d : undefined;
    },
    getLead: async (orgId: number, id: number) => (S.lead.organizationId === orgId && S.lead.id === id ? S.lead : undefined),
    updateDeal: async (_id: number, u: Record<string, unknown>) => (S.dealUpdates.push(u), {}),
    updateLead: async (_id: number, u: Record<string, unknown>) => (S.leadUpdates.push(u), {}),
    updateProperty: async () => ({}),
  },
  db: {},
}));
vi.mock("../../server/services/dealEvents", () => ({ emitDealStageChanged: vi.fn() }));

beforeEach(() => {
  S.deals = new Map([
    [1, { id: 1, organizationId: 5, status: "closed" }],
    [2, { id: 2, organizationId: 5, status: "deleted" }],
    [3, { id: 3, organizationId: 5, status: "negotiating" }],
  ]);
  S.bulkWrites = [];
  S.sets = [];
  S.leadUpdates = [];
  S.dealUpdates = [];
  S.lead = { id: 3, organizationId: 5, status: "new" };
});

async function bulkApp() {
  const { default: router } = await import("../../server/routes-bulk");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).organization = { id: 5 };
    (req as any).organizationId = 5;
    (req as any).user = { id: "u1" };
    next();
  });
  app.use("/api/bulk", router);
  return app;
}

describe("the state machine has no side door", () => {
  it("a deleted deal cannot change stage — it must be restored first", async () => {
    const { validateDealTransition } = await import("@shared/lifecycle/pipeline-status");
    expect(validateDealTransition("deleted", "closed")).toMatch(/restore it first/);
    expect(validateDealTransition("deleted", "negotiating")).toMatch(/restore it first/);
    // A genuinely legacy value still re-enters, as documented.
    expect(validateDealTransition("closing", "closed")).toBeNull();
  });

  it("/api/bulk/deals/update refuses an unknown stage, an illegal move, and a deleted deal — and writes nothing", async () => {
    const app = await bulkApp();
    for (const [ids, status] of [[[3], "won"], [[1], "offer_sent"], [[2], "closed"]] as const) {
      const r = await request(app).post("/api/bulk/deals/update").send({ ids, updates: { status } });
      expect(r.status, `${JSON.stringify(ids)} → ${status}`).toBe(400);
    }
    expect(S.bulkWrites).toEqual([]);
  });

  it("/api/bulk/deals/update writes a legal move through the repository", async () => {
    const app = await bulkApp();
    const r = await request(app).post("/api/bulk/deals/update").send({ ids: [3], updates: { status: "offer_sent" } });
    expect(r.status).toBe(200);
    expect(S.bulkWrites).toEqual([{ ids: [3], updates: expect.objectContaining({ status: "offer_sent" }) }]);
  });
});

describe("a workflow update_record holds the state machine", () => {
  const run = async (entityType: "deal" | "lead", entityId: number, updates: Record<string, unknown>) => {
    const { workflowEngine } = await import("../../server/services/workflow-engine");
    const engine = workflowEngine as unknown as {
      executeUpdateRecord: (a: unknown, c: unknown) => Promise<unknown>;
      interpolateTemplate: (v: string) => string;
    };
    return engine.executeUpdateRecord(
      { id: "a1", type: "update_record", config: { entityType, updates } },
      { organizationId: 5, triggerData: { entityType, entityId }, variables: {} },
    );
  };

  it("refuses an illegal or unknown deal stage, and a deleted deal", async () => {
    await expect(run("deal", 1, { status: "offer_sent" })).rejects.toThrow(/update_record refused/);
    await expect(run("deal", 3, { status: "won" })).rejects.toThrow(/not a deal stage/);
    await expect(run("deal", 2, { status: "closed" })).rejects.toThrow(/restore it first/);
    expect(S.dealUpdates).toEqual([]);
  });

  it("refuses an illegal lead status", async () => {
    await expect(run("lead", 3, { status: "closed" })).rejects.toThrow(/update_record refused/);
    expect(S.leadUpdates).toEqual([]);
  });

  it("applies a legal move", async () => {
    await run("deal", 3, { status: "offer_sent" });
    expect(S.dealUpdates).toEqual([{ status: "offer_sent" }]);
  });
});

describe("no update moves a row out of its tenant", () => {
  it("withoutIdentityKeys strips the tenant and primary keys", async () => {
    const { withoutIdentityKeys } = await import("../../server/utils/patch");
    expect(withoutIdentityKeys({ organizationId: 99, id: 7, createdAt: new Date(), status: "closed" })).toEqual({ status: "closed" });
  });

  it("every deal, lead and property update in the repositories applies it", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    for (const [file, table] of [["dealRepo", "deals"], ["leadRepo", "leads"], ["propertyRepo", "properties"]] as const) {
      const src = stripComments(readFileSync(resolve(__dirname, `../../server/storage/${file}.ts`), "utf8"));
      const sets = [...src.matchAll(new RegExp(String.raw`\.update\(${table}\)\s*\.set\(([^)]*\))`, "g"))].map((m) => m[1]);
      // Vacuity: the update and bulk-update of each table.
      expect(sets.filter((x) => /\.\.\.(updates|withoutIdentityKeys\(updates\))/.test(x)).length, file).toBeGreaterThanOrEqual(2);
      for (const set of sets) expect(set, `${file}: ${set}`).not.toMatch(/\.\.\.updates\b/);
    }
  });
});

describe("the undo restores only what a recorded bulk move changed", () => {
  it("checks the server's own bulk_stage_update record and the deal's current stage", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes.ts"), "utf8"));
    const start = src.indexOf('"/api/deals/bulk-stage-undo"');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("app.", start + 40));
    expect(body).toMatch(/getAuditLogs\(org\.id,\s*\{[^}]*action:\s*"bulk_stage_update"/);
    expect(body).toMatch(/move\.newStage !== deal\.status/);
    const guard = body.indexOf("move.newStage !== deal.status");
    expect(body.indexOf("storage.updateDeal(", guard)).toBeGreaterThan(guard);
  });
});
