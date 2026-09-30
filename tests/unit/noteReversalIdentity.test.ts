/**
 * Quality directive 2026-09-29 (money truth) — an NSF reversal backs out ONE
 * real payment on THIS note, once, by exactly what it posted; and a retried
 * "record this payment" is recorded once.
 *
 * `POST /api/notes/:id/payments` stored any `originalPaymentId` unchecked with
 * any amounts: a reversal could name no payment, another note's payment, or a
 * payment already reversed, and raise the balance by an invented amount.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { acquiredNotes, notePayments } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/workflow-engine", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  emitPaymentEvent: vi.fn(),
  emitDurablePaymentEvent: vi.fn(),
}));

const S = vi.hoisted(() => ({
  note: null as null | Record<string, unknown>,
  /** Results for successive un-projected notePayments selects (replay lookup, original). */
  paymentSelects: [] as unknown[][],
  priorReversal: [] as unknown[],
  inserted: [] as Array<Record<string, unknown>>,
  noteUpdates: [] as Array<Record<string, unknown>>,
}));

function chain(rows: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["where", "limit", "for", "orderBy"]) c[m] = () => c;
  c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(rows()).then(f, r);
  return c;
}
const tx = {
  select: (proj?: Record<string, unknown>) => ({
    from: (t: unknown) =>
      chain(() => {
        if (t === acquiredNotes) return S.note ? [S.note] : [];
        if (t === notePayments) {
          if (proj && Object.keys(proj).length === 1 && "id" in proj) return S.priorReversal;
          return S.paymentSelects.shift() ?? [];
        }
        return [];
      }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        S.inserted.push(v);
        return [{ id: "pay-new", ...v }];
      },
    }),
  }),
  update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void S.noteUpdates.push(v) }) }),
};
vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => chain(() => []) }) },
  withTransaction: async (cb: (t: unknown) => unknown) => cb(tx),
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerNoteRoutes } = await import("../../server/routes-notes");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerNoteRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/notes/:id/payments");
  if (!r) throw new Error("route not registered");
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r: Record<string, unknown> & { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: Record<string, unknown>) => ((r.body = b), r);
  return r as { statusCode: number; body: Record<string, unknown> } & Record<string, unknown>;
}
const req = (body: Record<string, unknown>, headers: Record<string, string> = {}) => ({
  params: { id: "note-1" },
  body,
  headers,
  organization: { id: 5 },
  user: { id: "u1" },
});

const ORIGINAL = {
  id: "pay-orig",
  noteId: "note-1",
  organizationId: 5,
  paymentType: "regular",
  principalCents: 30_000,
  interestCents: 12_000,
  escrowCents: 0,
  lateFeeCents: 0,
  unappliedCents: 0,
};

beforeEach(() => {
  S.note = {
    id: "note-1",
    currentBalanceCents: 1_000_000,
    unappliedBalanceCents: 0,
    status: "performing",
    paymentAmountCents: 42_000,
    paymentDueDay: 1,
    originationDate: "2025-01-01",
    maturityDate: "2035-01-01",
    acquisitionDate: "2025-06-01",
    firstPaymentDate: "2025-02-01",
    paidThroughDate: "2026-08-01",
    nextPaymentDate: "2026-09-01",
    gracePeriodDays: 10,
    lateFeeCents: 2_500,
    consecutiveOnTimePayments: 3,
    reperformingThresholdMet: false,
  };
  S.paymentSelects = [];
  S.priorReversal = [];
  S.inserted = [];
  S.noteUpdates = [];
});

