/**
 * POST /api/notes/:id/dunning { action: "send_reminder" } reports what the
 * dispatch DID, not that a row exists.
 *
 * `financeAgentService.sendManualReminder` returns `success: true` whenever it
 * created the reminder row, with the dispatch outcome in `status` ("sent",
 * "failed", "blocked", "unavailable", "document_ready", …). The route read only
 * `success` and answered "Reminder sent successfully" — for a notice the rail
 * refused, a borrower with no contact on file, and a letter nobody mailed.
 * Same for POST /api/notes/:id/send-reminder, which dropped the status
 * entirely. Drives the real registered handlers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({ outcome: {} as Record<string, unknown> }));
vi.mock("../../server/services/financeAgent", () => ({
  financeAgentService: { sendManualReminder: async () => S.outcome },
}));
vi.mock("../../server/storage", () => ({
  storage: { getNote: async (_o: number, id: number) => ({ id, borrowerId: 3, organizationId: 5 }) },
  db: {},
  calculateMonthlyPayment: () => 0,
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handlers(): Promise<Record<string, Handler>> {
  const { registerFinanceRoutes } = await import("../../server/routes-finance");
  const out: Record<string, Handler> = {};
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => {
      if (typeof path === "string") out[`${m.toUpperCase()} ${path}`] = args[args.length - 1] as Handler;
    };
  }
  registerFinanceRoutes(app as never);
  return out;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}
const req = (body: Record<string, unknown>) => ({ params: { id: "42" }, body, organization: { id: 5 }, user: { id: "u" } });

beforeEach(() => {
  S.outcome = {};
});

const NOT_SENT = [
  { status: "failed", deliveryNote: "The provider rejected the message." },
  { status: "blocked", deliveryNote: "Borrower opted out." },
  { status: "unavailable", deliveryNote: "No email or phone on file." },
  { status: "awaiting_approval", deliveryNote: "Waiting for your approval." },
];

describe("dunning send_reminder reports the dispatch outcome", () => {
  for (const o of NOT_SENT) {
    it(`a "${o.status}" reminder is not reported as sent`, async () => {
      S.outcome = { success: true, reminderId: 9, ...o };
      const r = res();
      await (await handlers())["POST /api/notes/:id/dunning"](req({ action: "send_reminder", stage: "late" }), r);
      expect(r.body.sent).toBe(false);
      expect(r.body.status).toBe(o.status);
      expect(String(r.body.message)).not.toMatch(/sent successfully|^Reminder sent/i);
      expect(String(r.body.message)).toContain(o.deliveryNote);
    });
  }

  it("a letter that was only prepared says so", async () => {
    S.outcome = { success: true, reminderId: 9, status: "document_ready", deliveryNote: "Physical mail is not wired." };
    const r = res();
    await (await handlers())["POST /api/notes/:id/dunning"](req({ action: "send_reminder", stage: "demand_letter" }), r);
    expect(r.body).toMatchObject({ sent: false, status: "document_ready" });
    expect(String(r.body.message)).toMatch(/not been mailed/);
  });

  it("a queued reminder is accepted but not reported as sent", async () => {
    S.outcome = { success: true, reminderId: 9, status: "queued", deliveryNote: "Waiting on a connected sender." };
    const r = res();
    await (await handlers())["POST /api/notes/:id/dunning"](req({ action: "send_reminder" }), r);
    expect(r.body).toMatchObject({ success: true, sent: false, queued: true, status: "queued" });
    expect(String(r.body.message)).toMatch(/queued for sending — it has not gone out yet/);
  });

  it("a delivered reminder is reported as sent", async () => {
    S.outcome = { success: true, reminderId: 9, status: "sent" };
    const r = res();
    await (await handlers())["POST /api/notes/:id/dunning"](req({ action: "send_reminder" }), r);
    expect(r.body).toMatchObject({ success: true, sent: true, queued: false, status: "sent", reminderId: 9 });
  });

  it("the send-reminder route carries the same outcome", async () => {
    S.outcome = { success: true, reminderId: 9, status: "failed", deliveryNote: "The provider rejected the message." };
    const r = res();
    await (await handlers())["POST /api/notes/:id/send-reminder"](req({ type: "late" }), r);
    expect(r.body).toMatchObject({ success: false, sent: false, status: "failed" });
  });
});
