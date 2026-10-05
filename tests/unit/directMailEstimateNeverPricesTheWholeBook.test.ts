/**
 * W10.2b audit — POST /api/direct-mail/estimate never presents an unfiltered
 * lead count as a campaign's recipients.
 *
 * Given only a campaignId whose campaign carried targetCriteria, the
 * estimate priced EVERY live lead of the org (storage.getLeadCount) and
 * derived hasEnoughCredits from that, while its own comment admitted the
 * criteria were not applied. Nothing in the codebase resolves targetCriteria
 * to leads — the send path mails the explicit leadIds the operator picked —
 * so there is no audience to count. The estimate refuses instead and names
 * what it needs: recipientIds or recipientCount.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  leadCountCalls: 0,
  estimates: [] as Array<{ pieceType: string; count: number }>,
}));

vi.mock("../../server/services/directMail", () => ({
  directMailService: {
    isAvailable: () => true,
    estimateBatchCost: (pieceType: string, count: number) => {
      S.estimates.push({ pieceType, count });
      return { pieceType, count, costPerPiece: 100, totalCost: 100 * count };
    },
  },
  DIRECT_MAIL_COSTS: { letter_1_page: 150, postcard_4x6: 100, postcard_6x9: 120, postcard_6x11: 130 },
  MailAlreadySentError: class extends Error {},
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getCampaign: async () => ({ id: 3, name: "Fall letters", type: "direct_mail", targetCriteria: { leadStatus: ["new"], leadType: ["seller"] } }),
    getLeadCount: async () => (S.leadCountCalls++, 9_000),
  },
  db: {},
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
  const r = routes.find((x) => x.method === "post" && x.path === "/api/direct-mail/estimate");
  if (!r) throw new Error("direct-mail estimate not registered");
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
const req = (body: Record<string, unknown>) => ({
  body: { pieceType: "letter_1_page", ...body },
  organization: { id: 5, settings: { mailMode: "test" }, creditBalance: "50000" },
  user: { id: "u1" },
});

beforeEach(() => {
  S.leadCountCalls = 0;
  S.estimates = [];
});

describe("the direct-mail estimate prices the recipients it was given, never the whole book", () => {
  it("a targeted campaign alone is refused — no all-leads count, no price, no credit verdict", async () => {
    const r = res();
    await (await handler())(req({ campaignId: 3 }), r);
    expect(r.statusCode).toBe(400);
    expect(String(r.body?.message)).toMatch(/recipientIds or recipientCount/);
    expect(r.body).not.toHaveProperty("hasEnoughCredits");
    expect(S.leadCountCalls).toBe(0);
    expect(S.estimates).toEqual([]);
  });

  it("with a campaignId, the recipientCount given is the count priced (not the org's lead total)", async () => {
    const r = res();
    await (await handler())(req({ campaignId: 3, recipientCount: 12 }), r);
    expect(r.statusCode).toBe(200);
    expect(S.estimates).toEqual([{ pieceType: "letter_1_page", count: 12 }]);
    expect(r.body).toMatchObject({ count: 12, hasEnoughCredits: true });
    expect(S.leadCountCalls).toBe(0);
  });

  it("recipientIds price their own length", async () => {
    const r = res();
    await (await handler())(req({ campaignId: 3, recipientIds: [11, 12, 13] }), r);
    expect(r.statusCode).toBe(200);
    expect(S.estimates).toEqual([{ pieceType: "letter_1_page", count: 3 }]);
    expect(S.leadCountCalls).toBe(0);
  });

  it("nothing to price is still refused", async () => {
    const r = res();
    await (await handler())(req({}), r);
    expect(r.statusCode).toBe(400);
    expect(S.estimates).toEqual([]);
  });
});
