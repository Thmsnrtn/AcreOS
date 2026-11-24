/**
 * W-DEF-1 — a buyer blast cannot starve silently behind the sending-
 * identity gate, and its finalized status cannot lie about the outcome.
 *
 * The Wholesale journey walk (2026-11-18, staging org 106) proved the
 * defect live: a fresh org with no connected email identity sent a blast
 * whose sole recipient failed with the transport's identity refusal, yet
 * the blast row finalized `status: "sent"` at sentCount 0 / failedCount 1,
 * and nothing anywhere in the flow had told the operator an identity was
 * required before the send was attempted.
 *
 * The identity gate itself is ratified policy (founder decision
 * 2026-07-17) and is NOT changed here. What is pinned:
 *   1. Preflight — with no identity, a real send is refused up front with
 *      the campaign lane's reason code, BEFORE any blast/recipient row is
 *      inserted and before any per-recipient send is attempted; the
 *      dry-run preview carries the warning so the operator sees it while
 *      composing.
 *   2. Status honesty — a blast whose sends all fail finalizes "failed",
 *      never "sent"; a partial blast (some sent) stays "sent" with the
 *      honest counters.
 *
 * Drives the real handler with a stubbed database and transport, in the
 * shape of buyerBlastUndefinedResultIsNotSent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buyerBlasts, buyerBlastRecipients } from "@shared/schema";

// The tax-hold gate (V-Tax-1 T4b) reads tax certificates; this suite's db
// is mocked for another invariant, so no tax position holds the parcel
// here. The gate itself is tested against a real database in
// taxLandExit.realdb.test.ts.
vi.mock("../../server/services/tax/landExit", () => ({ refuseRedeemableDeedSpend: async () => true, taxHoldRefusal: async () => null, heldPropertyIds: async () => new Set<number>() }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  selects: [] as unknown[][],
  canSend: true,
  sendCalls: [] as string[],
  sendResults: new Map<string, unknown>(),
  inserts: 0,
  blastSets: [] as Array<Record<string, unknown>>,
  recipientSets: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/services/emailService", () => ({
  sendEmail: async (o: { to: string }) => {
    S.sendCalls.push(o.to);
    return S.sendResults.get(o.to);
  },
  counterpartyEmailIdentityStatus: async () => ({
    canSend: S.canSend,
    ownSesCredentials: false,
    verifiedDomain: S.canSend,
  }),
}));
vi.mock("../../server/services/listability", () => ({ offerabilityRefusal: () => null }));
vi.mock("../../server/db", () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, no);
    return c;
  };
  return {
    db: {
      select: () => chain(S.selects.shift() ?? []),
      insert: () => {
        S.inserts += 1;
        return {
          values: () => Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: "blast-1", status: "queued" }] }),
        };
      },
      update: (t: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
            if (t === buyerBlasts) S.blastSets.push(patch);
            if (t === buyerBlastRecipients) S.recipientSets.push(patch);
          },
        }),
      }),
    },
  };
});

async function handler() {
  const { registerBuyerBlastRoutes } = await import("../../server/routes-buyer-blasts");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerBuyerBlastRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/properties/:id/blast-buyers")!;
  return r.args[r.args.length - 1] as (req: unknown, res: unknown) => Promise<unknown>;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}
const buyer = (id: number) => ({ buyerId: id, matchScore: 90, buyerFirstName: "B", buyerLastName: `${id}`, buyerEmail: `b${id}@example.com`, financialInfo: { financingType: "cash" } });
const req = (body: Record<string, unknown>) => ({
  params: { id: "5" },
  body: { subject: "New land", body: "<p>Hi</p>", ...body },
  organization: { id: 9 },
  user: { id: "u" },
});

beforeEach(() => {
  S.selects = [[{ id: 5, status: "owned" }], [buyer(1), buyer(2)], []];
  S.canSend = true;
  S.sendCalls = [];
  S.sendResults = new Map();
  S.inserts = 0;
  S.blastSets = [];
  S.recipientSets = [];
});

describe("buyer blast sending-identity preflight (W-DEF-1)", () => {
  it("no identity: a real send is refused up front — no blast row, no send attempted", async () => {
    S.canSend = false;
    const r = res();
    await (await handler())(req({}), r);
    expect(r.statusCode).toBe(400);
    expect(r.body.message).toContain("Settings → Connections");
    expect(r.body.details).toMatchObject({ reason: "no_counterparty_email_identity", sent: 0 });
    // The preflight fires before finalization machinery exists at all:
    // nothing was inserted and the transport was never invoked.
    expect(S.inserts).toBe(0);
    expect(S.sendCalls).toHaveLength(0);
    expect(S.blastSets).toHaveLength(0);
  });

  it("no identity: the dry-run preview carries the warning while the operator composes", async () => {
    S.canSend = false;
    const r = res();
    await (await handler())(req({ dryRun: true }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.recipientCount).toBe(2);
    expect(r.body.sendingIdentityWarning).toContain("no connected email account or verified sending domain");
    expect(S.sendCalls).toHaveLength(0);
  });

  it("identity present: the preview carries no identity warning", async () => {
    const r = res();
    await (await handler())(req({ dryRun: true }), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.sendingIdentityWarning).toBeNull();
  });
});

describe("buyer blast status honesty (W-DEF-1)", () => {
  it("every send fails: the blast finalizes failed, never sent", async () => {
    S.sendResults.set("b1@example.com", { success: false, error: "No connected email identity for this organization." });
    S.sendResults.set("b2@example.com", { success: false, error: "No connected email identity for this organization." });
    const r = res();
    await (await handler())(req({}), r);
    expect(r.statusCode).toBe(201);
    expect(r.body.blast).toMatchObject({ status: "failed", sentCount: 0, failedCount: 2 });
    expect(S.blastSets).toHaveLength(1);
    expect(S.blastSets[0]).toMatchObject({ status: "failed", sentCount: 0, failedCount: 2 });
  });

  it("partial success: the blast stays sent, with honest counters", async () => {
    S.sendResults.set("b1@example.com", { success: true, messageId: "m1" });
    S.sendResults.set("b2@example.com", { success: false, error: "SES rejected" });
    const r = res();
    await (await handler())(req({}), r);
    expect(r.statusCode).toBe(201);
    expect(r.body.blast).toMatchObject({ status: "sent", sentCount: 1, failedCount: 1 });
    expect(S.blastSets[0]).toMatchObject({ status: "sent", sentCount: 1, failedCount: 1 });
  });

  it("all sends succeed: the blast finalizes sent", async () => {
    S.sendResults.set("b1@example.com", { success: true, messageId: "m1" });
    S.sendResults.set("b2@example.com", { success: true, messageId: "m2" });
    const r = res();
    await (await handler())(req({}), r);
    expect(r.statusCode).toBe(201);
    expect(r.body.blast).toMatchObject({ status: "sent", sentCount: 2, failedCount: 0 });
    expect(S.blastSets[0]).toMatchObject({ status: "sent" });
  });
});
