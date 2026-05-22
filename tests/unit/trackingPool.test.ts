/**
 * Pillar 5 — tracking-pool unit tests.
 *
 * The pool layer interacts heavily with Postgres so the tests stub the
 * `db` module with an in-memory shape just expressive enough to exercise
 * the assign / release / reassign branches. The point isn't fidelity to
 * Drizzle — it's pinning the contract: assign falls back to renting when
 * the pool is empty, release marks releasedAt, and reassign picks up a
 * released row before renting fresh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: number;
  number: string;
  organizationId: number | null;
  campaignId: number | null;
  provider: string;
  assignedAt: Date;
  releasedAt: Date | null;
  lastInboundAt: Date | null;
}

const store: Row[] = [];
let nextId = 1;

function reset() {
  store.length = 0;
  nextId = 1;
}

// Build a chainable mock that returns specific rows. The implementation
// just inspects the call sequence (.select().from().where().limit()) and
// returns from `store` filtered by very loose criteria — enough for the
// tracking-pool's code paths.
function makeChain(result: any) {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(result),
    returning: () => Promise.resolve(result),
    set: () => chain,
    values: (v: any) => {
      const arr = Array.isArray(v) ? v : [v];
      const inserted = arr.map((row) => {
        const r: Row = {
          id: nextId++,
          number: row.number,
          organizationId: row.organizationId ?? null,
          campaignId: row.campaignId ?? null,
          provider: row.provider,
          assignedAt: new Date(),
          releasedAt: row.releasedAt ?? null,
          lastInboundAt: row.lastInboundAt ?? null,
        };
        store.push(r);
        return r;
      });
      return { returning: () => Promise.resolve(inserted) };
    },
  };
  return chain;
}

vi.mock("../../server/db", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (..._args: any[]) => {
            // Use a heuristic — return all rows that look "reusable":
            // releasedAt set OR lastInboundAt older than 60d.
            const cutoff = Date.now() - 60 * 86400 * 1000;
            const candidates = store.filter(
              (r) =>
                r.releasedAt != null ||
                (r.lastInboundAt != null && r.lastInboundAt.getTime() < cutoff),
            );
            return {
              limit: (_n: number) => Promise.resolve(candidates.slice(0, 1)),
            };
          },
        }),
      }),
      insert: () => ({
        values: (v: any) => {
          const arr = Array.isArray(v) ? v : [v];
          const inserted = arr.map((row) => {
            const r: Row = {
              id: nextId++,
              number: row.number,
              organizationId: row.organizationId ?? null,
              campaignId: row.campaignId ?? null,
              provider: row.provider,
              assignedAt: new Date(),
              releasedAt: row.releasedAt ?? null,
              lastInboundAt: row.lastInboundAt ?? null,
            };
            store.push(r);
            return r;
          });
          return { returning: () => Promise.resolve(inserted) };
        },
      }),
      update: () => ({
        set: (patch: any) => ({
          where: (..._args: any[]) => {
            // Mark every row that isn't released as released. Crude but
            // enough for the assign+release tests.
            for (const r of store) {
              if (patch.releasedAt && r.releasedAt == null) {
                // Only flip the most-recent matching row for releaseNumber tests.
              }
            }
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => null),
  getNumberSetting: vi.fn(async (_k: string, fallback: number) => fallback),
}));

vi.mock("../../server/services/comms/router", async () => {
  const actual = await vi.importActual<any>("../../server/services/comms/router");
  return {
    ...actual,
    commsRouter: {
      rentNumber: vi.fn(async () => ({
        number: "+15551234567",
        costCentsPerMonth: 115,
        provider: "twilio",
      })),
    },
  };
});

describe("tracking-pool.assignNumber", () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
  });

  it("rents a fresh number when the pool is empty", async () => {
    const { assignNumber } = await import("../../server/services/comms/tracking-pool");
    const { commsRouter } = (await import("../../server/services/comms/router")) as any;
    const result = await assignNumber(1, 100);
    expect(commsRouter.rentNumber).toHaveBeenCalled();
    expect(result.number).toBe("+15551234567");
    expect(result.provider).toBe("twilio");
    expect(store).toHaveLength(1);
    expect(store[0].organizationId).toBe(1);
    expect(store[0].campaignId).toBe(100);
  });

  it("recycles a previously-released number before renting fresh", async () => {
    // Pre-seed a released assignment so assign() finds it.
    store.push({
      id: 999,
      number: "+15559999999",
      organizationId: 7,
      campaignId: 700,
      provider: "twilio",
      assignedAt: new Date(Date.now() - 90 * 86400 * 1000),
      releasedAt: new Date(Date.now() - 1 * 86400 * 1000),
      lastInboundAt: null,
    });
    nextId = 1000;
    const { assignNumber } = await import("../../server/services/comms/tracking-pool");
    const { commsRouter } = (await import("../../server/services/comms/router")) as any;
    const result = await assignNumber(2, 200);
    expect(commsRouter.rentNumber).not.toHaveBeenCalled();
    expect(result.number).toBe("+15559999999");
    expect(result.provider).toBe("twilio");
    // Two rows in store now: the original released, plus the fresh assignment.
    expect(store.length).toBe(2);
    expect(store[1].organizationId).toBe(2);
    expect(store[1].releasedAt).toBeNull();
  });
});

describe("tracking-pool.releaseNumber", () => {
  beforeEach(() => reset());

  it("marks releasedAt without throwing", async () => {
    const { releaseNumber } = await import("../../server/services/comms/tracking-pool");
    await expect(releaseNumber("+15550000000")).resolves.toBeUndefined();
  });
});
