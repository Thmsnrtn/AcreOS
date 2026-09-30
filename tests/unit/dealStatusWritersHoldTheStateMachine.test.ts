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
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

// It reads every repository under server/storage.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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
  it("a deleted deal cannot change stage", async () => {
    const { validateDealTransition } = await import("@shared/lifecycle/pipeline-status");
    expect(validateDealTransition("deleted", "closed")).toMatch(/deleted deal cannot change stage/);
    expect(validateDealTransition("deleted", "negotiating")).toMatch(/deleted deal cannot change stage/);
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
    await expect(run("deal", 2, { status: "closed" })).rejects.toThrow(/deleted deal cannot change stage/);
    expect(S.dealUpdates).toEqual([]);
  });

  it("refuses an illegal lead status", async () => {
    await expect(run("lead", 3, { status: "closed" })).rejects.toThrow(/update_record refused/);
    expect(S.leadUpdates).toEqual([]);
  });

  it("refuses a type that differs from the trigger's entity (audit of 9ed61f4)", async () => {
    const { workflowEngine } = await import("../../server/services/workflow-engine");
    const engine = workflowEngine as unknown as { executeUpdateRecord: (a: unknown, c: unknown) => Promise<unknown> };
    await expect(
      engine.executeUpdateRecord(
        { id: "a1", type: "update_record", config: { entityType: "deal", updates: { status: "offer_sent" } } },
        { organizationId: 5, triggerData: { entityType: "lead", entityId: 3 }, variables: {} },
      ),
    ).rejects.toThrow(/triggered by a lead/);
    expect(S.dealUpdates).toEqual([]);
  });

  it("applies a legal move", async () => {
    await run("deal", 3, { status: "offer_sent" });
    expect(S.dealUpdates).toEqual([{ status: "offer_sent" }]);
  });
});

describe("no update moves a row out of its tenant", () => {
  it("assertWritablePatch returns the patch without identity, tenancy or audit columns", async () => {
    const { assertWritablePatch } = await import("../../server/utils/patch");
    expect(
      assertWritablePatch({ organizationId: 99, organization_id: 99, id: 7, createdAt: new Date(), createdBy: "x", status: "closed" }, "t"),
    ).toEqual({ status: "closed" });
    // A patch that was ONLY a tenant move is empty, and refused.
    expect(() => assertWritablePatch({ organizationId: 99 }, "t")).toThrow(/empty patch/);
  });

  /**
   * The population: every `.set(…)` in every repository under server/storage
   * (audit of 9ed61f4: the first version read three repos, and tasks and
   * due diligence carried the same shape a request body reached). A caller's
   * patch may reach the row only through omitProtectedFields — directly, or
   * via assertWritablePatch, which applies it. A spread of anything else, or a
   * bare method parameter passed to `.set`, is the thing that fails.
   */
  it("every repository write passes a caller's patch through omitProtectedFields", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve, join } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const dir = resolve(__dirname, "../../server/storage");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(30); // vacuity: the repositories are here
    let sets = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripComments(readFileSync(join(dir, f), "utf8"));
      const methods = [...src.matchAll(/async\s+(\w+)\s*\(\s*this:\s*DatabaseStorage\s*,?([^)]*)\)/g)].map((m) => ({
        at: m.index ?? 0,
        params: new Set(m[2].split(",").map((p) => p.trim().split(/[?:\s=]/)[0]).filter(Boolean)),
      }));
      for (const m of src.matchAll(/\.set\(/g)) {
        // The argument, by bracket depth.
        let depth = 0;
        let k = (m.index ?? 0) + 5;
        const start = k;
        for (; k < src.length; k++) {
          const c = src[k];
          if (c === "(" || c === "{" || c === "[") depth++;
          else if (c === ")" || c === "}" || c === "]") {
            if (depth === 0) break;
            depth--;
          }
        }
        const arg = src.slice(start, k).trim();
        sets++;
        const params = methods.filter((x) => x.at < (m.index ?? 0)).at(-1)?.params ?? new Set<string>();
        const badSpread = [...arg.matchAll(/\.\.\.\s*(\w+)/g)].some(
          (sp) => sp[1] !== "omitProtectedFields" && params.has(sp[1]),
        );
        const bareParam = /^\w+$/.test(arg) && params.has(arg);
        if (badSpread || bareParam) offenders.push(`${f}: .set(${arg.slice(0, 60)})`);
      }
    }
    expect(sets).toBeGreaterThanOrEqual(140); // vacuity: measured 146 on 2026-09-30
    expect(offenders, offenders.join("\n")).toEqual([]);
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
