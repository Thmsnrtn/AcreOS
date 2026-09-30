/**
 * Audit of 92bf405 — `POST /api/payments` (the finance page's "Record
 * payment") recorded a timed-out payment twice. The client sent an
 * Idempotency-Key that nothing on the server read (no middleware on the
 * route), and minted a new one on every click anyway. The key is now the
 * row's unique transactionId: a retry collides and is answered with the
 * payment already recorded; the same key for a different payment is refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { payments } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  byTxn: new Map<string, Record<string, unknown>>(),
  audit: 0,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getNote: async (orgId: number, id: number) =>
      orgId === 5 && id === 77
        ? { id: 77, organizationId: 5, currentBalance: "10000.00", interestRate: "6", nextPaymentDate: new Date("2026-10-01T00:00:00Z") }
        : undefined,
    createPayment: async (p: Record<string, unknown>) => {
      const txn = p.transactionId as string | undefined;
      if (txn && S.byTxn.has(txn)) {
        // drizzle wraps the driver error; the SQLSTATE is on `cause`.
        throw Object.assign(new Error("duplicate key"), { cause: { code: "23505" } });
      }
      const row = { id: S.created.length + 1, ...p };
      S.created.push(row);
      if (txn) S.byTxn.set(txn, row);
      return row;
    },
    createAuditLogEntry: async () => void S.audit++,
  },
  calculateMonthlyPayment: () => 0,
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => (t === payments ? [...S.byTxn.values()].slice(-1) : []),
        }),
      }),
    }),
  },
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerFinanceRoutes } = await import("../../server/routes-finance");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerFinanceRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/payments");
  if (!r) throw new Error("POST /api/payments not registered");
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r = { statusCode: 200, body: undefined as Record<string, unknown> | undefined } as {
    statusCode: number;
    body?: Record<string, unknown>;
    status: (c: number) => unknown;
    json: (b: Record<string, unknown>) => unknown;
  };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: Record<string, unknown>) => ((r.body = b), r);
  return r;
}
const body = (amount: string) => ({
  noteId: 77,
  amount,
  principalAmount: "50.00",
  interestAmount: "50.00",
  paymentDate: new Date("2026-09-30T12:00:00Z").toISOString(),
  dueDate: new Date("2026-10-01T00:00:00Z").toISOString(),
  paymentMethod: "ach",
  status: "completed",
});
const req = (b: Record<string, unknown>, key?: string) => ({
  body: b,
  headers: key ? { "idempotency-key": key } : {},
  organization: { id: 5 },
  user: { id: "u1" },
  ip: "127.0.0.1",
});

beforeEach(() => {
  S.created = [];
  S.byTxn = new Map();
  S.audit = 0;
});

describe("a finance payment is recorded once per operation", () => {
  it("a retry under the same key is answered with the recorded payment — no second row", async () => {
    const h = await handler();
    const first = res();
    await h(req(body("100.00"), "op-key-0001"), first);
    expect(first.statusCode).toBe(201);
    const retry = res();
    await h(req(body("100.00"), "op-key-0001"), retry);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true, id: first.body!.id });
    expect(S.created).toHaveLength(1);
    expect(S.audit).toBe(1);
  });

  it("the key is stored as the row's org-qualified transactionId", async () => {
    const h = await handler();
    await h(req(body("100.00"), "op-key-0002"), res());
    expect(S.created[0].transactionId).toBe("op:5:op-key-0002");
  });

  it("the same key for a different amount is refused (409) — nothing written", async () => {
    const h = await handler();
    await h(req(body("100.00"), "op-key-0003"), res());
    const other = res();
    await h(req(body("250.00"), "op-key-0003"), other);
    expect(other.statusCode).toBe(409);
    expect(other.body).toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
    expect(S.created).toHaveLength(1);
  });
});

describe("the route records what the finance page sends, split by the server", () => {
  it("JSON dates are accepted (the route answered 400 to every finance-page payment)", async () => {
    const h = await handler();
    const r = res();
    await h(req(body("100.00")), r);
    expect(r.statusCode).toBe(201);
    expect(S.created[0].paymentDate).toBeInstanceOf(Date);
  });

  it("principal and interest come from the note in integer cents, not from the browser", async () => {
    const h = await handler();
    // Browser claims a 50/50 split; 6% on $10,000 is $50.00 of interest a month.
    await h(req({ ...body("100.00"), principalAmount: "99.00", interestAmount: "1.00" }), res());
    expect(S.created[0]).toMatchObject({ amount: "100.00", interestAmount: "50.00", principalAmount: "50.00" });
  });

  it("more than the payoff is refused — the excess is not invented into principal", async () => {
    const h = await handler();
    const r = res();
    await h(req(body("20000.00")), r);
    expect(r.statusCode).toBe(400);
    expect(S.created).toHaveLength(0);
  });

  it("another org's note is not found", async () => {
    const h = await handler();
    const r = res();
    await h(req({ ...body("100.00"), noteId: 78 }), r);
    expect(r.statusCode).toBe(404);
    expect(S.created).toHaveLength(0);
  });
});

describe("every client that records a payment holds one key per operation", () => {
  it("useRecordPayment keys on the payment, not the body (whose paymentDate changes per click), and settles", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/hooks/use-payments.ts"), "utf8"));
    expect(src).not.toMatch(/idempotent:\s*true/);
    expect(src).toMatch(/operationKey\.keyFor\(\{\s*noteId: data\.noteId,\s*amount:/);
    expect(src).toMatch(/onSuccess:[\s\S]*operationKey\.settle\(\)/);
  });

  // The population: every client module that POSTs a payment. A new one that
  // does not hold a key per operation is the thing that fails.
  const PAYMENT_CLIENTS: Array<{ file: string; keyed: RegExp }> = [
    { file: "client/src/hooks/use-payments.ts", keyed: /keyFor\(\{\s*noteId: data\.noteId/ },
    { file: "client/src/components/note-record-payment-modal.tsx", keyed: /keyFor\(\{\s*noteId: note\.id,\s*\.\.\.body\s*\}\)/ },
    { file: "client/src/components/mobile/QuickAddSheet.tsx", keyed: /keyFor\(\{\s*noteId,\s*\.\.\.body\s*\}\)/ },
    { file: "client/src/pages/rent-roll.tsx", keyed: /keyFor\(\{\s*leaseId,\s*\.\.\.paymentBody\s*\}\)/ },
  ];
  it.each(PAYMENT_CLIENTS)("$file keys each operation by what makes it the same payment", async ({ file, keyed }) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../..", file), "utf8"));
    expect(src).toMatch(/useOperationKey\(\)/);
    expect(src).toMatch(keyed);
    expect(src).toMatch(/\.settle\(\)/);
  });
});
