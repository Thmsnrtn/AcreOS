/**
 * S-05 (P1-4b) — borrower → lender message visibility, proven end-to-end.
 *
 * The defect was silent starvation: the borrower portal wrote
 * `borrower_messages` rows (`POST /api/borrower/messages`), the lender
 * routes existed (`GET /api/notes/:noteId/borrower-messages` + unread-count),
 * but no client ever called the lender side and nothing notified the
 * lender — the borrower talked into a void.
 *
 * The source pins in `borrowerMessageWiring.test.ts` prove the panel calls
 * the routes. THIS test proves the behaviour the pins describe, through the
 * real route handlers on both sides sharing one storage contract:
 *
 *   1. a message written through the BORROWER route appears through the
 *      LENDER route for the same note/org;
 *   2. the lender unread-count is 1 before the lender looks and 0 after —
 *      the lender GET is the real mark-read path;
 *   3. the borrower's send notifies the note's org (the notify hook the
 *      route calls after the write);
 *   4. the lender's reply (pre-existing route, wired by the panel) is
 *      visible back on the borrower side;
 *   5. a note outside the lender's org is a 404, not a leak.
 *
 * Storage is an in-memory implementation of the same interface
 * `growthConfigRepo` implements against Postgres (create/get/markRead/
 * countUnread have identical semantics: org+note scoping, readAt null =
 * unread, mark-read filtered by senderType).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ROWS = vi.hoisted(() => ({ list: [] as Array<Record<string, any>>, nextId: 1 }));
const NOTIFY = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
const TABLES = vi.hoisted(() => ({ notes: null as any }));

const NOTE_ROW = { id: 42, organizationId: 7, borrowerId: 9, status: "active" };
const SESSION = {
  id: 1,
  noteId: 42,
  organizationId: 7,
  email: "borrower@example.com",
  expiresAt: new Date(Date.now() + 3_600_000),
  createdAt: new Date(),
};

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) => (token === "borrower-token" ? SESSION : null),
    deleteBorrowerSession: async () => {},
    updateBorrowerSessionAccess: async () => {},
    getOrganization: async (id: number) => ({ id, name: "Acme Lender", settings: {} }),
    getNote: async (orgId: number, noteId: number) =>
      orgId === 7 && noteId === 42 ? NOTE_ROW : undefined,
    createBorrowerMessage: async (data: Record<string, unknown>) => {
      const row = { id: ROWS.nextId++, createdAt: new Date(), ...data };
      ROWS.list.push(row);
      return row;
    },
    getBorrowerMessages: async (orgId: number, noteId: number) =>
      ROWS.list
        .filter((r) => r.orgId === orgId && r.noteId === noteId)
        .sort((a, b) => a.id - b.id),
    markBorrowerMessagesRead: async (noteId: number, senderType: string) => {
      for (const r of ROWS.list) {
        if (r.noteId === noteId && r.senderType === senderType && r.readAt == null) {
          r.readAt = new Date();
        }
      }
    },
    countUnreadBorrowerMessages: async (noteId: number, senderType: string) =>
      ROWS.list.filter(
        (r) => r.noteId === noteId && r.senderType === senderType && r.readAt == null,
      ).length,
    getTeamMembers: async () => [],
    createNotification: async (row: Record<string, unknown>) => ({ id: 1, ...row }),
  };
  const makeStep = (table: any): any => ({
    from: (t: any) => makeStep(t),
    where: () => makeStep(table),
    orderBy: () => makeStep(table),
    limit: () => makeStep(table),
    then: (ok: any, no: any) =>
      Promise.resolve(table != null && table === TABLES.notes ? [NOTE_ROW] : []).then(ok, no),
  });
  const db = { select: () => makeStep(null) };
  return { storage, db };
});

// The borrower POST looks the note up through `db` from ./storage; matching
// the table object needs the real schema table, handed to the mock through
// the hoisted holder above.
import { notes as notesTable } from "@shared/schema";
TABLES.notes = notesTable;

vi.mock("../../server/db", () => {
  const step: any = {
    from: () => step,
    where: () => step,
    limit: () => step,
    then: (ok: any, no: any) => Promise.resolve([]).then(ok, no),
  };
  return { db: { select: () => step }, withTransaction: async (fn: any) => fn() };
});

vi.mock("../../server/services/borrowerMessageNotify", () => ({
  BORROWER_MESSAGE_EVENT_ID: "finance.borrower_message",
  notifyLenderOfBorrowerMessage: async (notice: Record<string, unknown>) => {
    NOTIFY.calls.push(notice);
    return { pushed: false, inApp: 0 };
  },
}));

vi.mock("../../server/services/notes/servicedLateFees", () => ({
  ACH_IN_FLIGHT_STATUSES: ["created", "submitted", "processing"],
  assessServicedNoteLateFee: async () => ({ assessed: false, alreadyExisted: false, feeCents: 0, reason: "test" }),
  outstandingServicedLateFeesCents: async () => 0,
  lateFeeDueByCents: async () => 0,
  feeFromExcessCents: () => 0,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "lender-user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    req.organization = { id: 7, name: "Acme Lender" };
    next();
  },
}));
vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));
vi.mock("../../server/services/founderAdAccountSecrets", () => ({
  maskAdAccountSecret: (s: string) => s,
}));
vi.mock("../../server/services/onboarding/demoDataSeeder", () => ({
  seedDemoDataForOrg: async () => ({}),
}));
vi.mock("../../server/services/benchmarks", () => ({
  benchmarkFor: () => null,
  BENCHMARK_KEYS: [],
}));
vi.mock("../../server/services/alerting", () => ({ alertingService: {} }));
vi.mock("../../server/services/founder", () => ({ isFounderIdentity: () => false }));
vi.mock("../../server/services/aiSpendGuard", () => ({
  meteredChatCompletion: async () => {
    throw new Error("not used by the messaging routes");
  },
}));
vi.mock("../../server/utils/permissions", () => ({
  requirePermission: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));
vi.mock("../../server/ai/untrustedEnvelope", () => ({ wrapUntrusted: (s: string) => s }));
vi.mock("../../server/utils/sanitizePrompt", () => ({ sanitizePromptInline: (s: string) => s }));

import { registerBorrowerRoutes } from "../../server/routes-borrower";
import { registerAdminRoutes } from "../../server/routes-admin";

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
  registerAdminRoutes(app);
  return app;
}

const BORROWER = { Cookie: "borrower_session=borrower-token" };

describe("S-05: a borrower message appears on the lender side", () => {
  let app: express.Express;

  beforeEach(() => {
    ROWS.list.length = 0;
    ROWS.nextId = 1;
    NOTIFY.calls.length = 0;
    app = makeApp();
  });

  it("borrower POST → lender unread badge → lender thread (marks read) → borrower sees the reply", async () => {
    // Nothing yet: the lender badge is 0 and the thread is empty.
    const emptyCount = await request(app).get("/api/notes/42/borrower-messages/unread-count");
    expect(emptyCount.status).toBe(200);
    expect(emptyCount.body).toEqual({ count: 0 });

    // The borrower writes through the portal route.
    const sent = await request(app)
      .post("/api/borrower/messages")
      .set(BORROWER)
      .send({ content: "Hi — my payment will be two days late this month." });
    expect(sent.status).toBe(201);
    expect(sent.body.senderType).toBe("borrower");
    expect(sent.body.noteId).toBe(42);

    // …and the lender is notified, scoped to the note's own org.
    expect(NOTIFY.calls).toHaveLength(1);
    expect(NOTIFY.calls[0]).toMatchObject({ orgId: 7, noteId: 42, messageId: sent.body.id });

    // The lender badge now shows the waiting message.
    const badge = await request(app).get("/api/notes/42/borrower-messages/unread-count");
    expect(badge.body).toEqual({ count: 1 });

    // The lender opens the thread: the borrower's message is THERE.
    const thread = await request(app).get("/api/notes/42/borrower-messages");
    expect(thread.status).toBe(200);
    expect(thread.body).toHaveLength(1);
    expect(thread.body[0].content).toContain("payment will be two days late");
    expect(thread.body[0].senderType).toBe("borrower");

    // Viewing marked it read through the real path — the badge clears.
    const cleared = await request(app).get("/api/notes/42/borrower-messages/unread-count");
    expect(cleared.body).toEqual({ count: 0 });

    // The lender replies through the pre-existing reply route the panel
    // calls, and the borrower sees the reply in their own thread.
    const reply = await request(app)
      .post("/api/notes/42/borrower-messages/reply")
      .send({ content: "Thanks for telling me — noted, no late fee this once." });
    expect(reply.status).toBe(201);
    expect(reply.body.senderType).toBe("lender");

    const borrowerThread = await request(app).get("/api/borrower/messages").set(BORROWER);
    expect(borrowerThread.status).toBe(200);
    expect(borrowerThread.body).toHaveLength(2);
    expect(borrowerThread.body[1].content).toContain("no late fee this once");
  });

  it("a note outside the lender's org does not leak its thread", async () => {
    const res = await request(app).get("/api/notes/999/borrower-messages");
    expect(res.status).toBe(404);
    const count = await request(app).get("/api/notes/999/borrower-messages/unread-count");
    expect(count.status).toBe(404);
  });
});