describe("an NSF reversal backs out one real payment, once, exactly", () => {
  it("naming no payment on this note is refused — nothing written", async () => {
    S.paymentSelects = [[]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "ghost", principalCents: -99_999 }), r);
    expect(r.statusCode).toBe(400);
    expect(S.inserted).toEqual([]);
    expect(S.noteUpdates).toEqual([]);
  });

  it("an invented amount is refused — the balance cannot rise by more than the payment posted", async () => {
    S.paymentSelects = [[ORIGINAL]];
    const r = res();
    await (await handler())(
      req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "pay-orig", principalCents: -90_000, interestCents: -12_000 }),
      r,
    );
    expect(r.statusCode).toBe(400);
    expect(String(r.body.message)).toMatch(/exactly negate/);
    expect(S.inserted).toEqual([]);
  });

  it("a payment already reversed cannot be reversed again", async () => {
    S.paymentSelects = [[ORIGINAL]];
    S.priorReversal = [{ id: "pay-rev-1" }];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "pay-orig" }), r);
    expect(r.statusCode).toBe(400);
    expect(String(r.body.message)).toMatch(/already been reversed/);
  });

  it("an unapplied_apply moved no cash — it is not reversible as a bounced payment", async () => {
    S.paymentSelects = [[{ ...ORIGINAL, paymentType: "unapplied_apply", principalCents: 30_000, unappliedCents: -30_000 }]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "pay-orig" }), r);
    expect(r.statusCode).toBe(400);
    expect(S.inserted).toEqual([]);
  });

  it("a bounced partial whose held funds were already applied is refused — the ledger and balance would disagree", async () => {
    S.note = { ...S.note!, unappliedBalanceCents: 0 };
    S.paymentSelects = [[{ ...ORIGINAL, paymentType: "partial", principalCents: 0, interestCents: 0, unappliedCents: 20_000 }]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "pay-orig" }), r);
    expect(r.statusCode).toBe(400);
    expect(String(r.body.message)).toMatch(/already applied/);
  });

  it("with no amounts sent, the reversal is the original's exact negation", async () => {
    S.paymentSelects = [[ORIGINAL]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", paymentType: "nsf_reversal", originalPaymentId: "pay-orig" }), r);
    expect(r.statusCode).toBe(201);
    expect(S.inserted[0]).toMatchObject({ principalCents: -30_000, interestCents: -12_000, originalPaymentId: "pay-orig" });
    expect(S.noteUpdates[0].currentBalanceCents).toBe(1_030_000);
  });
});

describe("a retried payment is recorded once", () => {
  it("the same Idempotency-Key finds the recorded payment; the balance does not move again", async () => {
    S.paymentSelects = [[{
      id: "pay-1", noteId: "note-1", organizationId: 5, operationKey: "op-9", paymentType: "regular", paymentDate: "2026-09-10",
      principalCents: 30_000, interestCents: 12_000, escrowCents: 0, lateFeeCents: 0, unappliedCents: 0,
    }]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", principalCents: 30_000, interestCents: 12_000 }, { "idempotency-key": "op-9" }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ replayed: true, payment: { id: "pay-1" } });
    expect(S.inserted).toEqual([]);
    expect(S.noteUpdates).toEqual([]);
  });

  it("the same key with a different amount is refused (409) — nothing is recorded", async () => {
    S.paymentSelects = [[{
      id: "pay-1", noteId: "note-1", organizationId: 5, operationKey: "op-11", paymentType: "regular", paymentDate: "2026-09-10",
      principalCents: 30_000, interestCents: 12_000, escrowCents: 0, lateFeeCents: 0, unappliedCents: 0,
    }]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", principalCents: 35_000, interestCents: 12_000 }, { "idempotency-key": "op-11" }), r);
    expect(r.statusCode).toBe(409);
    expect(S.inserted).toEqual([]);
  });

  it("a first attempt stores its key on the row", async () => {
    S.paymentSelects = [[]];
    const r = res();
    await (await handler())(req({ paymentDate: "2026-09-10", principalCents: 30_000, interestCents: 12_000 }, { "idempotency-key": "op-10" }), r);
    expect(r.statusCode).toBe(201);
    expect(S.inserted[0].operationKey).toBe("op-10");
  });
});
