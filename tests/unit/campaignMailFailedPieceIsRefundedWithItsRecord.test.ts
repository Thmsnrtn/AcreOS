/**
 * POST /api/campaigns/:id/send-direct-mail — a piece the provider refused is
 * refunded in the same transaction that records it as failed.
 *
 * The route debits every piece upfront. Failed pieces were refunded by ONE
 * batch credit after the loop, after the mailing order was closed out — so any
 * failure between a refused piece and that line (closing the order, recording
 * usage) returned 500 with the charge for every refused piece kept. The refund
 * now posts with the piece's failure record, before anything else can fail.
 *
 * Opt-out exclusion on this path is the pre-mail scanner's job and is pinned
 * through `leadHasOptedOut` (the same predicate the email audience uses).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mailingOrderPieces } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  deducted: [] as number[],
  refunds: [] as Array<{ cents: number; tx: unknown }>,
  pieces: [] as Array<{ row: Record<string, unknown>; on: unknown }>,
  failLob: new Set<number>(),
  failCompletion: false,
  rootDb: null as unknown,
  campaign: {} as Record<string, unknown>,
  txThrows: false,
  lobCalls: 0,
}));

vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_q: unknown, _r: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/credits", () => ({
  creditService: {
    getBalance: async () => 1_000_000,
    deductCredits: async (_o: number, cents: number) => (S.deducted.push(cents), { id: 1, amountCents: -cents }),
    addCredits: async (_o: number, cents: number, _t: string, _d: string, _m?: unknown, opts?: { tx?: unknown }) => {
      S.refunds.push({ cents, tx: opts?.tx });
      return { id: 2 };
    },
  },
  usageMeteringService: { recordUsage: async () => undefined },
}));
vi.mock("../../server/services/preMailDedupe", () => ({
  runPreMailDedupe: async ({ leadIds }: { leadIds: number[] }) => ({
    acceptedLeads: leadIds.map((id) => ({ id })),
    totals: { input: leadIds.length, accepted: leadIds.length, skipped: 0 },
    skipped: { ownedParcel: [], recentlyMailed: [], returnedMail: [], doNotContact: [], missingAddress: [] },
  }),
}));
vi.mock("../../server/services/directMail", () => ({
  directMailService: {
    hasOrgLobCredentials: async () => false,
    isAvailable: () => true,
    sendPostcard: async () => (S.lobCalls++, { id: "psc_1" }),
    sendLetter: async (o: { idempotencyKey: string }) => {
      S.lobCalls++;
      const leadId = Number(o.idempotencyKey.split(":").pop());
      if (S.failLob.has(leadId)) throw new Error("address undeliverable");
      return { id: `ltr_${leadId}` };
    },
  },
  DIRECT_MAIL_COSTS: { letter_1_page: 150, postcard_4x6: 100, postcard_6x9: 120, postcard_6x11: 130 },
  MailAlreadySentError: class extends Error {},
}));
vi.mock("../../server/storage", () => {
  const executor = (tag: unknown) => ({
    insert: (t: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (t === mailingOrderPieces) S.pieces.push({ row, on: tag });
        const p = Promise.resolve([{ id: S.pieces.length, ...row }]);
        return Object.assign(p, { returning: async () => [{ id: S.pieces.length, ...row }] });
      },
    }),
  });
  const db: Record<string, unknown> = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx: Record<string, unknown> = {};
      tx.insert = executor(tx).insert;
      if (S.txThrows) throw new Error("connection reset");
      return fn(tx);
    },
  };
  Object.assign(db, { insert: executor(db).insert });
  S.rootDb = db;
  return {
    storage: {
      getCampaign: async () => S.campaign,
      getDefaultMailSenderIdentity: async () => ({
        id: 1, name: "Acme", status: "verified", companyName: "Acme Land", addressLine1: "1 Main", city: "Austin", state: "TX", zipCode: "78701", country: "US",
      }),
      getLead: async (_o: number, id: number) => ({ id, firstName: "A", lastName: "B", address: "2 Elm", city: "Llano", state: "TX", zip: "78643" }),
      createMailingOrder: async (o: Record<string, unknown>) => ({ id: 1, ...o }),
      updateMailingOrder: async (id: number, patch: Record<string, unknown>) => {
        if (patch.status === "completed" && S.failCompletion) throw new Error("connection reset");
        return { id, ...patch };
      },
      createMailingOrderPiece: async (row: Record<string, unknown>) => {
        S.pieces.push({ row, on: db });
        return { id: S.pieces.length, ...row };
      },
      updateMailingOrderPiece: async () => ({}),
      updateCampaign: async () => ({}),
    },
    db,
  };
});

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerCampaignRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/campaigns/:id/send-direct-mail")!;
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}
const req = (leadIds: number[] = [11, 12], pieceType = "letter_1_page") => ({
  params: { id: "3" },
  body: { pieceType, leadIds },
  headers: {},
  organization: { id: 5, settings: { mailMode: "test" } },
  user: { id: "u1" },
});

beforeEach(() => {
  S.deducted = [];
  S.refunds = [];
  S.pieces = [];
  S.failLob = new Set();
  S.failCompletion = false;
  S.campaign = { id: 3, name: "Fall letters", type: "direct_mail", content: "<p>Hi</p>", subject: "We buy land" };
  S.txThrows = false;
  S.lobCalls = 0;
});

describe("campaign direct mail: a refused piece is refunded with its failure record", () => {
  it("the refund and the failed-piece row share one transaction", async () => {
    S.failLob.add(12);
    const r = res();
    await (await handler())(req(), r);
    expect(S.deducted).toEqual([300]);
    expect(S.refunds).toHaveLength(1);
    expect(S.refunds[0].cents).toBe(150);
    const failed = S.pieces.find((p) => p.row.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.on).not.toBe(S.rootDb);
    expect(S.refunds[0].tx).toBe(failed!.on);
    expect(r.body).toMatchObject({ piecesQueued: 1, piecesFailed: 1, refunded: 1.5 });
  });

  it("a failure closing out the order does not keep the refused piece's charge", async () => {
    S.failLob.add(12);
    S.failCompletion = true;
    await (await handler())(req(), res()).catch(() => undefined);
    expect(S.refunds.map((x) => x.cents)).toEqual([150]);
  });

  it("an accepted piece is never refunded", async () => {
    await (await handler())(req(), res());
    expect(S.refunds).toEqual([]);
  });
});

describe("campaign direct mail: charged once per recipient, refunded if interrupted", () => {
  it("a repeated lead id is charged and printed once", async () => {
    await (await handler())(req([11, 11, 12]), res());
    expect(S.deducted).toEqual([300]);
    expect(S.lobCalls).toBe(2);
  });

  it("a send that dies part-way refunds every piece not settled", async () => {
    // 11 is accepted; 12 is refused and its failure transaction throws; 13 is never reached.
    S.failLob.add(12);
    S.txThrows = true;
    await (await handler())(req([11, 12, 13]), res()).catch(() => undefined);
    expect(S.deducted).toEqual([450]);
    expect(S.refunds.map((x) => x.cents)).toEqual([300]);
  });
});

describe("campaign direct mail: no placeholder is ever printed", () => {
  it("a campaign with no content is refused before anything is claimed, charged or printed", async () => {
    S.campaign = { ...S.campaign, content: "  " };
    const r = res();
    await (await handler())(req(), r);
    expect(r.statusCode).toBe(400);
    expect(String(r.body?.message)).toMatch(/no content/);
    expect(S.deducted).toEqual([]);
    expect(S.lobCalls).toBe(0);
  });

  it("a postcard with no subject (its back message) is refused", async () => {
    S.campaign = { ...S.campaign, subject: null };
    const r = res();
    await (await handler())(req([11], "postcard_4x6"), r);
    expect(r.statusCode).toBe(400);
    expect(S.lobCalls).toBe(0);
    expect(S.deducted).toEqual([]);
  });
});
