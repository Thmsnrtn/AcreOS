/**
 * POST /api/bulk/leads/delete is a SOFT delete (W10.2a).
 *
 * It hard-deleted the selected leads with `db.delete`, while the single-lead
 * delete and storage.bulkDeleteLeads set `deletedAt`. A hard delete erased each
 * lead's doNotContact / opt-out with the row — so a later import could mint a
 * fresh, contactable row for someone who had revoked consent — and the Undo
 * (restoreLeads) had nothing to restore. Found by the live-lead census builder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({ dbDeletes: 0, softDeleted: null as unknown[] | null }));

vi.mock("../../server/db", () => ({
  db: {
    delete: () => {
      h.dbDeletes++;
      return { where: () => Promise.resolve() };
    },
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    bulkDeleteLeads: vi.fn(async (...args: unknown[]) => {
      h.softDeleted = args;
      return (args[1] as number[]).length;
    }),
  },
}));
vi.mock("../../server/services/legalHold", () => ({
  filterOutHeldIds: vi.fn(async (_org: number, _kind: string, ids: number[]) => ids.filter((id) => id !== 3)),
}));
vi.mock("../../server/utils/permissions", () => ({
  attachPermissionContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { default: router } = await import("../../server/routes-bulk");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: 42 };
    req.user = { id: "user_1" };
    req.permissionContext = { permissions: {} };
    next();
  });
  a.use("/api/bulk", router);
  return a;
}

beforeEach(() => {
  h.dbDeletes = 0;
  h.softDeleted = null;
});

describe("POST /api/bulk/leads/delete", () => {
  it("soft-deletes through storage.bulkDeleteLeads and never hard-deletes", async () => {
    const res = await request(app()).post("/api/bulk/leads/delete").send({ ids: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(h.dbDeletes, "the route hard-deleted lead rows").toBe(0);
    expect(h.softDeleted).toEqual([42, [1, 2], "user_1"]);
    expect(res.body).toMatchObject({ deleted: 2, skippedDueToLegalHold: 1 });
  });
});
