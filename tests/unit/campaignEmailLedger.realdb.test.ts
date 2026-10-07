/**
 * The campaign email ledger, against a real Postgres.
 *
 * The companion unit test proves the route's decisions with stubs. What a stub
 * cannot evaluate is SQL: whether the dedup read really lets a FAILED recipient
 * be retried (the `status NOT IN (...)` filter), and whether the refund really
 * lands on the org's balance and ledger next to the failure row. This runs the
 * real handler on the real storage, credits and database; only the outbound
 * transport is stubbed (no live sends).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("campaignEmailLedger.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => undefined }));

const S = vi.hoisted(() => ({ failFor: new Set<string>(), sentTo: [] as string[] }));
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: async (o: { to: string }) => {
      if (S.failFor.has(o.to)) return { success: false, error: "provider rejected", errorType: "recipient_rejected" };
      S.sentTo.push(o.to);
      return { success: true, messageId: `m-${o.to}` };
    },
  },
}));

const tag = `cel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0, campaign: 0, a: 0, b: 0, c: 0 };
const email = (k: string) => `${tag}-${k}@example.com`;

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerCampaignRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/campaigns/:id/send-email")!;
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}

describe.runIf(realDbAvailable)("campaign email ledger (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, campaigns, leads } = await import("@shared/schema");
    const [org] = await db
      .insert(organizations)
      .values({ name: tag, slug: tag, ownerId: `${tag}-owner`, creditBalance: "100" } as any)
      .returning();
    ids.org = org.id;
    const [c] = await db
      .insert(campaigns)
      .values({ organizationId: org.id, name: "Ledger check", type: "email", subject: "Hello", content: "Hi {{firstName}}" } as any)
      .returning();
    ids.campaign = c.id;
    const mk = async (k: string, extra: Record<string, unknown> = {}) =>
      (await db.insert(leads).values({ organizationId: org.id, firstName: k, lastName: "T", email: email(k), ...extra } as any).returning())[0].id;
    ids.a = await mk("a");
    ids.b = await mk("b");
    ids.c = await mk("c", { doNotContact: true });
  });

  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM campaign_delivery_events WHERE campaign_id = ${ids.campaign}`);
    await db.execute(sql`DELETE FROM credit_transactions WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM activity_log WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM campaigns WHERE id = ${ids.campaign}`);
    await db.execute(sql`DELETE FROM leads WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ids.org}`);
  });

  const balance = async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const r = await db.execute(sql`SELECT credit_balance::numeric::int AS b FROM organizations WHERE id = ${ids.org}`);
    return Number((r as any).rows[0].b);
  };

  it("a failed recipient is refunded on the ledger, and a retry reaches it", async () => {
    const h = await handler();
    const req = (leadIds: number[]) => ({
      params: { id: String(ids.campaign) },
      body: { leadIds },
      headers: {},
      organization: { id: ids.org, settings: {} },
      user: { id: `${tag}-owner` },
      isFounder: false,
    });

    S.failFor = new Set([email("b")]);
    const first = res();
    await h(req([ids.a, ids.b, ids.c]), first);
    expect(first.body).toMatchObject({ sent: 1, failed: 1, excluded: { doNotContact: 1 }, refunded: 1 });
    expect(S.sentTo).toEqual([email("a")]);
    expect(await balance()).toBe(99); // 100 − 2 charged + 1 refunded

    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const events = await db.execute(
      sql`SELECT lead_id, status, sent_at FROM campaign_delivery_events WHERE campaign_id = ${ids.campaign} ORDER BY lead_id`,
    );
    const rows = (events as any).rows.map((r: any) => ({ lead: r.lead_id, status: r.status, sentAt: r.sent_at === null ? null : "set" }));
    expect(rows).toEqual([
      { lead: ids.a, status: "sent", sentAt: "set" },
      { lead: ids.b, status: "failed", sentAt: null },
    ]);
    const ledger = await db.execute(
      sql`SELECT type, amount_cents FROM credit_transactions WHERE organization_id = ${ids.org} ORDER BY id`,
    );
    expect((ledger as any).rows.map((r: any) => [r.type, Number(r.amount_cents)])).toEqual([
      ["debit", -2],
      ["refund", 1],
    ]);

    // The failed row is not a delivery: the retry reaches b, and a is skipped.
    S.failFor = new Set();
    const second = res();
    await h(req([ids.a, ids.b]), second);
    expect(second.body).toMatchObject({ sent: 1, failed: 0, skippedDuplicates: 1 });
    expect(S.sentTo).toEqual([email("a"), email("b")]);
    expect(await balance()).toBe(98);
  });
});
