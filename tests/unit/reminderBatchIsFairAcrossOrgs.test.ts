/**
 * DEFECT-0103 — one org's backlog cannot starve every other org's reminders.
 *
 * `getDispatchableReminders` was one oldest-first LIMIT 50 across all orgs.
 * Fifty `queued` rungs from one org whose sender is not connected are retried
 * every 30-minute sweep for fourteen days, so they filled every batch and no
 * other org's borrower was reminded. Each org with due rungs now gets a share.
 *
 * The drizzle operators are replaced by inspectable markers so the double can
 * honour the ONE condition this property depends on — the per-org predicate —
 * and treat every row as otherwise due.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ op: "and", a }),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  inArray: () => ({ op: "inArray" }),
  lte: () => ({ op: "lte" }),
  gte: () => ({ op: "gte" }),
  lt: () => ({ op: "lt" }),
  or: (...a: unknown[]) => ({ op: "or", a }),
  desc: (c: unknown) => c,
  count: () => ({ op: "count" }),
  sql: Object.assign(() => ({ op: "sql" }), { raw: () => ({ op: "sql" }) }),
}));
const T = vi.hoisted(() => ({
  paymentReminders: { organizationId: "col:org", scheduledFor: "col:scheduledFor", status: "col:status" },
}));
vi.mock("@shared/schema", () => ({ paymentReminders: T.paymentReminders }));

type Row = { id: number; organizationId: number; scheduledFor: Date; status: string };
const ROWS: Row[] = [];
function orgOf(cond: unknown): number | null {
  if (!cond || typeof cond !== "object") return null;
  const c = cond as { op?: string; col?: unknown; val?: unknown; a?: unknown[] };
  if (c.op === "eq" && c.col === T.paymentReminders.organizationId) return c.val as number;
  for (const x of c.a ?? []) {
    const o = orgOf(x);
    if (o !== null) return o;
  }
  return null;
}
vi.mock("../../server/db", () => {
  const select = () => ({
    from: () => ({
      where: (cond: unknown) => ({
        orderBy: () => ({
          limit: async (n: number) => {
            const org = orgOf(cond);
            return ROWS.filter((r) => org === null || r.organizationId === org)
              .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
              .slice(0, n);
          },
        }),
      }),
    }),
  });
  const selectDistinct = () => ({
    from: () => ({
      where: async () => [...new Set(ROWS.map((r) => r.organizationId))].map((organizationId) => ({ organizationId })),
    }),
  });
  return { db: { select, selectDistinct } };
});

const { paymentRemindersRepo } = await import("../../server/storage/paymentRemindersRepo");

describe("getDispatchableReminders is fair across orgs (DEFECT-0103)", () => {
  it("60 old blocked rungs from org A do not crowd out org B's 3 newer ones", async () => {
    const base = Date.now() - 10 * 86_400_000;
    for (let i = 0; i < 60; i++) ROWS.push({ id: i + 1, organizationId: 1, scheduledFor: new Date(base + i * 60_000), status: "queued" });
    for (let i = 0; i < 3; i++) ROWS.push({ id: 100 + i, organizationId: 2, scheduledFor: new Date(base + 5 * 86_400_000 + i), status: "scheduled" });

    const batch = await paymentRemindersRepo.getDispatchableReminders.call({} as never, 50, 14);
    expect(batch.length).toBeLessThanOrEqual(50);
    expect(batch.filter((r: Row) => r.organizationId === 2)).toHaveLength(3);
    expect(batch.filter((r: Row) => r.organizationId === 1).length).toBeGreaterThan(0);
  });
});
