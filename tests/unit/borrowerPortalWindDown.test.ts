/**
 * Founder ruling 2026-09-29 #3 (DEFECT-0106) — the borrower portal follows the
 * lender's servicing phase.
 *
 * After the 90-day wind-down the portal starts no NEW money movement — a card
 * payment, a new bank authorization, switching autopay on — and tells the
 * borrower to pay the lender directly. Turning autopay OFF, signing in and
 * reading the loan keep working. During the wind-down everything still works
 * and the borrower is told when it ends.
 *
 * The phase rule itself is tested in borrowerServicingWindDown.test.ts; this
 * file pins that every portal route that starts money movement consults it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  phase: { phase: "full" } as Record<string, unknown>,
  phaseCalls: [] as number[],
  checkoutCreates: 0,
  mandateStarts: 0,
  updateNote: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SESSION = {
  id: 1,
  noteId: 42,
  organizationId: 7,
  email: "borrower@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(),
};
const NOTE_ROW = {
  id: 42,
  organizationId: 7,
  accessToken: "tok",
  currentBalance: "10000",
  monthlyPayment: "500",
  interestRate: "5",
  autoPayEnabled: false,
  borrowerId: null,
  propertyId: null,
  status: "active",
};
/** An ACH debit attempt still settling for the note (DEFECT-0265). */
const ACH = { inFlight: false };

vi.mock("../../server/storage", async () => {
  const { achDebitAttempts } = await import("@shared/schema/ach-autopay");
  const storage = {
    getBorrowerSession: async () => SESSION,
    deleteBorrowerSession: async () => {},
    updateBorrowerSessionAccess: async () => {},
    getOrganization: async (id: number) => ({ id, name: "Mesa Land", settings: {} }),
    getLead: async () => null,
    getBorrowerLead: async () => null,
    getProperty: async () => null,
    getPayments: async () => [],
    updateNote: async (_id: number, patch: Record<string, unknown>) => {
      h.updateNote.push(patch);
      return NOTE_ROW;
    },
  };
  // The in-flight check reads achDebitAttempts; every other read is the note.
  const makeStep: (rows?: () => unknown[]) => any = (rows = () => [NOTE_ROW]) => ({
    from: (table: unknown) => makeStep(table === achDebitAttempts ? () => (ACH.inFlight ? [{ id: 9 }] : []) : rows),
    where: () => makeStep(rows),
    orderBy: () => makeStep(rows),
    limit: () => makeStep(rows),
    then: (ok: any, no: any) => Promise.resolve(rows()).then(ok, no),
  });
  return { storage, db: { select: () => makeStep() } };
});
vi.mock("../../server/db", () => {
  const makeStep: () => any = () => ({
    from: () => makeStep(),
    where: () => makeStep(),
    orderBy: () => makeStep(),
    limit: () => makeStep(),
    then: (ok: any, no: any) => Promise.resolve([NOTE_ROW]).then(ok, no),
  });
  return { db: { select: () => makeStep() }, withTransaction: vi.fn() };
});
vi.mock("../../server/services/borrower/servicingPhase", async (orig) => ({
  ...(await orig<typeof import("../../server/services/borrower/servicingPhase")>()),
  lenderServicingPhase: async (organizationId: number) => {
    h.phaseCalls.push(organizationId);
    return h.phase;
  },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    checkout: {
      sessions: {
        create: async () => {
          h.checkoutCreates++;
          return { id: "cs_1", url: "https://checkout.example/cs_1" };
        },
      },
    },
  }),
  getStripeSecretKey: () => "sk_test_mock",
}));
vi.mock("../../server/services/customerMoneyRouting", async (orig) => ({
  ...(await orig<typeof import("../../server/services/customerMoneyRouting")>()),
  resolveOrgCardProcessor: async () => ({ ok: true, processor: { stripeAccount: "acct_lender" } }),
  prepareCustomerMoneyCall: (_kind: string, params: unknown) => ({ params, options: {} }),
}));
vi.mock("../../server/services/achMandateSetup", async (orig) => ({
  ...(await orig<typeof import("../../server/services/achMandateSetup")>()),
  getAchMandateSummary: async () => ({ armed: true, status: "active", accountLast4: "6789" }),
  startAchMandateSetup: async () => {
    h.mandateStarts++;
    return { ok: true };
  },
  revokeAchMandatesForNote: async () => 0,
}));

import { registerBorrowerRoutes } from "../../server/routes-borrower";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.cookies = { borrower_session: "tok-session" };
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

