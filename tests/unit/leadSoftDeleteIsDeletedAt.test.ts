/**
 * Audit of 9ed61f4 — a lead's soft delete is `deletedAt`, one field.
 *
 * `bulkDeleteLeads` set `status: "deleted"` without `deletedAt`: every list
 * read filters `deletedAt`, so the leads stayed listed, and the Undo
 * (`restoreLeads`, matching `deletedAt IS NOT NULL`) restored nothing while
 * reporting every id restored. Then a rule refusing any status change from
 * "deleted" stranded exactly those rows. Now: delete stamps `deletedAt` and
 * keeps the status; restore clears it (a legacy "deleted" status comes back
 * as "new") and reports what matched; a legacy row can still re-enter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/legalHold", () => ({
  filterOutHeldIds: async (_o: number, _k: string, ids: number[]) => ids,
  assertNotUnderLegalHold: async () => undefined,
}));

const S = vi.hoisted(() => ({
  sets: [] as Array<Record<string, unknown>>,
  wheres: [] as unknown[],
  returning: [] as Array<{ id: number }>,
}));
vi.mock("../../server/db", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        S.sets.push(v);
        return {
          where: (w: unknown) => {
            S.wheres.push(w);
            const p: any = Promise.resolve(undefined);
            p.returning = async () => S.returning;
            return p;
          },
        };
      },
    }),
  },
}));

beforeEach(() => {
  S.sets = [];
  S.wheres = [];
  S.returning = [];
});

const render = (w: unknown) => new PgDialect().sqlToQuery(w as SQL);

describe("a lead's soft delete is deletedAt", () => {
  it("bulk delete stamps deletedAt and keeps the lead's status", async () => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    await leadRepo.bulkDeleteLeads.call({} as never, 5, [1, 2], "u1");
    expect(S.sets[0].deletedAt).toBeInstanceOf(Date);
    expect(S.sets[0]).not.toHaveProperty("status");
    expect(S.sets[0].deletedBy).toBe("u1");
  });

  it("restore reports what matched, clears deletedAt, and brings a legacy 'deleted' status back as 'new'", async () => {
    const { leadRepo } = await import("../../server/storage/leadRepo");
    S.returning = [{ id: 1 }];
    const n = await leadRepo.restoreLeads.call({} as never, 5, [1, 2, 3]);
    expect(n).toBe(1);
    expect(S.sets[0].deletedAt).toBeNull();
    const status = render(S.sets[0].status);
    expect(status.sql).toMatch(/case when "leads"\."status" = 'deleted' then 'new' else "leads"\."status" end/);
    // It matches legacy status-deleted rows too, not only deletedAt ones.
    expect(render(S.wheres[0]).sql).toMatch(/"leads"\."deleted_at" IS NOT NULL or "leads"\."status" = \$\d+/);
  });

  it("a legacy status-deleted lead can still change status (it is not stranded)", async () => {
    const { validateLeadTransition } = await import("@shared/lifecycle/pipeline-status");
    expect(validateLeadTransition("deleted", "new")).toBeNull();
  });
});
