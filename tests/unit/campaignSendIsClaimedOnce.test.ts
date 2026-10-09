/**
 * Audit of 224a5c0 — a campaign mail send is claimed ONCE, before any credit
 * moves. The response cache only answers a retry after the first send has
 * finished; a retry arriving while the first was still printing (the client
 * gives up at 30s) opened a second mailing order with new piece keys, debited
 * again, and printed the remaining pieces twice. The mailing order now carries
 * the Idempotency-Key under a unique (org, key) index and is opened before
 * the debit: the duplicate collides and is answered 409 with nothing charged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mailingOrders } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  claimed: new Map<string, { id: number; status: string }>(),
  orders: [] as Array<Record<string, unknown>>,
  orderUpdates: [] as Array<{ id: number; patch: Record<string, unknown> }>,
  deducted: [] as number[],
  deductOk: true,
  lobCalls: 0,
  refunds: [] as number[],
  failSendingUpdate: false,
}));

vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_q: unknown, _r: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/credits", () => ({
  creditService: {
    getBalance: async () => 1_000_000,
    // Mirrors creditService: the debit row on success (negative amount), null when refused.
    deductCredits: async (_o: number, cents: number) => (S.deducted.push(cents), S.deductOk ? { id: 1, amountCents: -cents } : null),
    addCredits: async (_o: number, cents: number) => (S.refunds.push(cents), true),
  },
  usageMeteringService: {},
}));
vi.mock("../../server/services/preMailDedupe", () => ({
  runPreMailDedupe: async ({ leadIds }: { leadIds: number[] }) => ({
    acceptedLeads: leadIds.map((id) => ({ id })),
    totals: { input: leadIds.length, skipped: 0 },
    skipped: { ownedParcel: [], recentlyMailed: [], returnedMail: [], doNotContact: [], missingAddress: [] },
  }),
}));
vi.mock("../../server/services/directMail", () => ({
  directMailService: {
    hasOrgLobCredentials: async () => false,
    isAvailable: () => true,
    sendPostcard: async () => (S.lobCalls++, { id: "psc_1" }),
    sendLetter: async () => (S.lobCalls++, { id: "ltr_1" }),
  },
  DIRECT_MAIL_COSTS: { letter_1_page: 150, postcard_4x6: 100, postcard_6x9: 120, postcard_6x11: 130 },
  MailAlreadySentError: class extends Error {},
}));
vi.mock("../../server/storage", () => ({
  storage: {
    // Content is required now: a campaign without it is refused before the
    // claim rather than mailed with placeholder text.
    getCampaign: async () => ({ id: 3, name: "Fall letters", type: "direct_mail", content: "<p>Hi</p>" }),
    getDefaultMailSenderIdentity: async () => ({
      id: 1, name: "Acme", status: "verified", companyName: "Acme Land", addressLine1: "1 Main", city: "Austin", state: "TX", zipCode: "78701", country: "US",
    }),
    getLead: async (_o: number, id: number) => ({ id, firstName: "A", lastName: "B", address: "2 Elm", city: "Llano", state: "TX", zip: "78643" }),
    createMailingOrder: async (o: Record<string, unknown>) => {
      const key = o.operationKey as string | null;
      if (key && S.claimed.has(key)) {
        throw Object.assign(new Error("duplicate key value"), { cause: { code: "23505" } });
      }
      const row = { id: S.orders.length + 1, ...o };
      S.orders.push(row);
      if (key) S.claimed.set(key, { id: row.id, status: "sending" });
      return row;
    },
    updateMailingOrder: async (id: number, patch: Record<string, unknown>) => {
      if (patch.status === "sending" && S.failSendingUpdate) throw new Error("connection reset");
      S.orderUpdates.push({ id, patch });
      // A cleared key releases the claim (the unique index no longer holds it).
      if (patch.operationKey === null) {
        for (const [k, v] of S.claimed) if (v.id === id) S.claimed.delete(k);
      }
      return { id, ...patch };
    },
  },
  db: {
    select: () => ({
      from: (t: unknown) => ({
        where: () => ({
          limit: async () => (t === mailingOrders ? [...S.claimed.values()].map((c) => ({ ...c, totalPieces: 2, sentPieces: 1, failedPieces: 0 })) : []),
        }),
      }),
    }),
  },
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerCampaignRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/campaigns/:id/send-direct-mail");
  if (!r) throw new Error("send-direct-mail not registered");
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
const req = (key: string) => ({
  params: { id: "3" },
  body: { pieceType: "letter_1_page", leadIds: [11, 12] },
  headers: { "idempotency-key": key },
  organization: { id: 5, settings: { mailMode: "test" } },
  user: { id: "u1" },
});

beforeEach(() => {
  S.claimed = new Map();
  S.orders = [];
  S.orderUpdates = [];
  S.deducted = [];
  S.deductOk = true;
  S.lobCalls = 0;
  S.refunds = [];
  S.failSendingUpdate = false;
});

describe("a campaign send is claimed once, before any credit moves", () => {
  it("a retry of a send already in flight is refused — no second order, no second debit, nothing mailed", async () => {
    S.claimed.set("send-key-0001", { id: 1, status: "sending" }); // the first request is still printing
    const r = res();
    await (await handler())(req("send-key-0001"), r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ error: "SEND_ALREADY_STARTED", details: { mailingOrder: { id: 1, status: "sending" } } });
    expect(S.orders).toHaveLength(0);
    expect(S.deducted).toEqual([]);
    expect(S.lobCalls).toBe(0);
  });

  it("the order carries the key and is opened before the debit", async () => {
    S.deductOk = false; // stop right after the debit attempt
    const r = res();
    await (await handler())(req("send-key-0002"), r);
    expect(S.orders).toHaveLength(1);
    expect(S.orders[0].operationKey).toBe("send-key-0002");
    expect(S.deducted).toEqual([300]);
    // Insufficient credits after the claim: the order says so and nothing is mailed.
    expect(r.statusCode).toBe(402);
    expect(S.orderUpdates).toEqual([{ id: 1, patch: expect.objectContaining({ status: "failed", operationKey: null }) }]);
    expect(S.lobCalls).toBe(0);
  });

  it("a send refused before any piece was sent releases its claim — the retry is a new attempt, not 'already started' (audit of 7cc7345)", async () => {
    S.deductOk = false;
    await (await handler())(req("send-key-0003"), res());
    S.deductOk = true;
    S.failSendingUpdate = true; // stop the retry right after its claim + debit
    const retry = res();
    await (await handler())(req("send-key-0003"), retry).catch(() => undefined);
    expect(retry.statusCode).not.toBe(409);
    expect(S.orders).toHaveLength(2);
  });

  it("a founder's zero debit is not refunded (audit of 9ed61f4)", async () => {
    const { creditService } = (await import("../../server/services/credits")) as unknown as {
      creditService: { deductCredits: (o: number, c: number) => Promise<unknown> };
    };
    const real = creditService.deductCredits;
    creditService.deductCredits = async (_o: number, cents: number) => (S.deducted.push(cents), { id: 2, amountCents: 0 });
    S.failSendingUpdate = true;
    await (await handler())(req("send-key-0005"), res()).catch(() => undefined);
    creditService.deductCredits = real;
    expect(S.refunds).toEqual([]);
  });

  it("a failure after the debit and before any piece refunds the debit and releases the claim", async () => {
    S.failSendingUpdate = true;
    await (await handler())(req("send-key-0004"), res()).catch(() => undefined);
    expect(S.deducted).toEqual([300]);
    expect(S.refunds).toEqual([300]);
    expect(S.orderUpdates.at(-1)).toMatchObject({ id: 1, patch: { status: "failed", operationKey: null } });
    expect(S.claimed.has("send-key-0004")).toBe(false);
    expect(S.lobCalls).toBe(0);
  });
});