const ENDED = { phase: "ended", endedAt: new Date("2026-05-01T00:00:00Z"), windDownEndsAt: new Date("2026-07-30T00:00:00Z") };
const WIND_DOWN = { phase: "wind_down", endedAt: new Date("2026-09-01T00:00:00Z"), windDownEndsAt: new Date("2026-11-30T00:00:00Z") };

let app: express.Express;
beforeEach(() => {
  h.phase = { phase: "full" };
  h.phaseCalls = [];
  h.checkoutCreates = 0;
  h.mandateStarts = 0;
  h.updateNote = [];
  NOTE_ROW.status = "active";
  ACH.inFlight = false;
  app = makeApp();
});

describe("a card payment is refused before the charge when the loan cannot take it (audit of the fourth follow-up)", () => {
  it.each(["paid_off", "foreclosed", "pending"])("a %s loan: refused, no checkout created", async (status) => {
    NOTE_ROW.status = status;
    const res = await request(app).post("/api/borrower/payment").send({});
    expect(res.status).toBe(400);
    expect(h.checkoutCreates).toBe(0);
  });

  it("a defaulted loan takes a card payment — money toward a cure", async () => {
    NOTE_ROW.status = "defaulted";
    expect((await request(app).post("/api/borrower/payment").send({})).status).toBe(200);
    expect(h.checkoutCreates).toBe(1);
  });

  it("an autopay debit still settling: refused (409), no checkout created (DEFECT-0265)", async () => {
    ACH.inFlight = true;
    const res = await request(app).post("/api/borrower/payment").send({});
    expect(res.status).toBe(409);
    expect(h.checkoutCreates).toBe(0);
  });
});

describe("after the wind-down, the portal starts no new money movement", () => {
  beforeEach(() => {
    h.phase = ENDED;
  });

  it("a card payment is refused before any checkout is created, and says to pay the lender directly", async () => {
    const res = await request(app).post("/api/borrower/payment").send({});
    expect(res.status).toBe(400);
    expect(res.body.details).toMatchObject({ reason: "lender_servicing_ended", servicingEndedOn: "2026-07-30" });
    expect(res.body.message).toMatch(/Mesa Land no longer services this loan through AcreOS.*pay them directly/);
    expect(h.checkoutCreates).toBe(0);
    expect(h.phaseCalls).toEqual([7]); // the note's own lender
  });

  it("a new bank authorization is refused before setup starts", async () => {
    const res = await request(app).post("/api/borrower/autopay/mandate").send({ authorizationAccepted: true });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe("lender_servicing_ended");
    expect(h.mandateStarts).toBe(0);
  });

  it("a bank setup started before the end does not arm after it", async () => {
    const res = await request(app).post("/api/borrower/autopay/mandate/confirm").send({ setupReference: "seti_1" });
    expect(res.status).toBe(400);
    expect(res.body.details.reason).toBe("lender_servicing_ended");
  });

  it("switching autopay ON is refused; switching it OFF still works", async () => {
    const on = await request(app).post("/api/borrower/autopay").send({ enabled: true });
    expect(on.status).toBe(400);
    expect(on.body.details.reason).toBe("lender_servicing_ended");
    expect(h.updateNote).toEqual([]);

    const off = await request(app).post("/api/borrower/autopay").send({ enabled: false });
    expect(off.status).toBe(200);
    expect(h.updateNote).toEqual([{ autoPayEnabled: false }]);
  });

  it("signing in still works, and the loan data says payments here have ended", async () => {
    const res = await request(app).get("/api/borrower/session");
    expect(res.status).toBe(200);
    expect(res.body.servicing).toEqual({ phase: "ended", paymentsThroughPortalUntil: "2026-07-30" });
  });
});

describe("during the wind-down, everything still works and the borrower is told when it ends", () => {
  beforeEach(() => {
    h.phase = WIND_DOWN;
  });

  it("a card payment proceeds", async () => {
    const res = await request(app).post("/api/borrower/payment").send({});
    expect(res.status).toBe(200);
    expect(h.checkoutCreates).toBe(1);
  });

  it("the loan data carries the date payments here end", async () => {
    const res = await request(app).get("/api/borrower/session");
    expect(res.body.servicing).toEqual({ phase: "wind_down", paymentsThroughPortalUntil: "2026-11-30" });
  });
});

describe("full servicing", () => {
  it("a card payment proceeds and the loan data says so", async () => {
    expect((await request(app).post("/api/borrower/payment").send({})).status).toBe(200);
    expect((await request(app).get("/api/borrower/session")).body.servicing).toEqual({ phase: "full" });
  });
});
