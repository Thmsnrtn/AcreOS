/**
 * POST /api/borrower/verify-payment — a Stripe session must belong to THIS note.
 *
 * The handler resolves the note from the authenticated borrower session, but
 * takes `sessionId` from the request body and then checks only that SOME
 * session on the lender's connected account was paid. `payments.transaction_id`
 * is globally unique (migration 0023), so the first note to record a given
 * session id is the only note that ever can: a caller who supplied another
 * borrower's session id on the same lender would credit their own note with it
 * AND permanently block the real note from recording it.
 *
 * Exploiting that needs an unguessable `cs_…` id, so this is defence in depth
 * rather than an open door. It is also two lines, on a path that moves money.
 *
 * The metadata the check reads is metadata AcreOS wrote itself, in
 * `buildBorrowerCardCheckoutParams`, at session-create time.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Session = {
  id: number;
  noteId: number;
  organizationId: number;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};
const SESSIONS = new Map<string, Session>();
const NOTE_ROW = {
  id: 42,
  organizationId: 7,
  currentBalance: "10000",
  monthlyPayment: "500",
  interestRate: "5",
  lateFee: "0",
  gracePeriodDays: null,
  nextPaymentDate: new Date("2026-04-01"),
  amortizationSchedule: [],
  version: 1,
};

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) => SESSIONS.get(token) ?? null,
    deleteBorrowerSession: async (token: string) => void SESSIONS.delete(token),
    updateBorrowerSessionAccess: async () => {},
    getOrganization: async (id: number) => ({ id, name: "Acme Lender", settings: {} }),
    getLead: async () => null,
    updateNote: vi.fn(async () => NOTE_ROW),
  };
  const makeStep: () => any = () => ({
    from: () => makeStep(),
    where: () => makeStep(),
    orderBy: () => makeStep(),
    limit: () => makeStep(),
    for: () => makeStep(),
    then: (ok: any, no: any) => Promise.resolve([NOTE_ROW]).then(ok, no),
  });
  return { storage, db: { select: () => makeStep() } };
});

/**
 * Records whether the handler ever reached the money-writing transaction.
 *
 * The callback is declared and ignored on purpose: returning the "already
 * recorded" shape short-circuits the handler at its conflict branch, so the
 * legitimate-payment case can be observed reaching the transaction without this
 * test having to stand up an entire drizzle tx.
 */
const withTransactionSpy = vi.fn(
  async (_fn: (tx: unknown) => Promise<unknown>) => ({ row: { id: 1 }, created: false }) as const,
);
vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => withTransactionSpy(fn),
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

/** The Stripe session the lender's connected account hands back. */
let retrievedSession: Record<string, unknown> = {};
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    checkout: { sessions: { retrieve: async () => retrievedSession } },
  }),
  getStripeSecretKey: () => "sk_test_mock",
}));

vi.mock("../../server/services/customerMoneyRouting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/customerMoneyRouting")>()),
  resolveOrgCardProcessor: async () => ({ ok: true, processor: { stripeAccount: "acct_lender" } }),
  customerMoneyReadOptions: () => ({}),
}));

import { registerBorrowerRoutes } from "../../server/routes-borrower";

const TOKEN = "borrower-session-token";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie as string | undefined;
    if (header) {
      for (const part of header.split(";")) {
        const [k, v] = part.trim().split("=");
        if (k) req.cookies[k] = decodeURIComponent(v ?? "");
      }
    }
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

function post(app: express.Express, sessionId: string) {
  return request(app)
    .post("/api/borrower/verify-payment")
    .set("Cookie", `borrower_session=${TOKEN}`)
    .send({ sessionId });
}

describe("POST /api/borrower/verify-payment — the session must belong to this note", () => {
  let app: express.Express;

  beforeEach(() => {
    SESSIONS.clear();
    SESSIONS.set(TOKEN, {
      id: 1,
      noteId: 42,
      organizationId: 7,
      email: "borrower@example.com",
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
    });
    withTransactionSpy.mockClear();
    app = makeApp();
  });

  it("refuses a paid session whose metadata names a different note", async () => {
    retrievedSession = {
      id: "cs_someone_else",
      payment_status: "paid",
      amount_total: 50000,
      metadata: { noteId: "43", organizationId: "7", type: "borrower_portal_payment" },
    };

    const res = await post(app, "cs_someone_else");

    expect(res.status).toBe(400);
    expect(
      withTransactionSpy,
      "the refusal must happen BEFORE the insert — transaction_id is globally " +
        "unique, so writing it here would permanently block note 43 from ever " +
        "recording its own payment",
    ).not.toHaveBeenCalled();
  });

  it("accepts a paid session whose metadata names this note", async () => {
    retrievedSession = {
      id: "cs_mine",
      payment_status: "paid",
      amount_total: 50000,
      metadata: { noteId: "42", organizationId: "7", type: "borrower_portal_payment" },
    };

    const res = await post(app, "cs_mine");

    expect(res.status).toBe(200);
    expect(withTransactionSpy, "the legitimate payment must still be recorded").toHaveBeenCalled();
  });

  it("accepts a paid session that carries no noteId metadata at all", async () => {
    // Sessions minted before the metadata existed must not start failing —
    // a guard that refuses on ABSENT evidence would turn a hardening change
    // into an outage for anyone mid-checkout at deploy time.
    retrievedSession = { id: "cs_legacy", payment_status: "paid", amount_total: 50000, metadata: {} };

    const res = await post(app, "cs_legacy");

    expect(res.status).toBe(200);
    expect(withTransactionSpy).toHaveBeenCalled();
  });
});
