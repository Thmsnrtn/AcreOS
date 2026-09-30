/**
 * Audits of 92bf405 and 224a5c0 — `POST /api/payments` (the finance page's
 * "Record payment").
 *
 * It answered 400 to every submit (JSON dates), split in the browser in
 * float, and ignored its Idempotency-Key. Once it worked it was a second-class
 * writer: it lowered the balance and nothing else — the installment and due
 * date never moved (the note stayed overdue; autopay could debit the same
 * installment), no late-fee rule, no payment.received — and any member could
 * post. It now posts through THE serviced-note rule (postServicedNotePayment),
 * owner/admin only, keyed by a required Idempotency-Key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  posted: [] as Array<Record<string, unknown>>,
  byTxn: new Map<string, Record<string, unknown>>(),
  audit: 0,
  owedFeeCents: 0,
  assessed: 0,
  lookupTxn: "",
  noteStatus: "active",
  balance: "10000.00",
  paysDown: false,
}));

vi.mock("../../server/services/notes/servicedLateFees", async (orig) => ({
  ...(await orig<typeof import("../../server/services/notes/servicedLateFees")>()),
  assessServicedNoteLateFee: async () => void S.assessed++,
  outstandingServicedLateFeesCents: async () => S.owedFeeCents,
}));

vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: (roles: string[]) => Object.assign((_q: unknown, _r: unknown, next: () => void) => next(), { roles }),
}));
vi.mock("../../server/services/borrower/portalPaymentPosting", () => ({
  postServicedNotePayment: async (input: Record<string, unknown>) => {
    const txn = input.transactionId as string;
    const prior = S.byTxn.get(txn);
    if (prior) return { outcome: "already_recorded", payment: prior };
    const payment = {
      id: S.posted.length + 1,
      noteId: (input.note as { id: number }).id,
      amount: ((input.amountCents as number) / 100).toFixed(2),
      transactionId: txn,
    };
    S.posted.push(input);
    S.byTxn.set(txn, payment);
    // A payoff pays the note down, as the real posting does.
    if (S.paysDown && (input.amountCents as number) >= 1_005_000) S.balance = "0.00";
    return { outcome: "posted", payment, installment: "applied", nextPaymentDate: null, remainingBalanceCents: 0, lateFeeCents: 0 };
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getNote: async (orgId: number, id: number) =>
      orgId === 5 && id === 77
        ? { id: 77, organizationId: 5, status: S.noteStatus, currentBalance: S.balance, interestRate: "6", monthlyPayment: "100.00", nextPaymentDate: new Date("2026-10-01T00:00:00Z") }
        : undefined,
    createAuditLogEntry: async () => void S.audit++,
  },
  calculateMonthlyPayment: () => 0,
  // The replay lookup reads the payment recorded under this request's
  // transactionId (org-scoped) before anything else runs.
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const row = S.byTxn.get(S.lookupTxn);
            return row ? [row] : [];
          },
        }),
      }),
    }),
  },
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function registration(): Promise<unknown[]> {
  const { registerFinanceRoutes } = await import("../../server/routes-finance");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerFinanceRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/payments");
  if (!r) throw new Error("POST /api/payments not registered");
  return r.args;
}
async function handler(): Promise<Handler> {
  const args = await registration();
  return args[args.length - 1] as Handler;
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
const body = (amount: string) => ({ noteId: 77, amount, paymentMethod: "check" });
const req = (b: Record<string, unknown>, key: string | null = "op-key-0001") => (S.lookupTxn = `op:5:${key}`, {
  body: b,
  headers: key ? { "idempotency-key": key } : {},
  organization: { id: 5 },
  user: { id: "u1" },
  ip: "127.0.0.1",
});

beforeEach(() => {
  S.posted = [];
  S.byTxn = new Map();
  S.audit = 0;
  S.owedFeeCents = 0;
  S.assessed = 0;
  S.lookupTxn = "";
  S.noteStatus = "active";
  S.balance = "10000.00";
  S.paysDown = false;
});

describe("a recorded payment is a real posting", () => {
  it("posts through the serviced-note rule — the one that advances the installment and emits payment.received", async () => {
    const r = res();
    await (await handler())(req(body("100.00")), r);
    expect(r.statusCode).toBe(201);
    expect(S.posted).toHaveLength(1);
    expect(S.posted[0]).toMatchObject({
      amountCents: 10_000,
      transactionId: "op:5:op-key-0001",
      source: "operator_recorded",
      paymentMethod: "check",
      sendReceipt: false,
    });
    expect(r.body).toMatchObject({ installment: "applied" });
  });

  it("is owner/admin only", async () => {
    const args = await registration();
    const guards = args.slice(0, -1).filter((a) => Array.isArray((a as { roles?: unknown }).roles));
    expect(guards.map((g) => (g as { roles: string[] }).roles)).toEqual([["owner", "admin"]]);
  });

  it("the browser's split, status, fee and transactionId are not read", async () => {
    await (await handler())(
      req({ ...body("100.00"), principalAmount: "99.00", status: "completed", lateFeeAmount: "500", transactionId: "pi_forged" }),
      res(),
    );
    expect(S.posted[0].transactionId).toBe("op:5:op-key-0001");
    expect(Object.keys(S.posted[0]).sort()).toEqual(["amountCents", "note", "paymentMethod", "sendReceipt", "source", "transactionId"]);
  });

  it("more than the payoff is refused — nothing posted", async () => {
    const r = res();
    await (await handler())(req(body("20000.00")), r);
    expect(r.statusCode).toBe(400);
    expect(S.posted).toHaveLength(0);
  });

  it("the payoff includes late fees owed — the quoted payoff is accepted, a cent more is refused (audit of 7cc7345)", async () => {
    S.owedFeeCents = 2_500; // $25 assessed and unpaid
    // $10,000.00 balance + $50.00 of interest + $25.00 of fees.
    const exact = res();
    await (await handler())(req(body("10075.00"), "op-key-0100"), exact);
    expect(exact.statusCode).toBe(201);
    const over = res();
    await (await handler())(req(body("10075.01"), "op-key-0101"), over);
    expect(over.statusCode).toBe(400);
    expect(over.body).toMatchObject({ details: { payoffCents: 1_007_500, lateFeesIncludedCents: 2_500 } });
    expect(S.assessed).toBeGreaterThan(0);
  });

  it("a retried payoff is replayed — not refused as 'more than the payoff' by the balance it just paid (audit of 9ed61f4)", async () => {
    S.paysDown = true;
    const h = await handler();
    const first = res();
    await h(req(body("10050.00"), "op-key-0200"), first);
    expect(first.statusCode).toBe(201);
    const retry = res();
    await h(req(body("10050.00"), "op-key-0200"), retry);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true });
    expect(S.posted).toHaveLength(1);
  });

  it("a paid-off note takes no payment, and the attempt assesses no fee (audit of 9ed61f4)", async () => {
    S.noteStatus = "paid_off";
    const r = res();
    await (await handler())(req(body("100.00"), "op-key-0201"), r);
    expect(r.statusCode).toBe(400);
    expect(S.assessed).toBe(0);
    expect(S.posted).toHaveLength(0);
  });

  it("another org's note is not found", async () => {
    const r = res();
    await (await handler())(req({ ...body("100.00"), noteId: 78 }), r);
    expect(r.statusCode).toBe(404);
    expect(S.posted).toHaveLength(0);
  });
});

describe("a finance payment is recorded once per operation", () => {
  it("no key (or a malformed one) is refused — nothing posted", async () => {
    for (const key of [null, "short", "has spaces in it"]) {
      const r = res();
      await (await handler())(req(body("100.00"), key), r);
      expect(r.statusCode).toBe(400);
    }
    expect(S.posted).toHaveLength(0);
  });

  it("a retry under the same key is answered with the recorded payment — no second posting", async () => {
    const h = await handler();
    const first = res();
    await h(req(body("100.00")), first);
    const retry = res();
    await h(req(body("100.00")), retry);
    expect(retry.statusCode).toBe(200);
    expect(retry.body).toMatchObject({ replayed: true, id: first.body!.id });
    expect(S.posted).toHaveLength(1);
    expect(S.audit).toBe(1);
  });

  it("the same key for a different amount is refused (409)", async () => {
    const h = await handler();
    await h(req(body("100.00"), "op-key-0003"), res());
    const other = res();
    await h(req(body("250.00"), "op-key-0003"), other);
    expect(other.statusCode).toBe(409);
    expect(other.body).toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
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

  it("the finance page holds the key above the modal, so close → reopen → retry keeps it", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/finance.tsx"), "utf8"));
    const modal = src.slice(src.indexOf("function RecordPaymentModal("));
    expect(modal.length).toBeGreaterThan(100);
    expect(modal.slice(0, modal.indexOf("\nfunction ", 10))).not.toMatch(/useRecordPayment\(\)/);
    expect(src).toMatch(/const recordPayment = useRecordPayment\(\);/);
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
