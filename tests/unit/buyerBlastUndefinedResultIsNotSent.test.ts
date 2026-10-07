/**
 * POST /api/properties/:id/blast-buyers counts a recipient as SENT only when
 * the transport says so.
 *
 * The loop read `result?.success || result === undefined`: a send that
 * returned nothing at all was counted sent, its recipient row stamped `sent`
 * with a sentAt — and that row then counted toward the buyer's 7-day cadence
 * cap for a blast they never received. Drives the real handler with a stubbed
 * database and transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buyerBlastRecipients } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  selects: [] as unknown[][],
  recipientSets: [] as Array<Record<string, unknown>>,
  sendResults: new Map<string, unknown>(),
}));

vi.mock("../../server/services/emailService", () => ({
  sendEmail: async (o: { to: string }) => S.sendResults.get(o.to),
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
      insert: () => ({
        values: () => Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: 1, status: "queued" }] }),
      }),
      update: (t: unknown) => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => {
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

beforeEach(() => {
  S.selects = [[{ id: 5, status: "owned" }], [buyer(1), buyer(2)], []];
  S.recipientSets = [];
  S.sendResults = new Map();
});

describe("buyer blast send outcome", () => {
  it("a send that returned nothing is a failure, not a send", async () => {
    S.sendResults.set("b1@example.com", { success: true, messageId: "m1" });
    S.sendResults.set("b2@example.com", undefined);
    const r = res();
    await (await handler())({ params: { id: "5" }, body: { subject: "New land", body: "<p>Hi</p>" }, organization: { id: 9 }, user: { id: "u" } }, r);
    expect(r.statusCode).toBe(201);
    expect(r.body.blast).toMatchObject({ sentCount: 1, failedCount: 1 });
    expect(S.recipientSets.filter((p) => p.status === "sent")).toHaveLength(1);
    expect(S.recipientSets.filter((p) => p.status === "failed")).toHaveLength(1);
  });
});
